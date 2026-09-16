import { GoogleGenAI, Type } from "@google/genai";
import type { CVData, MissingSkill, ATSScanResult } from "../lib/gemini";
import { normalizeCVData, sanitizeCoverLetterText } from "../lib/gemini";
import { parseATSFromText, parseATSFromCVData } from "../lib/atsParser";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY environment variable is missing on the server. Please add GEMINI_API_KEY to your environment variables or AI Studio Secrets.");
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

const CV_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    personalInfo: {
      type: Type.OBJECT,
      description: "Basic contact information of the candidate",
      properties: {
        fullName: { type: Type.STRING, description: "Full name of the person" },
        email: { type: Type.STRING, description: "Email address" },
        phone: { type: Type.STRING, description: "Phone number" },
        location: { type: Type.STRING, description: "City, Country or Remote" },
      },
      required: ["fullName"],
    },
    summary: { 
      type: Type.STRING, 
      description: "A concise professional summary (3-5 sentences). DO NOT include any notes, meta-comments, or other JSON fields here." 
    },
    experience: {
      type: Type.ARRAY,
      description: "List of professional work experiences",
      items: {
        type: Type.OBJECT,
        properties: {
          company: { type: Type.STRING },
          position: { type: Type.STRING },
          location: { type: Type.STRING },
          startDate: { type: Type.STRING },
          endDate: { type: Type.STRING },
          highlights: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Bullet points of achievements and responsibilities. DO NOT include dates, locations, or company names here."
          },
        },
      },
    },
    education: {
      type: Type.ARRAY,
      description: "Academic background and professional certifications/licenses",
      items: {
        type: Type.OBJECT,
        properties: {
          school: { type: Type.STRING, description: "School, University, or Issuing Organization" },
          degree: { type: Type.STRING, description: "Degree, Diploma, or Certification Name" },
          location: { type: Type.STRING },
          graduationDate: { type: Type.STRING, description: "Graduation or Completion Date" },
        },
      },
    },
    skills: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "List of technical and soft skills"
    },
    customLinks: {
      type: Type.ARRAY,
      description: "Social media, portfolios, or personal website links",
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "e.g., LinkedIn, Portfolio" },
          url: { type: Type.STRING },
          position: { type: Type.STRING, enum: ["header", "bottom"], description: "Where to display the link" },
        },
      },
    },
    matchRate: {
      type: Type.OBJECT,
      description: "Match rate analysis between the CV and the job description",
      properties: {
        original: { type: Type.NUMBER, description: "Honest, realistic match score (1-10) of the original unedited CV based on actual job requirements" },
        optimized: { type: Type.NUMBER, description: "Honest, uninflated match score (1-10) of the optimized CV after tailoring. DO NOT default to 9 or 10 if major qualification gaps exist!" },
        explanation: { type: Type.STRING, description: "Honest, candid breakdown highlighting matched strengths and remaining qualification gaps" },
      },
      required: ["original", "optimized", "explanation"],
    },
    suggestedTitle: {
      type: Type.STRING,
      description: "A suggested title for the CV in the format '[Position] - [Company]'"
    },
    targetCompany: {
      type: Type.STRING,
      description: "Extracted target company name (e.g. Google, Stripe, Fishlabs GmbH)"
    },
    targetPosition: {
      type: Type.STRING,
      description: "Extracted target job position title (e.g. Senior Producer, Product Manager)"
    },
  },
  required: ["personalInfo", "summary", "experience", "education", "skills"],
};

const CANDIDATE_MODELS = [
  "gemini-3.7-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
];

export async function executeGeminiWithFallback<T>(
  fn: (model: string) => Promise<T>,
  options: { retries?: number; timeoutMs?: number; taskName?: string } = {}
): Promise<T> {
  const { retries = 4, timeoutMs = 120000, taskName = "AI operation" } = options;
  let lastError: any;

  for (let i = 0; i < retries; i++) {
    // Rotate candidate models across retries
    const modelIndex = i % CANDIDATE_MODELS.length;
    const currentModel = CANDIDATE_MODELS[modelIndex];

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${taskName} timed out. Please try again.`)),
          timeoutMs
        )
      );

      const executionPromise = fn(currentModel);
      return await Promise.race([executionPromise, timeoutPromise]);
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
      
      const isUnavailableOrHighDemand =
        errMsg.includes("503") ||
        errMsg.includes("UNAVAILABLE") ||
        errMsg.includes("high demand") ||
        errMsg.includes("429") ||
        errMsg.includes("RESOURCE_EXHAUSTED") ||
        errMsg.includes("quota") ||
        errMsg.includes("overloaded");

      const isTimeout = errMsg.includes("timed out");
      const isRpcError =
        errMsg.includes("Rpc failed") ||
        errMsg.includes("xhr error") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("socket hang up");

      console.warn(
        `[AI Engine] ${taskName} attempt ${i + 1}/${retries} failed on model '${currentModel}'${
          isUnavailableOrHighDemand
            ? " (high demand/service unavailable - rotating model)"
            : isTimeout
            ? " (timeout)"
            : isRpcError
            ? " (RPC error)"
            : ""
        }:`,
        errMsg
      );

      if (i < retries - 1) {
        // Backoff with randomized jitter to alleviate concurrent spikes
        const baseDelay = isUnavailableOrHighDemand ? 2000 : isTimeout ? 3000 : 1000;
        const jitter = Math.floor(Math.random() * 600);
        const delay = baseDelay * Math.pow(1.5, i) + jitter;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

function cleanJsonString(str: string): string {
  return str.replace(/```json\n?|```/g, "").trim();
}

export async function generateCVFromMultimodalServer(parts: any[]): Promise<CVData> {
  const ai = getAI();

  try {
    const data = await executeGeminiWithFallback(
      async (model: string) => {
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                text: "Extract the CV data from the attached document into the specified JSON format. Ensure every field is populated correctly and no meta-commentary is included.",
              },
              ...parts,
            ],
          },
          config: {
            systemInstruction: `You are a high-precision CV parsing engine. Your goal is to convert CV/Resume documents into structured JSON.
        
        STRICT OPERATIONAL GUIDELINES:
        1. JSON ONLY: Your entire response must be a single, valid JSON object. No pre-amble, no post-amble, no markdown formatting unless requested within fields.
        2. NO META-COMMENTARY: Never include phrases like "Note:", "I found...", or "The document says...". If a piece of information is missing, leave the field empty or as an empty array.
        3. EXHAUSTIVE EXTRACTION: You MUST extract EVERY work experience entry found in the document. Do not skip any, even if they are short or old.
        4. CERTIFICATIONS: Professional certifications (e.g., Scrum Master, PMP, AWS Certified) MUST be placed in the 'education' section, NOT the 'skills' section. Use the issuing organization as 'school' and the certification name as 'degree'.
        5. FIELD ISOLATION: Strictly separate metadata (Company, Position, Location, Dates) from content (Highlights). 
           - Dates and Locations MUST be placed in their dedicated fields ('startDate', 'endDate', 'location').
           - 'highlights' MUST ONLY contain bullet points of achievements/responsibilities.
           - If a date or location is found within a description, MOVE it to the correct field and REMOVE it from the description.
        6. OCR PRECISION: Use high-fidelity OCR to capture every detail.
        7. BOLDING: Use Markdown bolding (**text**) for key achievements and metrics within 'summary' and 'highlights'.
        8. LINK EXTRACTION: Scrape all URLs (LinkedIn, GitHub, Portfolios) and place them in 'customLinks'.
        
        ATS FORMATTING & COMPLIANCE DIRECTIVES:
        - CONTACT INFO FIRST: Extract personalInfo (fullName, email, phone, location) as the first item.
        - STANDARD SECTIONS: Keep 'summary', 'experience', 'education', 'skills' strictly distinct.
        - CORPORATE ENTITY INDICATORS: Ensure company names include standard suffixes where appropriate (Inc., LLC, Co., Corp., GmbH, Ltd., Group).
        - INTEGRATE SKILLS IN BULLETS: Include technical tools and domain skills directly inside experience bullet points.
        - FLAT EXPERIENCE: Output each position as a separate flat entry with its own company, position, location, and dates.
        - FULL MONTH DATES: Spell out full month names and year (e.g. 'January 2021', 'March 2023'). Use 'Present' or 'Current' for active jobs.
        - UNIFORM JOB FIELD ORDER: Maintain consistent order for every job: position, company, location, startDate, endDate.`,
            responseMimeType: "application/json",
            responseSchema: CV_SCHEMA,
            temperature: 0.1,
          },
        });

        if (!response.text) {
          throw new Error("Empty AI response");
        }

        try {
          return JSON.parse(cleanJsonString(response.text));
        } catch (e) {
          console.error("JSON Parse Error:", response.text);
          throw new Error("Failed to parse AI response. The document might be too complex or formatted unusually.");
        }
      },
      { timeoutMs: 180000, retries: 4, taskName: "CV Multimodal Extraction" }
    );

    return normalizeCVData(data);
  } catch (error: any) {
    console.error("Gemini Multimodal Error:", error);
    if (error.message?.includes("timed out")) {
      throw error;
    }
    throw new Error(error.message || "AI service failed to process the file.");
  }
}
export async function generateCVFromTextServer(text: string): Promise<CVData> {
  const ai = getAI();

  try {
    const data = await executeGeminiWithFallback(
      async (model: string) => {
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [{ text: `Extract CV data from the following text:\n\n${text}` }],
          },
          config: {
            systemInstruction: `You are a high-precision CV parsing engine. Your goal is to convert CV/Resume text into structured JSON.
        
        STRICT OPERATIONAL GUIDELINES:
        1. JSON ONLY: Your entire response must be a single, valid JSON object.
        2. NO META-COMMENTARY: Do not include any notes or conversational text.
        3. EXHAUSTIVE EXTRACTION: Extract EVERY experience and education entry. Do not omit any.
        4. CERTIFICATIONS: Professional certifications (e.g., Scrum Master, PMP, AWS Certified) MUST be placed in the 'education' section, NOT the 'skills' section.
        5. FIELD ISOLATION: Strictly separate dates, locations, and company names from the 'highlights' and 'summary' fields. Move them to their dedicated JSON properties. Each highlight bullet point MUST be a separate array item.
        6. BOLDING: Use Markdown bolding (**text**) for key achievements and metrics.
        7. LINKS: Extract all URLs into the 'customLinks' array.
        
        ATS FORMATTING & COMPLIANCE DIRECTIVES:
        - CONTACT INFO FIRST: Ensure personalInfo (fullName, email, phone, location) is extracted as the top entry.
        - STANDARD SECTIONS: Keep 'summary', 'experience', 'education', 'skills' strictly separate.
        - CORPORATE ENTITY INDICATORS: Ensure company names include standard suffixes where appropriate (Inc., LLC, Co., Corp., GmbH, Ltd., Group).
        - INTEGRATE SKILLS IN BULLETS: Include relevant technical tools and domain skills directly inside experience bullet points.
        - FLAT EXPERIENCE: Output each job position as a flat entry with its own company, position, location, and dates.
        - FULL MONTH DATES: Spell out full month names and year (e.g. 'January 2021', 'March 2023'). Use 'Present' or 'Current' for active jobs.
        - UNIFORM JOB FIELD ORDER: Maintain consistent field structure: position, company, location, startDate, endDate.`,
            responseMimeType: "application/json",
            responseSchema: CV_SCHEMA,
            temperature: 0.1,
          },
        });

        if (!response.text) {
          throw new Error("Empty AI response");
        }

        try {
          return JSON.parse(cleanJsonString(response.text));
        } catch (e) {
          console.error("JSON Parse Error:", response.text);
          throw new Error("Failed to parse AI response. Please try again.");
        }
      },
      { timeoutMs: 180000, retries: 4, taskName: "CV Text Extraction" }
    );

    return normalizeCVData(data);
  } catch (error: any) {
    console.error("Gemini API Error Detail:", error);
    if (error.message?.includes("timed out")) {
      throw error;
    }
    throw new Error(error.message || "AI service is currently slow or unavailable.");
  }
}

export async function identifyMissingSkillsServer(cv: CVData, jobDescription: string, jobUrl?: string): Promise<MissingSkill[]> {
  const ai = getAI();

  try {
    return await executeGeminiWithFallback(
      async (model: string) => {
        const userPrompt = jobUrl
          ? `Identify missing skills for the job at ${jobUrl}. ${jobDescription ? `Additional context: ${jobDescription}` : ""}`
          : `Identify missing skills for this job description: ${jobDescription}`;

        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                text: `CURRENT CV: ${JSON.stringify({
                  skills: cv.skills,
                  experience: cv.experience.map((e) => ({ company: e.company, position: e.position })),
                })}`,
              },
              { text: `TARGET JOB: ${userPrompt}` },
            ],
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
                  suggestedPlacement: { type: Type.STRING, enum: ["skills", "experience"] },
                },
                required: ["skill", "reason", "suggestedPlacement"],
              },
            },
            temperature: 0.1,
          },
        });

        if (!response.text) throw new Error("Empty response from AI");
        const raw = JSON.parse(cleanJsonString(response.text));
        if (Array.isArray(raw)) {
          return raw
            .map((item: any) => ({
              ...item,
              skill: item.skill
                ? item.skill
                    .replace(
                      /^[\s•\-\*\u2022\u2023\u25E6\u2043\u2219\u2013\u2014"']+|[\s\-\*\u2013\u2014"']+$|\.$/g,
                      ""
                    )
                    .replace(/^[-–—\s]+/, "")
                    .trim()
                : "",
            }))
            .filter((item: any) => item.skill && item.skill.length > 1);
        }
        return [];
      },
      { timeoutMs: 60000, retries: 4, taskName: "Identify Missing Skills" }
    );
  } catch (error) {
    console.error("Error identifying missing skills:", error);
    return [];
  }
}

export async function optimizeCVForJobServer(
  cv: CVData, 
  jobDescription: string, 
  jobUrl?: string, 
  additionalSkills?: Array<{ skill: string, placement: "skills" | string; company?: string; position?: string }>
): Promise<CVData> {
  const ai = getAI();

  try {
    const result = await executeGeminiWithFallback(
      async (model: string) => {
        const userPrompt = jobUrl 
          ? `Optimize this CV for the job at ${jobUrl}. ${jobDescription ? `Additional context: ${jobDescription}` : ""}`
          : `Optimize this CV for this job description: ${jobDescription}`;

        const skillsContext = additionalSkills && additionalSkills.length > 0
          ? `\n\nCRITICAL USER-CONFIRMED SKILL ASSIGNMENTS:
The candidate has explicitly confirmed having real-world experience with the following target skills and specified where each was applied:
${additionalSkills.map(s => `- Skill: "${s.skill}" -> Target Placement: "${s.placement || s.company || "experience"}"`).join("\n")}

MANDATORY INSTRUCTIONS FOR USER-CONFIRMED SKILLS:
1. WORK EXPERIENCE HIGHLIGHTS: For EVERY skill assigned to a specific job position/company above (e.g. "${additionalSkills[0]?.placement || 'a past role'}"), you MUST update that specific role's 'highlights' array in 'experience' by adding or tailoring 1-2 bullet points demonstrating how the candidate applied "${additionalSkills.map(s => s.skill).join(', ')}" in that role.
2. MARKDOWN BOLDING: You MUST bold the skill name in the bullet points (e.g. **Skill Name**) so recruiters and ATS scanners can immediately see the match.
3. DO NOT ONLY ADD TO SUMMARY OR SKILLS LIST: It is a critical failure if a confirmed skill assigned to a work experience role is missing from that role's 'highlights' array in 'experience'.
4. GENERAL SKILLS: Also ensure all confirmed skills are included in the 'skills' list and reinforced in the 'summary' where relevant.`
          : "";

        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              { text: `SOURCE CV (The Truth): ${JSON.stringify(cv)}` },
              { text: `TARGET JOB: ${userPrompt}${skillsContext}` }
            ]
          },
          config: {
            systemInstruction: `You are an expert recruiter and CV optimization engine. Your goal is to tailor a candidate's CV to a target job description.

RULES:
1. Preserve all work experience entries from SOURCE CV in 'experience' in the exact same order.
2. For each experience entry, keep 'company', 'position', 'startDate', 'endDate', and 'location' clean and exact (e.g. "Producer", "Fishlabs GmbH", "2023", "Present"). NEVER insert explanation text, validation notes, or internal reasoning into any field!
3. 'highlights' MUST be an array of 3 to 6 separate string bullet points (15-30 words each). Rephrase achievements using target job keywords and Markdown bolding (**keywords**).
   - MANDATORY SKILL INTEGRATION: If the user confirmed applying specific skills at a certain position (see USER-CONFIRMED SKILL ASSIGNMENTS), you MUST explicitly write/update bullet points in that specific position's 'highlights' showcasing that skill in action, with the skill name wrapped in Markdown bolding (e.g., **Skill Name**).
4. Do NOT invent fictional companies or fake jobs. Keep 'customLinks'. Ensure company names end with common corporate suffixes where applicable (e.g., Inc., LLC, Corp., Co., GmbH, Ltd., Group).
5. Include 'education' array containing all degrees, schools, locations, and graduation dates from SOURCE CV.
6. Include 'skills' array containing all relevant technical, soft, and domain skills from SOURCE CV plus additional tailored keywords for the target job and all confirmed skills.
7. Include 'targetCompany' (e.g. "Google") and 'targetPosition' (e.g. "Senior Producer") extracted from the target job posting. If not specified, leave them as empty string "".
8. Include 'matchRate' object with 'original' (1-10 integer score), 'optimized' (1-10 integer score), and an 'explanation'.
   CRITICAL HONEST MATCH SCORING DIRECTIVES:
   - Be brutally honest, objective, and realistic. DO NOT inflate scores or default to 9 or 10!
   - 'original': Evaluate how well the candidate's original unedited CV meets the job requirements before tailoring (1-10 scale). (e.g., 3-6/10 if missing key skills, experience years, or tools).
   - 'optimized': Evaluate fit AFTER rephrasing and highlighting skills. DO NOT default to 9 or 10! If major requirement gaps still remain (e.g. candidate has 2 years experience but job requires 7+, or missing required degrees/certifications/technologies), the optimized score MUST NOT exceed 5/10, 6/10, or 7/10. Only award 8-10/10 if the candidate's actual background and skills genuinely cover almost all core requirements.
   - 'explanation': Provide a candid 1-2 sentence breakdown stating what aligned well, what was improved by tailoring, and what critical skill/qualification gaps still remain.
9. DATES FORMATTING: Spell out full month names and year (e.g. 'January 2021', 'March 2023'). Use 'Present' or 'Current' for active jobs. Never use numeric 'MM/YY' format.
10. UNIFORM JOB ORDER: Maintain flat experience entries with consistent field order: position, company, location, startDate, endDate.
11. Return ONLY valid JSON matching the schema. No conversational text or markdown code fence wrappers.
12. CRITICAL TEXT INTEGRITY RULE: Every word in 'education', 'skills', 'experience', 'summary', and 'personalInfo' MUST be written in clean, standard, natural English spelling and proper casing. NEVER output alternating case letters or corrupted words (e.g. NEVER output 'BachEloR', 'coMmunIcATiOn', 'tEaM', or 'UniVersITy'). Write clean standard terms like 'Bachelor', 'University of Miami', 'Communication', 'Teamwork', 'Attention to Detail'.`,
            responseMimeType: "application/json",
            responseSchema: CV_SCHEMA,
            temperature: 0.2,
          },
        });

        if (!response.text) {
          throw new Error("The AI returned an empty response during optimization.");
        }

        try {
          return JSON.parse(cleanJsonString(response.text));
        } catch (e) {
          console.error("JSON Parse Error during optimization:", response.text);
          throw new Error("Failed to parse optimized CV. Please try again.");
        }
      },
      { timeoutMs: 90000, retries: 4, taskName: "CV Optimization" }
    );

    return normalizeCVData(result, cv, additionalSkills);
  } catch (error: any) {
    console.error("Error optimizing CV:", error);
    if (error.message?.includes("timed out")) {
      throw new Error("Optimization timed out. Try pasting the job description text manually.");
    }
    throw new Error(error.message || "AI optimization failed.");
  }
}

export async function translateCVServer(cv: CVData, targetLanguage: string): Promise<CVData> {
  const ai = getAI();

  try {
    const result = await executeGeminiWithFallback(
      async (model: string) => {
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              { text: `Translate the following CV data into ${targetLanguage}. Maintain the exact same JSON structure.` },
              { text: `CV DATA: ${JSON.stringify(cv)}` }
            ]
          },
          config: {
            systemInstruction: `You are a professional translator specializing in CVs and resumes. 
        Your goal is to translate the provided CV data into the target language while maintaining professional terminology and the exact JSON structure.
        
        STRICT RULES:
        1. JSON ONLY: Your entire response must be a single, valid JSON object.
        2. NO META-COMMENTARY: Do not include any notes or conversational text.
        3. TERMINOLOGY: Use standard professional terminology in the target language (e.g., "Experiencia Laboral" for "Experience" in Spanish).
        4. PRESERVE LINKS: Do NOT translate URLs or link titles unless they are descriptive (e.g., "Portfolio" -> "Portafolio").
        5. BOLDING: Maintain all Markdown bolding (**text**) in the translated text.
        6. OUTPUT: Return ONLY valid JSON matching the schema.`,
            responseMimeType: "application/json",
            responseSchema: CV_SCHEMA,
            temperature: 0.1,
          },
        });

        if (!response.text) {
          throw new Error("The AI returned an empty response during translation.");
        }

        try {
          return JSON.parse(cleanJsonString(response.text));
        } catch (e) {
          console.error("JSON Parse Error during translation:", response.text);
          throw new Error("Failed to parse translated CV.");
        }
      },
      { timeoutMs: 90000, retries: 4, taskName: "CV Translation" }
    );

    return normalizeCVData(result, cv);
  } catch (error: any) {
    console.error("Error translating CV:", error);
    throw new Error(error.message || `AI translation to ${targetLanguage} failed.`);
  }
}

export async function scanCVForATSFromMultimodalServer(parts: any[]): Promise<ATSScanResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.trim() !== "") {
    try {
      const cvData = await generateCVFromMultimodalServer(parts);
      return parseATSFromCVData(cvData);
    } catch (error) {
      console.warn("Gemini Multimodal OCR unavailable/failed, falling back to local ATS parser stream:", error);
    }
  }

  let extractedText = "";
  for (const part of parts) {
    if (part.text) {
      extractedText += part.text + "\n";
    } else if (part.inlineData && part.inlineData.data) {
      try {
        const binaryStr = Buffer.from(part.inlineData.data, "base64").toString("binary");
        const printableText = binaryStr
          .replace(/[^\x20-\x7E\n\r\t]/g, " ")
          .replace(/\s+/g, " ");

        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
        const emails = printableText.match(emailRegex) || [];

        extractedText += (emails.length > 0 ? `Email: ${emails[0]}\n` : "") + printableText + "\n";
      } catch (e) {
        console.warn("Could not decode base64 binary stream for ATS scan:", e);
      }
    }
  }

  if (!extractedText.trim()) {
    extractedText = "CV Document Text Stream\nContact: candidate@example.com\n\nWORK EXPERIENCE\nProfessional Experience";
  }

  return parseATSFromText(extractedText);
}

export interface CoverLetterInput {
  cv: CVData;
  companyName: string;
  jobTitle: string;
  jobDescription?: string;
  hiringManager?: string;
  tone?: string;
}

export interface CoverLetterOutput {
  coverLetterText: string;
  companyName: string;
  jobTitle: string;
  salutation: string;
  keyHighlightsUsed: string[];
}

export async function generateCoverLetterServer(input: CoverLetterInput): Promise<CoverLetterOutput> {
  const { cv, companyName, jobTitle, jobDescription = "", hiringManager = "", tone = "Professional & Direct" } = input;
  const ai = getAI();

  try {
    return await executeGeminiWithFallback(
      async (model: string) => {
        const userPrompt = `CANDIDATE CV DATA:
${JSON.stringify(cv, null, 2)}

COMPANY & JOB TARGET INFORMATION:
- Company Name: ${companyName}
- Target Job Title: ${jobTitle}
- Hiring Manager / Department: ${hiringManager || "Hiring Team"}
- Writing Tone Style: ${tone}
- Job Description & Company Details:
${jobDescription || "No specific job description provided. Align experience based on position title and company name."}`;

        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [{ text: userPrompt }]
          },
          config: {
            systemInstruction: `You are a top-tier career strategist and human copywriter. Your goal is to write a highly tailored, compelling, authentic, and human-sounding cover letter that bridges a candidate's real CV experience with a target company opportunity.

CRITICAL ANTI-AI STYLE & PUNCTUATION RULES:
1. NO EM-DASHES OR EN-DASHES: You MUST NEVER use '—' or '–' anywhere in the letter under any circumstances. Use standard commas, periods, colons, or parentheses for clause separation instead.
2. NO ROBOTIC AI BUZZWORDS & CLICHÉS: Avoid dead giveaway AI words and phrases like 'delve', 'testament', 'beacon', 'tapestry', 'synergy', 'spearheaded transformational', 'plethora', 'profoundly', 'seamlessly', 'I am thrilled to apply', 'fostering', 'game-changer', or 'dynamic landscape'.
3. NO ARTIFICIAL SECTION HEADINGS: Do NOT add bold section headers in the body (e.g., do NOT use '**Why I am a Fit:**' or '**Qualifications:**'). Write fluid, natural human paragraphs.
4. TRUTHFULNESS & GROUNDING: ALL work experience, metrics, past roles, education, and technical skills mentioned MUST be strictly grounded in the candidate's provided CV. Do NOT fabricate experience or metrics.
5. TAILORED OPENING & HOOK: Explicitly reference the Company Name (${companyName}) and Target Job Title (${jobTitle}).
6. CORE VALUE PROPOSITION: Select 2-4 of the candidate's strongest, most relevant achievements or skills from their CV and explain how they directly solve the needs of ${companyName}.
7. TONE: Adapt to the requested tone: "${tone}". Keep language clean, confident, natural, and conversational.
8. FORMAT & STRUCTURE: Write the letter in clean Markdown paragraphs. Include:
   - Candidate Header (Name, Email, Phone, Location from CV)
   - Date (Current date)
   - Recipient Block (Hiring Manager / Team, Company Name)
   - Salutation (e.g., 'Dear ${hiringManager || "Hiring Team at " + companyName},')
   - Body (3-4 concise, impactful paragraphs, ~250-350 words total)
   - Professional Sign-off ('Sincerely,', candidate name)
9. JSON ONLY OUTPUT: Return ONLY a single JSON object matching the schema.`,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                coverLetterText: { type: Type.STRING, description: "Full Markdown formatted text of the cover letter without em-dashes or AI section headers" },
                companyName: { type: Type.STRING, description: "Target company name" },
                jobTitle: { type: Type.STRING, description: "Target position title" },
                salutation: { type: Type.STRING, description: "Opening salutation used" },
                keyHighlightsUsed: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "List of 2-4 key experiences or skills from the CV highlighted in the letter" 
                }
              },
              required: ["coverLetterText", "companyName", "jobTitle", "salutation", "keyHighlightsUsed"]
            },
            temperature: 0.3,
          }
        });

        if (!response.text) throw new Error("Empty response from AI");
        
        const parsed = JSON.parse(cleanJsonString(response.text));
        if (parsed && typeof parsed.coverLetterText === "string") {
          parsed.coverLetterText = sanitizeCoverLetterText(parsed.coverLetterText);
        }
        if (parsed && Array.isArray(parsed.keyHighlightsUsed)) {
          parsed.keyHighlightsUsed = parsed.keyHighlightsUsed.map((h: string) => sanitizeCoverLetterText(h));
        }
        return parsed;
      },
      { timeoutMs: 90000, retries: 4, taskName: "Cover Letter Generation" }
    );
  } catch (error: any) {
    console.error("Error generating cover letter:", error);
    throw new Error(error.message || "Failed to generate cover letter.");
  }
}

