import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { parseATSFromText, parseATSFromCVData } from "./atsParser";

export interface CustomLink {
  title: string;
  url: string;
  position?: "header" | "bottom";
}

export interface MissingSkill {
  skill: string;
  reason: string;
  suggestedPlacement: "skills" | "experience";
}

export interface CVData {
  personalInfo: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
  };
  summary: string;
  experience: Array<{
    company: string;
    position: string;
    location: string;
    startDate: string;
    endDate: string;
    highlights: string[];
  }>;
  education: Array<{
    school: string;
    degree: string;
    location: string;
    graduationDate: string;
  }>;
  skills: string[];
  customLinks?: CustomLink[];
  linksPlacement?: "header" | "bottom";
  suggestedTitle?: string;
  matchRate?: {
    original: number;
    optimized: number;
    explanation: string;
  };
}

export interface ATSScoreCategory {
  score: number;
  feedback: string;
  status: "pass" | "warn" | "fail";
}

export interface ATSIssue {
  severity: "critical" | "warning" | "good";
  title: string;
  description: string;
  recommendation: string;
}

export interface ATSSectionCheck {
  name: string;
  found: boolean;
  isStandardHeader: boolean;
  extractedHeader: string;
  status: "pass" | "warn" | "fail";
  feedback: string;
}

export interface ATSKeyword {
  keyword: string;
  category: string;
  frequency: number;
}

export interface ATSScanResult {
  overallScore: number;
  rawExtractedText: string;
  parsedEntities: {
    personalInfo: {
      fullName: string;
      email: string;
      phone: string;
      location: string;
      links: string[];
    };
    summary: string;
    workExperienceCount: number;
    educationCount: number;
    skillsCount: number;
    detectedJobTitles: string[];
  };
  scoreBreakdown: {
    contactInformation: ATSScoreCategory;
    layoutAndStructure: ATSScoreCategory;
    formattingHygiene: ATSScoreCategory;
    keywordDensity: ATSScoreCategory;
    dateConsistency: ATSScoreCategory;
  };
  sectionsCheck: ATSSectionCheck[];
  extractedKeywords: ATSKeyword[];
  issues: ATSIssue[];
  quickFixes: string[];
}

function getClientAI() {
  const metaEnv = (import.meta as any).env || {};
  let apiKey = "";

  try {
    apiKey = process.env.GEMINI_API_KEY || "";
  } catch (e) {
    // process not defined
  }

  if (!apiKey) {
    apiKey = metaEnv.VITE_GEMINI_API_KEY || metaEnv.GEMINI_API_KEY || "";
  }

  if (!apiKey && typeof window !== "undefined") {
    apiKey = (window as any).GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY") || "";
  }

  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

function cleanJsonString(str: string): string {
  return str.replace(/```json\n?|```/g, "").trim();
}

async function apiCall<T>(endpoint: string, body: any): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (netErr: any) {
    throw new Error(`Network error calling API endpoint ${endpoint}: ${netErr.message || "Failed to fetch"}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  let data: any = null;
  if (isJson) {
    try {
      data = await response.json();
    } catch (e) {
      // JSON parse error
    }
  }

  if (!response.ok) {
    if (data && data.error) {
      throw new Error(data.error);
    }
    if (response.status === 404) {
      throw new Error(`API endpoint ${endpoint} not found (404).`);
    }
    const rawText = !isJson ? await response.text() : "";
    throw new Error(`Server returned status ${response.status}${rawText ? `: ${rawText.slice(0, 100)}` : ""}`);
  }

  if (!data) {
    throw new Error(`Expected JSON response from ${endpoint} but received non-JSON payload.`);
  }

  return data as T;
}

const CV_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    personalInfo: {
      type: Type.OBJECT,
      properties: {
        fullName: { type: Type.STRING },
        email: { type: Type.STRING },
        phone: { type: Type.STRING },
        location: { type: Type.STRING },
      },
      required: ["fullName"],
    },
    summary: { type: Type.STRING },
    experience: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          company: { type: Type.STRING },
          position: { type: Type.STRING },
          location: { type: Type.STRING },
          startDate: { type: Type.STRING },
          endDate: { type: Type.STRING },
          highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
    education: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          school: { type: Type.STRING },
          degree: { type: Type.STRING },
          location: { type: Type.STRING },
          graduationDate: { type: Type.STRING },
        },
      },
    },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    customLinks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          url: { type: Type.STRING },
          position: { type: Type.STRING, enum: ["header", "bottom"] },
        },
      },
    },
    matchRate: {
      type: Type.OBJECT,
      properties: {
        original: { type: Type.NUMBER },
        optimized: { type: Type.NUMBER },
        explanation: { type: Type.STRING },
      },
      required: ["original", "optimized", "explanation"],
    },
    suggestedTitle: { type: Type.STRING },
  },
  required: ["personalInfo", "summary", "experience", "education", "skills"],
};

export async function generateCVFromMultimodal(parts: any[]): Promise<CVData> {
  try {
    return await apiCall<CVData>("/api/gemini/generate-cv-multimodal", { parts });
  } catch (error: any) {
    console.warn("Server API failed for generateCVFromMultimodal, attempting client fallback:", error.message);
    const clientAi = getClientAI();
    if (!clientAi) throw error;

    const response = await clientAi.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: "Extract CV data into JSON." }, ...parts] },
      config: {
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
      },
    });
    if (!response.text) throw new Error("Empty AI response");
    const data = JSON.parse(cleanJsonString(response.text));
    return {
      ...data,
      experience: data.experience || [],
      education: data.education || [],
      skills: data.skills || [],
      personalInfo: data.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
  }
}

export async function generateCVFromText(text: string): Promise<CVData> {
  try {
    return await apiCall<CVData>("/api/gemini/generate-cv-text", { text });
  } catch (error: any) {
    console.warn("Server API failed for generateCVFromText, attempting client fallback:", error.message);
    const clientAi = getClientAI();
    if (!clientAi) throw error;

    const response = await clientAi.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: `Extract CV data from text:\n\n${text}` }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
      },
    });
    if (!response.text) throw new Error("Empty AI response");
    const data = JSON.parse(cleanJsonString(response.text));
    return {
      ...data,
      experience: data.experience || [],
      education: data.education || [],
      skills: data.skills || [],
      personalInfo: data.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
  }
}

export async function identifyMissingSkills(cv: CVData, jobDescription: string, jobUrl?: string): Promise<MissingSkill[]> {
  try {
    return await apiCall<MissingSkill[]>("/api/gemini/identify-missing-skills", { cv, jobDescription, jobUrl });
  } catch (error: any) {
    console.warn("Server API failed for identifyMissingSkills, attempting client fallback:", error.message);
    const clientAi = getClientAI();
    if (!clientAi) return [];

    try {
      const userPrompt = jobUrl 
        ? `Identify missing skills for job at ${jobUrl}. ${jobDescription || ""}`
        : `Identify missing skills for job description: ${jobDescription}`;

      const response = await clientAi.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: `CURRENT CV: ${JSON.stringify({ skills: cv.skills, experience: cv.experience.map(e => ({ company: e.company, position: e.position })) })}` },
            { text: `TARGET JOB: ${userPrompt}` }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                skill: { type: Type.STRING },
                reason: { type: Type.STRING },
                suggestedPlacement: { type: Type.STRING, enum: ["skills", "experience"] }
              },
              required: ["skill", "reason", "suggestedPlacement"]
            }
          },
          temperature: 0.1,
        },
      });
      if (!response.text) return [];
      return JSON.parse(cleanJsonString(response.text));
    } catch (fallbackErr) {
      console.error("Client fallback error identifying missing skills:", fallbackErr);
      return [];
    }
  }
}

export async function optimizeCVForJob(
  cv: CVData,
  jobDescription: string,
  jobUrl?: string,
  additionalSkills?: Array<{ skill: string; placement: "skills" | string }>
): Promise<CVData> {
  try {
    return await apiCall<CVData>("/api/gemini/optimize-cv", { cv, jobDescription, jobUrl, additionalSkills });
  } catch (error: any) {
    console.warn("Server API failed for optimizeCVForJob, attempting client fallback:", error.message);
    const clientAi = getClientAI();
    if (!clientAi) throw error;

    const userPrompt = jobUrl 
      ? `Optimize CV for job at ${jobUrl}. ${jobDescription || ""}`
      : `Optimize CV for job description: ${jobDescription}`;

    const skillsContext = additionalSkills && additionalSkills.length > 0
      ? `\n\nADDITIONAL CONFIRMED SKILLS TO INCLUDE:\n${additionalSkills.map(s => `- ${s.skill} (Add to: ${s.placement})`).join("\n")}`
      : "";

    const response = await clientAi.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { text: `SOURCE CV: ${JSON.stringify(cv)}` },
          { text: `TARGET JOB: ${userPrompt}${skillsContext}` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    if (!response.text) throw new Error("Empty response during optimization");
    const result = JSON.parse(cleanJsonString(response.text));
    return {
      ...result,
      experience: result.experience || [],
      education: result.education || [],
      skills: result.skills || [],
      personalInfo: result.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
  }
}

export async function translateCV(cv: CVData, targetLanguage: string): Promise<CVData> {
  try {
    return await apiCall<CVData>("/api/gemini/translate-cv", { cv, targetLanguage });
  } catch (error: any) {
    console.warn("Server API failed for translateCV, attempting client fallback:", error.message);
    const clientAi = getClientAI();
    if (!clientAi) throw error;

    const response = await clientAi.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { text: `Translate CV into ${targetLanguage}.` },
          { text: `CV DATA: ${JSON.stringify(cv)}` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
      },
    });

    if (!response.text) throw new Error("Empty response during translation");
    const result = JSON.parse(cleanJsonString(response.text));
    return {
      ...result,
      experience: result.experience || [],
      education: result.education || [],
      skills: result.skills || [],
      personalInfo: result.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
  }
}

export async function scanCVForATSFromMultimodal(parts: any[]): Promise<ATSScanResult> {
  try {
    return await apiCall<ATSScanResult>("/api/gemini/scan-ats-multimodal", { parts });
  } catch (error) {
    console.warn("Server ATS scan failed, using fallback:", error);
    return parseATSFromText("CV Document Text Stream");
  }
}

export async function scanCVForATSFromText(text: string): Promise<ATSScanResult> {
  return parseATSFromText(text);
}

export async function scanCVForATSFromCVData(cv: CVData): Promise<ATSScanResult> {
  return parseATSFromCVData(cv);
}

