import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import type { CVData, MissingSkill, ATSScanResult } from "../lib/gemini";
import { parseATSFromText, parseATSFromCVData } from "../lib/atsParser";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY environment variable is missing on the server. Please add GEMINI_API_KEY to your environment variables or AI Studio Secrets.");
  }
  return new GoogleGenAI({ apiKey });
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
        original: { type: Type.NUMBER, description: "Match score (1-10) of the original CV" },
        optimized: { type: Type.NUMBER, description: "Match score (1-10) of the optimized CV" },
        explanation: { type: Type.STRING, description: "Brief explanation of the score improvement" },
      },
      required: ["original", "optimized", "explanation"],
    },
    suggestedTitle: {
      type: Type.STRING,
      description: "A suggested title for the CV in the format '[Position] - [Company]'"
    },
  },
  required: ["personalInfo", "summary", "experience", "education", "skills"],
};

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isTimeout = err.message?.includes("timed out");
      const isRpcError = err.message?.includes("Rpc failed") || err.message?.includes("xhr error");
      
      console.warn(`AI call failed (attempt ${i + 1}/${retries})${isTimeout ? " due to timeout" : isRpcError ? " due to RPC error" : ""}:`, err.message);
      
      if (i < retries - 1) {
        const delay = isTimeout ? 5000 : isRpcError ? 1000 : 2000;
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
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
  
  const callAI = async () => {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => {
        reject(new Error("AI request timed out. The file might be too large or complex for a quick scan. Please try again or use a smaller file."));
      }, 180000)
    );

    const apiCallPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            text: "Extract the CV data from the attached document into the specified JSON format. Ensure every field is populated correctly and no meta-commentary is included."
          },
          ...parts
        ]
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
        8. LINK EXTRACTION: Scrape all URLs (LinkedIn, GitHub, Portfolios) and place them in 'customLinks'.`,
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
      },
    });

    const response = await Promise.race([apiCallPromise, timeoutPromise]) as any;

    if (!response.text) {
      throw new Error("Empty AI response");
    }

    try {
      return JSON.parse(cleanJsonString(response.text));
    } catch (e) {
      console.error("JSON Parse Error:", response.text);
      throw new Error("Failed to parse AI response. The document might be too complex or formatted unusually.");
    }
  };

  try {
    const data = await withRetry(callAI, 3);
    return {
      ...data,
      experience: data.experience || [],
      education: data.education || [],
      skills: data.skills || [],
      personalInfo: data.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
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
  
  const callAI = async () => {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("AI request timed out. The text might be too long for a quick analysis. Please try again with a shorter version.")), 180000)
    );

    const apiCallPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [{ text: `Extract CV data from the following text:\n\n${text}` }]
      },
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

    const response = await Promise.race([apiCallPromise, timeoutPromise]) as any;

    if (!response.text) {
      throw new Error("Empty AI response");
    }

    try {
      return JSON.parse(cleanJsonString(response.text));
    } catch (e) {
      console.error("JSON Parse Error:", response.text);
      throw new Error("Failed to parse AI response. Please try again.");
    }
  };

  try {
    const data = await withRetry(callAI, 3);
    return {
      ...data,
      experience: data.experience || [],
      education: data.education || [],
      skills: data.skills || [],
      personalInfo: data.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
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

  const callAI = async () => {
    const userPrompt = jobUrl 
      ? `Identify missing skills for the job at ${jobUrl}. ${jobDescription ? `Additional context: ${jobDescription}` : ""}`
      : `Identify missing skills for this job description: ${jobDescription}`;

    const apiCallPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
        tools: jobUrl ? [{ urlContext: {} }] : undefined,
      },
    });

    const response = await apiCallPromise;
    if (!response.text) throw new Error("Empty response from AI");
    return JSON.parse(cleanJsonString(response.text));
  };

  try {
    return await withRetry(callAI, 2);
  } catch (error) {
    console.error("Error identifying missing skills:", error);
    return [];
  }
}

export async function optimizeCVForJobServer(cv: CVData, jobDescription: string, jobUrl?: string, additionalSkills?: Array<{ skill: string, placement: "skills" | string }>): Promise<CVData> {
  const ai = getAI();

  const callAI = async () => {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => {
        reject(new Error("Optimization request timed out. Please try again."));
      }, 180000)
    );

    const userPrompt = jobUrl 
      ? `Optimize this CV for the job at ${jobUrl}. ${jobDescription ? `Additional context: ${jobDescription}` : ""}`
      : `Optimize this CV for this job description: ${jobDescription}`;

    const skillsContext = additionalSkills && additionalSkills.length > 0
      ? `\n\nADDITIONAL CONFIRMED SKILLS TO INCLUDE:
      ${additionalSkills.map(s => `- ${s.skill} (Add to: ${s.placement})`).join("\n")}`
      : "";

    const apiCallPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
        10. MATCH RATE: Calculate a 'matchRate' (1-10) for the 'original' CV vs the job, and the 'optimized' CV vs the job.
        11. TITLE: Suggest a title in 'suggestedTitle' as "[Position] - [Company]".
        12. OUTPUT: Return ONLY valid JSON matching the schema. No conversational text.`,
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: jobUrl ? [{ urlContext: {} }] : undefined,
      },
    });

    const response = await Promise.race([apiCallPromise, timeoutPromise]) as any;

    if (!response.text) {
      throw new Error("The AI returned an empty response during optimization.");
    }

    try {
      return JSON.parse(cleanJsonString(response.text));
    } catch (e) {
      console.error("JSON Parse Error during optimization:", response.text);
      throw new Error("Failed to parse optimized CV. Please try again.");
    }
  };

  try {
    const result = await withRetry(callAI, 3);
    return {
      ...result,
      experience: result.experience || [],
      education: result.education || [],
      skills: result.skills || [],
      personalInfo: result.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
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

  const callAI = async () => {
    const apiCallPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
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

    const response = await apiCallPromise;

    if (!response.text) {
      throw new Error("The AI returned an empty response during translation.");
    }

    try {
      return JSON.parse(cleanJsonString(response.text));
    } catch (e) {
      console.error("JSON Parse Error during translation:", response.text);
      throw new Error("Failed to parse translated CV.");
    }
  };

  try {
    const result = await withRetry(callAI, 2);
    return {
      ...result,
      experience: result.experience || [],
      education: result.education || [],
      skills: result.skills || [],
      personalInfo: result.personalInfo || { fullName: "", email: "", phone: "", location: "" }
    };
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
