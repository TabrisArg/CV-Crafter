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
    console.info("Server API unavailable, running client Gemini AI processing for multimodal parsing...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable (404) and no VITE_GEMINI_API_KEY found. If deployed on Netlify, please add VITE_GEMINI_API_KEY to your Netlify Environment Variables and re-deploy.");
    }

    const response = await clientAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [{ text: "Extract CV data into JSON." }, ...parts] },
      config: {
        systemInstruction: `You are a high-precision CV/Resume extraction engine. Your goal is to convert images/PDFs of CVs into structured JSON.
        
        STRICT OPERATIONAL GUIDELINES:
        1. JSON ONLY: Your entire response must be a single, valid JSON object matching the provided schema.
        2. NO META-COMMENTARY: Do not include any notes or conversational text outside the JSON object.
        3. EXHAUSTIVE EXTRACTION: Extract EVERY experience and education entry. Do not omit any history.
        4. CERTIFICATIONS: Professional certifications (e.g., Scrum Master, PMP, AWS Certified) MUST be placed in the 'education' section, NOT the 'skills' section. Use the issuing organization as 'school' and the certification name as 'degree'.
        5. FIELD ISOLATION: Strictly separate metadata (Company, Position, Location, Dates) from content (Highlights).
           - Dates and Locations MUST be placed in their dedicated fields ('startDate', 'endDate', 'location').
           - 'highlights' MUST ONLY contain bullet points of achievements/responsibilities.
        6. OCR PRECISION: Use high-fidelity OCR to capture every detail.
        7. BOLDING: Use Markdown bolding (**text**) for key achievements and metrics within 'summary' and 'highlights'.
        8. LINK EXTRACTION: Scrape all URLs (LinkedIn, GitHub, Portfolios) and place them in 'customLinks'.`,
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
    console.info("Server API unavailable, running client Gemini AI processing for text parsing...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable (404) and no VITE_GEMINI_API_KEY found. If deployed on Netlify, please add VITE_GEMINI_API_KEY to your Netlify Environment Variables and re-deploy.");
    }

    const response = await clientAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [{ text: `Extract CV data from text:\n\n${text}` }] },
      config: {
        systemInstruction: `You are a high-precision CV parsing engine. Your goal is to convert CV/Resume text into structured JSON.
        
        STRICT OPERATIONAL GUIDELINES:
        1. JSON ONLY: Your entire response must be a single, valid JSON object.
        2. NO META-COMMENTARY: Do not include any notes or conversational text.
        3. EXHAUSTIVE EXTRACTION: Extract EVERY experience and education entry. Do not omit any.
        4. CERTIFICATIONS: Professional certifications (e.g., Scrum Master, PMP, AWS Certified) MUST be placed in the 'education' section, NOT the 'skills' section.
        5. FIELD ISOLATION: Strictly separate dates, locations, and company names from the 'highlights' and 'summary' fields. Move them to their dedicated JSON properties.
        6. BOLDING: Use Markdown bolding (**text**) for key achievements and metrics.
        7. LINKS: Extract all URLs into the 'customLinks' array.`,
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
    console.info("Server API unavailable, running client Gemini AI processing for missing skills...");
    const clientAi = getClientAI();
    if (!clientAi) return [];

    try {
      const userPrompt = jobUrl 
        ? `Identify missing skills for job at ${jobUrl}. ${jobDescription || ""}`
        : `Identify missing skills for job description: ${jobDescription}`;

      const response = await clientAi.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { text: `CURRENT CV: ${JSON.stringify({ skills: cv.skills, experience: cv.experience.map(e => ({ company: e.company, position: e.position })) })}` },
            { text: `TARGET JOB: ${userPrompt}` }
          ]
        },
        config: {
          systemInstruction: `You are a career coach. Analyze the TARGET JOB and the CURRENT CV. 
          Identify the top 5-8 critical technical or soft skills required by the job that are NOT explicitly mentioned in the CV.
          
          For each missing skill, provide:
          1. 'skill': The name of the skill.
          2. 'reason': Why this skill is crucial for this specific job.
          3. 'suggestedPlacement': Whether this skill is best added to the general 'skills' list or integrated into a past 'experience' entry.
          
          OUTPUT: Return ONLY a JSON array of objects matching the schema. No conversational text.`,
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
    console.info("Server API unavailable, running client Gemini AI processing for CV optimization...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable (404) and no VITE_GEMINI_API_KEY found. If deployed on Netlify, please add VITE_GEMINI_API_KEY to your Netlify Environment Variables and re-deploy.");
    }

    const userPrompt = jobUrl 
      ? `Optimize CV for job at ${jobUrl}. ${jobDescription || ""}`
      : `Optimize CV for job description: ${jobDescription}`;

    const skillsContext = additionalSkills && additionalSkills.length > 0
      ? `\n\nADDITIONAL CONFIRMED SKILLS TO INCLUDE:\n${additionalSkills.map(s => `- ${s.skill} (Add to: ${s.placement})`).join("\n")}`
      : "";

    const response = await clientAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { text: `SOURCE CV (The Truth): ${JSON.stringify(cv)}` },
          { text: `TARGET JOB: ${userPrompt}${skillsContext}` }
        ]
      },
      config: {
        systemInstruction: `You are an expert recruiter and CV optimization engine. Your goal is to tailor a CV to a specific job description while maintaining absolute integrity.
        
        STRICT RULES:
        1. ABSOLUTE INTEGRITY: Truthfulness is your highest priority. Never invent new roles, companies, dates, or achievements. 
        2. ADDITIONAL SKILLS: You have been provided with a list of 'ADDITIONAL CONFIRMED SKILLS'. The user has confirmed they possess these. You MUST integrate them into the CV as specified (either in the 'skills' section or within the 'highlights' of the specified company/experience).
        3. NO OTHER HALLUCINATIONS: Aside from the 'ADDITIONAL CONFIRMED SKILLS', do NOT add any other skills or tools not present in the SOURCE CV.
        4. EXHAUSTIVE PRESERVATION: You MUST include EVERY experience entry from the SOURCE CV. Do not skip or merge any entries.
        5. STRATEGIC REPHRASING: Use keywords from the TARGET JOB to describe EXISTING experiences from the SOURCE CV.
        6. SELECTIVE EMPHASIS: Prioritize existing points that match the job requirements.
        7. FIELD ISOLATION: Never include dates, locations, or company names within the 'highlights' bullet points.
        8. PRESERVE LINKS: You MUST keep all 'customLinks' from the original CV exactly as they are.
        9. BOLDING: Use Markdown bolding (**text**) for key keywords and metrics that match the job description.
        10. MATCH RATE: Calculate a 'matchRate' (1-10) for the 'original' CV vs the job, and the 'optimized' CV vs the job. Include an 'explanation'.
        11. TITLE: Suggest a title in 'suggestedTitle' as "[Position] - [Company]".
        12. OUTPUT: Return ONLY valid JSON matching the schema. No conversational text.`,
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
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
    console.info("Server API unavailable, running client Gemini AI processing for translation...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable (404) and no VITE_GEMINI_API_KEY found. If deployed on Netlify, please add VITE_GEMINI_API_KEY to your Netlify Environment Variables and re-deploy.");
    }

    const response = await clientAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { text: `Translate CV into ${targetLanguage}.` },
          { text: `CV DATA: ${JSON.stringify(cv)}` }
        ]
      },
      config: {
        systemInstruction: `You are a professional resume translator. Your goal is to translate all text content in the CV into the target language accurately while preserving formatting, bullet points, and proper nouns (company names, school names).
        OUTPUT: Return ONLY valid JSON matching the CV schema. No conversational text.`,
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

