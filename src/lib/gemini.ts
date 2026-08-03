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

async function apiCall<T>(endpoint: string, body: any): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Server request failed");
  }
  return data as T;
}

export async function generateCVFromMultimodal(parts: any[]): Promise<CVData> {
  return apiCall<CVData>("/api/gemini/generate-cv-multimodal", { parts });
}

export async function generateCVFromText(text: string): Promise<CVData> {
  return apiCall<CVData>("/api/gemini/generate-cv-text", { text });
}

export async function identifyMissingSkills(cv: CVData, jobDescription: string, jobUrl?: string): Promise<MissingSkill[]> {
  try {
    return await apiCall<MissingSkill[]>("/api/gemini/identify-missing-skills", { cv, jobDescription, jobUrl });
  } catch (error) {
    console.error("Error identifying missing skills:", error);
    return [];
  }
}

export async function optimizeCVForJob(
  cv: CVData,
  jobDescription: string,
  jobUrl?: string,
  additionalSkills?: Array<{ skill: string; placement: "skills" | string }>
): Promise<CVData> {
  return apiCall<CVData>("/api/gemini/optimize-cv", { cv, jobDescription, jobUrl, additionalSkills });
}

export async function translateCV(cv: CVData, targetLanguage: string): Promise<CVData> {
  return apiCall<CVData>("/api/gemini/translate-cv", { cv, targetLanguage });
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
