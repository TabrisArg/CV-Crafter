import { GoogleGenAI, Type } from "@google/genai";
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
  targetCompany?: string;
  targetPosition?: string;
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
      description: "Match rate analysis between the CV and the job description",
      properties: {
        original: { type: Type.NUMBER, description: "Honest, realistic match score (1-10) of the original unedited CV based on actual job requirements" },
        optimized: { type: Type.NUMBER, description: "Honest, uninflated match score (1-10) of the optimized CV after tailoring. DO NOT default to 9 or 10 if major qualification gaps exist!" },
        explanation: { type: Type.STRING, description: "Honest, candid breakdown highlighting matched strengths and remaining qualification gaps" },
      },
      required: ["original", "optimized", "explanation"],
    },
    suggestedTitle: { type: Type.STRING },
    targetCompany: { type: Type.STRING, description: "Extracted target company name (e.g. Google, Stripe, Fishlabs GmbH)" },
    targetPosition: { type: Type.STRING, description: "Extracted target job position title (e.g. Senior Producer, Product Manager)" },
  },
  required: ["personalInfo", "summary", "experience", "education", "skills"],
};

const META_KEYWORDS = [
  "cycle date", "logic verification", "standardizing", "fix structure", 
  "highlights accurate", "no escape errors", "ok logic confirmed", "ensure experience",
  "match exactly", "context start/end", "exact strings check", "cycle check",
  "string logic", "structure values", "array fields", "fine context"
];

function isMetaText(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return META_KEYWORDS.some(k => lower.includes(k));
}

function cleanField(val: any, fallback: string = "", maxLength: number = 80): string {
  if (typeof val !== "string") return fallback;
  const trimmed = val.trim();
  if (!trimmed) return fallback;
  if (isMetaText(trimmed)) return fallback;
  if (trimmed.length > maxLength) return fallback;
  return trimmed;
}

function deLoopText(text: string): string {
  if (!text || typeof text !== "string") return "";
  if (isMetaText(text)) return "";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 15) {
    const lowerWords = words.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const uniqueWords = new Set(lowerWords);

    // Discard corrupt LLM token repetition loops with low unique word ratios
    if (uniqueWords.size / lowerWords.length < 0.35) {
      return "";
    }

    // Discard schema filler loops
    const schemaFillerTokens = ["format", "layout", "presentation", "pattern", "setup", "sequence", "valid", "standard", "representation", "retained", "context"];
    const fillerCount = lowerWords.filter(w => schemaFillerTokens.includes(w)).length;
    if (fillerCount / lowerWords.length > 0.25) {
      return "";
    }

    for (let phraseLen = 2; phraseLen <= 10; phraseLen++) {
      let repeatCount = 0;
      let firstPhrase = words.slice(0, phraseLen).join(" ");
      for (let i = phraseLen; i <= words.length - phraseLen; i += phraseLen) {
        if (words.slice(i, i + phraseLen).join(" ") === firstPhrase) {
          repeatCount++;
        } else {
          break;
        }
      }
      if (repeatCount >= 2) {
        return words.slice(0, phraseLen * 2).join(" ") + ".";
      }
    }
  }
  return text;
}

export function repairBrokenMarkdown(text: string): string {
  if (!text || typeof text !== "string") return text || "";

  return text
    .split("\n")
    .map((rawLine) => {
      let line = rawLine;

      // 1. Remove empty bold markers like ****
      line = line.replace(/\*{4,}/g, "");

      // 2. Fix asymmetric triple/double or single/double asterisks around a word or short phrase
      line = line.replace(/(?<!\*)\*{3}(?!\*)([^\s*][^*]*?[^\s*])\*{2}(?!\*)/g, "**$1**");
      line = line.replace(/(?<!\*)\*{2}(?!\*)([^\s*][^*]*?[^\s*])\*{3}(?!\*)/g, "**$1**");
      line = line.replace(/(?<!\*)\*(?!\*)([^\s*][^*]*?[^\s*])\*\*(?!\*)/g, "**$1**");
      line = line.replace(/(?<!\*)\*\*(?!\*)([^\s*][^*]*?[^\s*])\*(?!\*)/g, "**$1**");

      // 3. Fix spaces accidentally placed just inside bold markers: "** word**" or "**word **" -> "**word**"
      line = line.replace(/(^|[\s([{"'])\*\*\s+([^\s*][^*]*?[^\s*])\*\*(?=$|[\s.,;:!?)}\]"'])/g, "$1**$2**");
      line = line.replace(/(^|[\s([{"'])\*\*([^\s*][^*]*?[^\s*])\s+\*\*(?=$|[\s.,;:!?)}\]"'])/g, "$1**$2**");

      // 4. Remove standalone stray ** surrounded by spaces
      line = line.replace(/(?:^|\s)\*\*(?=\s|$)/g, (m) => (m.startsWith(" ") ? " " : ""));

      // 5. Pair up valid ** delimiters and fix orphan closing (word**) or orphan opening (**word)
      interface Marker {
        index: number;
        canOpen: boolean;
        canClose: boolean;
      }

      const findMarkers = (str: string): Marker[] => {
        const list: Marker[] = [];
        for (let i = 0; i < str.length - 1; i++) {
          if (str[i] === "*" && str[i + 1] === "*" && str[i - 1] !== "*" && str[i + 2] !== "*") {
            const prev = i > 0 ? str[i - 1] : "";
            const next = i + 2 < str.length ? str[i + 2] : "";
            const prevIsSpace = !prev || /\s/.test(prev);
            const nextIsSpace = !next || /\s/.test(next);
            const prevIsOpenPunct = /^[([{"'/\-–—]$/.test(prev);
            const nextIsClosePunct = /^[.,;:!?)}\]"'/\-–—%]$/.test(next);

            const canOpen = !nextIsSpace && (prevIsSpace || prevIsOpenPunct);
            const canClose = !prevIsSpace && (nextIsSpace || nextIsClosePunct || !prevIsOpenPunct);
            list.push({ index: i, canOpen, canClose });
            i++; // skip second asterisk
          }
        }
        return list;
      };

      // Iterative repair pass (up to 6 times per line to resolve all orphans cleanly)
      for (let pass = 0; pass < 6; pass++) {
        const markers = findMarkers(line);
        if (markers.length === 0) break;

        let openMarker: Marker | null = null;
        let modified = false;

        for (let mIdx = 0; mIdx < markers.length; mIdx++) {
          const m = markers[mIdx];

          if (!openMarker) {
            if (m.canOpen && !m.canClose) {
              openMarker = m;
            } else if (m.canClose && !m.canOpen) {
              // Orphan closing ** (e.g. "Spearheaded**", "Project Management:**", "microservices**")
              const prefix = line.slice(0, m.index);
              const hasColon = prefix.includes(":") || line[m.index + 2] === ":";
              const isStartColonHeader =
                mIdx === 0 && prefix.length <= 45 && hasColon && !/[.?!]/.test(prefix);

              if (isStartColonHeader) {
                const firstNonSpace = line.search(/\S/);
                const insertPos = firstNonSpace >= 0 ? firstNonSpace : 0;
                line = line.slice(0, insertPos) + "**" + line.slice(insertPos);
              } else {
                // Find the start of the word/token right before this closing **
                let wordStart = m.index;
                while (wordStart > 0 && !/[\s*([{"'/]/.test(line[wordStart - 1])) {
                  wordStart--;
                }
                if (wordStart < m.index) {
                  line = line.slice(0, wordStart) + "**" + line.slice(wordStart);
                } else {
                  // Fallback: remove stray **
                  line = line.slice(0, m.index) + line.slice(m.index + 2);
                }
              }
              modified = true;
              break;
            } else {
              // Ambiguous marker when not open -> treat as opening if followed by another marker, else orphan closing
              if (mIdx + 1 < markers.length) {
                openMarker = m;
              } else {
                let wordStart = m.index;
                while (wordStart > 0 && !/[\s*([{"'/]/.test(line[wordStart - 1])) {
                  wordStart--;
                }
                if (wordStart < m.index) {
                  line = line.slice(0, wordStart) + "**" + line.slice(wordStart);
                } else {
                  line = line.slice(0, m.index) + line.slice(m.index + 2);
                }
                modified = true;
                break;
              }
            }
          } else {
            // We currently have an open ** marker
            if (m.canClose) {
              // Valid pair closed!
              openMarker = null;
            } else if (m.canOpen && !m.canClose) {
              // Hit another opening ** while previous openMarker was never closed!
              // Close the previous openMarker at the end of its word
              let wordEnd = openMarker.index + 2;
              while (wordEnd < line.length && !/[\s*.,;:!?)}\]"'/]/.test(line[wordEnd])) {
                wordEnd++;
              }
              if (wordEnd > openMarker.index + 2) {
                line = line.slice(0, wordEnd) + "**" + line.slice(wordEnd);
              } else {
                line = line.slice(0, openMarker.index) + line.slice(openMarker.index + 2);
              }
              modified = true;
              break;
            }
          }
        }

        if (!modified && openMarker) {
          // Reached end of line with an unclosed opening **
          let wordEnd = openMarker.index + 2;
          while (wordEnd < line.length && !/[\s*.,;:!?)}\]"'/]/.test(line[wordEnd])) {
            wordEnd++;
          }
          if (wordEnd > openMarker.index + 2) {
            line = line.slice(0, wordEnd) + "**" + line.slice(wordEnd);
          } else {
            line = line.slice(0, openMarker.index) + line.slice(openMarker.index + 2);
          }
          modified = true;
        }

        if (!modified) break;
      }

      return line;
    })
    .join("\n");
}

export function fixCorruptedCasing(text: string): string {
  if (!text || typeof text !== "string") return text || "";
  let trimmed = repairBrokenMarkdown(text.trim());
  if (!trimmed) return "";

  // 1. Remove weird prompt-leak suffixes attached to words, e.g., "critical2019" -> "2019" or clean word
  trimmed = trimmed.replace(/\b([a-zA-Z]+)(critical|identify|placement|suggested)\d*\b/gi, "$1");

  // 2. Fix words with corrupted alternating casing or mixed internal capitals
  const words = trimmed.split(/(\s+)/);
  const cleanedWords = words.map(word => {
    if (/^\s+$/.test(word)) return word;
    
    // Skip legitimate technical keywords / acronyms (allowing surrounding markdown * or _)
    const strippedWord = word.trim().replace(/^[*_]+|[*_.,;:!?)]+$/g, "");
    if (/^(JavaScript|TypeScript|DevOps|GraphQL|PostgreSQL|MongoDB|LaTeX|iOS|macOS|PhD|BSc|MSc|MBA|BA|BS|MA|MS|PDF|HTML|CSS|API|APIs|UI|UX|UI\/UX|AI|ML|AWS|GCP|CI\/CD|REST|SQL|Git|GitHub|GitLab|SaaS|PaaS|IaaS|B2B|B2C|Agile|Scrum|Kanban|React|Angular|Vue|Node\.js|Next\.js|Python|C\+\+|C\#|Java|PHP|Ruby|Swift|Kotlin|Go|Rust|Docker|Kubernetes|PowerBI|HubSpot|WordPress|SharePoint|LinkedIn|YouTube|TikTok|PlayStation|Xbox|DirectX|OpenGL|WebGL|FastAPI|PyTorch|TensorFlow|DataBricks|SalesForce|OneDrive|UnrealEngine|GameMaker|Fishlabs|GmbH)$/i.test(strippedWord)) {
      return word;
    }

    const cleanWord = word.replace(/[^a-zA-Z]/g, "");
    
    // Check if word has corrupted internal capitalization (e.g. BachEloR, coMmunIcATiOn, UniVersITy, mIAnI, tEaM, mIdentify, AtTEntIon)
    const hasCorruptedCaps = /[a-z][A-Z]/.test(strippedWord) || /[A-Z]{2,}[a-z]+[A-Z]/.test(strippedWord) || /^[a-z]+[A-Z]/.test(strippedWord);
    
    if (hasCorruptedCaps && cleanWord.length > 2) {
      // Preserve any leading/trailing markdown or punctuation around the letters
      return word.replace(/[a-zA-Z]+/, (alpha) => {
        const lower = alpha.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      });
    }
    return word;
  });

  return cleanedWords.join("");
}

export function formatATSDate(dateStr: string, isEndDate: boolean = false): string {
  if (!dateStr || typeof dateStr !== "string") {
    return isEndDate ? "Present" : "";
  }
  const s = dateStr.trim();
  if (!s) return isEndDate ? "Present" : "";

  const lower = s.toLowerCase();
  if (isEndDate && (lower === "present" || lower === "current" || lower === "now" || lower === "today" || lower === "ongoing")) {
    return "Present";
  }

  const monthsMap: { [key: string]: string } = {
    "01": "January", "1": "January", "jan": "January", "january": "January",
    "02": "February", "2": "February", "feb": "February", "february": "February",
    "03": "March", "3": "March", "mar": "March", "march": "March", "märz": "March",
    "04": "April", "4": "April", "apr": "April", "april": "April",
    "05": "May", "5": "May", "may": "May", "mai": "May",
    "06": "June", "6": "June", "jun": "June", "june": "June", "juni": "June",
    "07": "July", "7": "July", "jul": "July", "july": "July", "juli": "July",
    "08": "August", "8": "August", "aug": "August", "august": "August",
    "09": "September", "9": "September", "sep": "September", "sept": "September", "september": "September",
    "10": "October", "oct": "October", "october": "October", "oktober": "October",
    "11": "November", "nov": "November", "november": "November",
    "12": "December", "dec": "December", "december": "December", "dezember": "December"
  };

  // Match MM/YYYY or MM/YY or YYYY-MM
  let match = s.match(/^(\d{1,2})[\/\-\.](\d{2,4})$/);
  if (match) {
    const m = monthsMap[match[1]];
    let y = match[2];
    if (y.length === 2) y = "20" + y;
    if (m) return `${m} ${y}`;
  }

  match = s.match(/^(\d{4})[\/\-\.](\d{1,2})$/);
  if (match) {
    const m = monthsMap[match[2]];
    let y = match[1];
    if (m) return `${m} ${y}`;
  }

  // Match "Jan 2021", "January 2021", "Jan '21"
  match = s.match(/^([a-zA-Z]+)[\s,']+(\d{2,4})$/);
  if (match) {
    const m = monthsMap[match[1].toLowerCase()];
    let y = match[2];
    if (y.length === 2) y = "20" + y;
    if (m) return `${m} ${y}`;
  }

  if (/^\d{4}$/.test(s)) {
    return s;
  }

  return s;
}

export function cleanSkillName(rawSkill: string): string | null {
  if (!rawSkill || typeof rawSkill !== "string") return null;
  let s = rawSkill.trim();
  
  // Strip leading/trailing bullet markers, hyphens, dashes, quotes, and punctuation
  s = s.replace(/^[\s•\-\*\u2022\u2023\u25E6\u2043\u2219\u2013\u2014"']+|[\s\-\*\u2013\u2014"']+$|\.$/g, "").trim();
  s = s.replace(/^[-–—\s]+/, "").trim();
  
  const lower = s.toLowerCase();
  if (
    !s ||
    s.length < 2 ||
    isMetaText(s) ||
    /^(midentify|identify|missing|placement|suggestedplacement|reason|critical|targetjob|sourcecv|null|undefined|none|n\/a)$/i.test(lower) ||
    lower.includes("additional confirmed skills") ||
    lower.includes("identify missing")
  ) {
    return null;
  }

  // Fix corrupted casing
  s = fixCorruptedCasing(s);

  if (/^(midentify|identify)$/i.test(s.trim())) return null;

  return s;
}

export function normalizeCVData(
  cv: any, 
  sourceCv?: CVData, 
  additionalSkills?: Array<{ skill: string; placement: "skills" | string; company?: string; position?: string }>
): CVData {
  if (!cv || typeof cv !== "object") return cv || sourceCv;

  const personalInfo = {
    fullName: fixCorruptedCasing(cleanField(cv.personalInfo?.fullName, sourceCv?.personalInfo?.fullName || "", 80)),
    email: cleanField(cv.personalInfo?.email, sourceCv?.personalInfo?.email || "", 80),
    phone: cleanField(cv.personalInfo?.phone, sourceCv?.personalInfo?.phone || "", 40),
    location: fixCorruptedCasing(cleanField(cv.personalInfo?.location, sourceCv?.personalInfo?.location || "", 80)),
  };

  let rawSummary = typeof cv.summary === "string" ? cv.summary : "";
  const summary = fixCorruptedCasing(deLoopText(rawSummary) || sourceCv?.summary || "");

  let experienceList = Array.isArray(cv.experience) ? cv.experience : [];

  let experience: Array<{
    company: string;
    position: string;
    location: string;
    startDate: string;
    endDate: string;
    highlights: string[];
  }> = [];

  if (sourceCv && Array.isArray(sourceCv.experience) && sourceCv.experience.length > 0) {
    // Strictly preserve sourceCv experience entry structure (1:1 alignment per job)
    experience = sourceCv.experience.map((srcExp, i) => {
      const matchedExp = experienceList.find((e: any) => 
        (e.company && srcExp.company && e.company.toLowerCase().includes(srcExp.company.toLowerCase())) ||
        (e.position && srcExp.position && e.position.toLowerCase().includes(srcExp.position.toLowerCase()))
      ) || experienceList[i];

      let cleanedHighlights: string[] = [];
      if (matchedExp && matchedExp.highlights) {
        let rawHighlights = Array.isArray(matchedExp.highlights) ? matchedExp.highlights : [matchedExp.highlights];
        rawHighlights.forEach((h: any) => {
          if (typeof h === "string") {
            if (isMetaText(h)) return;
            const deLooped = deLoopText(h);
            if (!deLooped || isMetaText(deLooped)) return;
            let lines = deLooped.split(/(?:\r?\n|•|\u2022|\u2023|\u25E6|\u2043|\u2219|^\s*[-*]\s+)/g);
            lines.forEach((line) => {
              const cleaned = line
                .replace(/^(?:[\s•\-\u2022\u2023\u25E6\u2043\u2219]+|\*(?!\*)\s+)+/, "")
                .replace(/^\d+[\.\)]\s*/, "")
                .trim();
              if (cleaned && cleaned.length > 3 && !isMetaText(cleaned)) {
                cleanedHighlights.push(fixCorruptedCasing(cleaned));
              }
            });
          }
        });
      }

      if (cleanedHighlights.length === 0) {
        cleanedHighlights = [...(srcExp.highlights || [])].map(h => fixCorruptedCasing(h));
      }

      const cleanPosition = fixCorruptedCasing(cleanField(matchedExp?.position, srcExp.position, 80));

      return {
        company: fixCorruptedCasing(cleanField(srcExp.company, "", 100)),
        position: cleanPosition || fixCorruptedCasing(srcExp.position) || "",
        location: fixCorruptedCasing(cleanField(srcExp.location, "", 80)),
        startDate: formatATSDate(cleanField(srcExp.startDate, "", 30), false),
        endDate: formatATSDate(cleanField(srcExp.endDate, "", 30), true),
        highlights: cleanedHighlights,
      };
    });
  } else {
    experience = experienceList.map((exp: any) => {
      let rawHighlights = exp.highlights;
      let cleanedHighlights: string[] = [];

      if (typeof rawHighlights === "string") {
        rawHighlights = [rawHighlights];
      }

      if (Array.isArray(rawHighlights)) {
        rawHighlights.forEach((h: any) => {
          if (typeof h === "string") {
            if (isMetaText(h)) return;
            const deLooped = deLoopText(h);
            if (!deLooped || isMetaText(deLooped)) return;
            let lines = deLooped.split(/(?:\r?\n|•|\u2022|\u2023|\u25E6|\u2043|\u2219|^\s*[-*]\s+)/g);

            if (lines.length === 1 && lines[0].length > 220 && !lines[0].includes("**")) {
              const sentences = lines[0].split(/(?<=[.!?])\s+(?=[A-Z])/);
              if (sentences.length > 1) {
                lines = sentences;
              }
            }

            lines.forEach((line) => {
              const cleaned = line
                .replace(/^(?:[\s•\-\u2022\u2023\u25E6\u2043\u2219]+|\*(?!\*)\s+)+/, "")
                .replace(/^\d+[\.\)]\s*/, "")
                .trim();
              if (cleaned && cleaned.length > 3 && !isMetaText(cleaned)) {
                cleanedHighlights.push(fixCorruptedCasing(cleaned));
              }
            });
          }
        });
      }

      return {
        company: fixCorruptedCasing(cleanField(exp.company, "", 100)),
        position: fixCorruptedCasing(cleanField(exp.position, "", 80)),
        location: fixCorruptedCasing(cleanField(exp.location, "", 80)),
        startDate: formatATSDate(cleanField(exp.startDate, "", 30), false),
        endDate: formatATSDate(cleanField(exp.endDate, "", 30), true),
        highlights: cleanedHighlights,
      };
    });
  }

  // Ensure confirmed skills mapped to an experience role are embedded and bolded in that role's highlights
  if (additionalSkills && Array.isArray(additionalSkills) && additionalSkills.length > 0) {
    additionalSkills.forEach((s) => {
      if (!s.skill || s.placement === "skills") return;
      const targetExp = experience.find((exp) => {
        const placementLower = (s.placement || "").toLowerCase();
        const companyLower = (exp.company || "").toLowerCase();
        const positionLower = (exp.position || "").toLowerCase();
        const sCompanyLower = (s.company || "").toLowerCase();
        const sPositionLower = (s.position || "").toLowerCase();

        return (
          (sCompanyLower && companyLower.includes(sCompanyLower)) ||
          (sPositionLower && positionLower.includes(sPositionLower)) ||
          (placementLower && (placementLower.includes(companyLower) || placementLower.includes(positionLower)))
        );
      });

      if (targetExp) {
        const escapedSkill = s.skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const skillRegex = new RegExp(`\\b${escapedSkill}\\b`, "i");
        
        let found = false;
        targetExp.highlights = targetExp.highlights.map((h) => {
          const match = skillRegex.exec(h);
          if (!match) return h;
          found = true;
          const prefix = h.slice(0, match.index);
          const doubleAsteriskCount = (prefix.match(/\*\*/g) || []).length;
          // If doubleAsteriskCount is odd, the match is already inside a **...** bold span
          if (doubleAsteriskCount % 2 === 1) {
            return repairBrokenMarkdown(h);
          }
          return repairBrokenMarkdown(
            h.slice(0, match.index) + `**${match[0]}**` + h.slice(match.index + match[0].length)
          );
        });

        if (!found) {
          targetExp.highlights.unshift(
            `Leveraged **${s.skill}** to drive key project initiatives, optimize team execution, and deliver high-impact results.`
          );
        }
      }
    });
  }

  // 4. Education
  let education: Array<{
    school: string;
    degree: string;
    location: string;
    graduationDate: string;
  }> = [];

  if (sourceCv && Array.isArray(sourceCv.education) && sourceCv.education.length > 0) {
    // Strictly preserve sourceCv education 1:1 so degree, school name, and dates remain untouched
    education = sourceCv.education.map((srcEdu) => ({
      school: fixCorruptedCasing(srcEdu.school || ""),
      degree: fixCorruptedCasing(srcEdu.degree || ""),
      location: fixCorruptedCasing(srcEdu.location || ""),
      graduationDate: formatATSDate(fixCorruptedCasing(srcEdu.graduationDate || ""), false),
    }));
  } else {
    let rawEducation = Array.isArray(cv.education) ? cv.education : [];
    education = rawEducation.map((edu: any) => ({
      school: fixCorruptedCasing(cleanField(edu.school, "", 100)),
      degree: fixCorruptedCasing(cleanField(edu.degree, "", 100)),
      location: fixCorruptedCasing(cleanField(edu.location, "", 80)),
      graduationDate: formatATSDate(cleanField(edu.graduationDate, "", 40), false),
    })).filter((edu: any) => edu.school || edu.degree);
  }

  // 5. Skills
  let skills: string[] = [];

  const addSkill = (s: any) => {
    if (!s) return;
    let str = "";
    if (typeof s === "string") {
      str = s;
    } else if (typeof s === "object") {
      str = s.name || s.skill || s.title || Object.values(s).filter(v => typeof v === "string").join(", ");
    }
    
    if (!str || typeof str !== "string") return;

    if (str.includes("\n") || (str.includes(",") && !str.includes("http"))) {
      str.split(/[\n,]/).forEach(part => {
        const cleaned = cleanSkillName(part);
        if (cleaned && !skills.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) {
          skills.push(cleaned);
        }
      });
    } else {
      const cleaned = cleanSkillName(str);
      if (cleaned && !skills.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) {
        skills.push(cleaned);
      }
    }
  };

  if (Array.isArray(cv.skills)) {
    cv.skills.forEach(addSkill);
  } else if (typeof cv.skills === "string") {
    addSkill(cv.skills);
  }

  // Ensure base skills from sourceCv are preserved
  if (sourceCv && Array.isArray(sourceCv.skills)) {
    sourceCv.skills.forEach(addSkill);
  }

  const customLinks = Array.isArray(cv.customLinks) && cv.customLinks.length > 0
    ? cv.customLinks
    : (Array.isArray(sourceCv?.customLinks) ? sourceCv.customLinks : []);

  const rawMatchRate = cv.matchRate || sourceCv?.matchRate;
  const matchRate = rawMatchRate && typeof rawMatchRate === "object"
    ? {
        original: typeof rawMatchRate.original === "number" ? Math.min(10, Math.max(1, Math.round(rawMatchRate.original))) : 5,
        optimized: typeof rawMatchRate.optimized === "number" ? Math.min(10, Math.max(1, Math.round(rawMatchRate.optimized))) : 6,
        explanation: typeof rawMatchRate.explanation === "string" ? deLoopText(rawMatchRate.explanation) : "",
      }
    : undefined;

  return {
    ...cv,
    personalInfo,
    summary,
    experience,
    education,
    skills,
    customLinks,
    matchRate,
  };
}

export async function generateCVFromMultimodal(parts: any[]): Promise<CVData> {
  try {
    const res = await apiCall<CVData>("/api/gemini/generate-cv-multimodal", { parts });
    return normalizeCVData(res);
  } catch (error: any) {
    console.info("Server API unavailable, running client Gemini AI processing for multimodal parsing...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable (404) and no VITE_GEMINI_API_KEY found. If deployed on Netlify, please add VITE_GEMINI_API_KEY to your Netlify Environment Variables and re-deploy.");
    }

    const response = await clientAi.models.generateContent({
      model: "gemini-3.7-flash",
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
           - 'highlights' MUST ONLY contain bullet points of achievements/responsibilities. Each bullet point MUST be a separate array element.
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
    return normalizeCVData(data);
  }
}

export async function generateCVFromText(text: string): Promise<CVData> {
  try {
    const res = await apiCall<CVData>("/api/gemini/generate-cv-text", { text });
    return normalizeCVData(res);
  } catch (error: any) {
    console.info("Server API unavailable, running client Gemini AI processing for text parsing...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable (404) and no VITE_GEMINI_API_KEY found. If deployed on Netlify, please add VITE_GEMINI_API_KEY to your Netlify Environment Variables and re-deploy.");
    }

    const response = await clientAi.models.generateContent({
      model: "gemini-3.7-flash",
      contents: { parts: [{ text: `Extract CV data from text:\n\n${text}` }] },
      config: {
        systemInstruction: `You are a high-precision CV parsing engine. Your goal is to convert CV/Resume text into structured JSON.
        
        STRICT OPERATIONAL GUIDELINES:
        1. JSON ONLY: Your entire response must be a single, valid JSON object.
        2. NO META-COMMENTARY: Do not include any notes or conversational text.
        3. EXHAUSTIVE EXTRACTION: Extract EVERY experience and education entry. Do not omit any.
        4. CERTIFICATIONS: Professional certifications (e.g., Scrum Master, PMP, AWS Certified) MUST be placed in the 'education' section, NOT the 'skills' section.
        5. FIELD ISOLATION: Strictly separate dates, locations, and company names from the 'highlights' and 'summary' fields. Move them to their dedicated JSON properties. Each highlight bullet point MUST be a separate string in the array.
        6. BOLDING: Use Markdown bolding (**text**) for key achievements and metrics.
        7. LINKS: Extract all URLs into the 'customLinks' array.`,
        responseMimeType: "application/json",
        responseSchema: CV_SCHEMA,
        temperature: 0.1,
      },
    });
    if (!response.text) throw new Error("Empty AI response");
    const data = JSON.parse(cleanJsonString(response.text));
    return normalizeCVData(data);
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
        model: "gemini-3.7-flash",
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
      const raw = JSON.parse(cleanJsonString(response.text));
      if (Array.isArray(raw)) {
        return raw.map((item: any) => ({
          ...item,
          skill: cleanSkillName(item.skill) || item.skill?.replace(/^[\s•\-\*\u2022\u2023\u25E6\u2043\u2219"']+|["']+$|\.$/g, "").trim(),
        })).filter((item: any) => item.skill && item.skill.length > 1);
      }
      return [];
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
  additionalSkills?: Array<{ skill: string; placement: "skills" | string; company?: string; position?: string }>
): Promise<CVData> {
  try {
    const res = await apiCall<CVData>("/api/gemini/optimize-cv", { cv, jobDescription, jobUrl, additionalSkills });
    return normalizeCVData(res, cv, additionalSkills);
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
      ? `\n\nCRITICAL USER-CONFIRMED SKILL ASSIGNMENTS:
The candidate has explicitly confirmed having real-world experience with the following target skills and specified where each was applied:
${additionalSkills.map(s => `- Skill: "${s.skill}" -> Target Placement: "${s.placement || s.company || "experience"}"`).join("\n")}

MANDATORY INSTRUCTIONS FOR USER-CONFIRMED SKILLS:
1. WORK EXPERIENCE HIGHLIGHTS: For EVERY skill assigned to a specific job position/company above (e.g. "${additionalSkills[0]?.placement || 'a past role'}"), you MUST update that specific role's 'highlights' array in 'experience' by adding or tailoring 1-2 bullet points demonstrating how the candidate applied "${additionalSkills.map(s => s.skill).join(', ')}" in that role.
2. MARKDOWN BOLDING: You MUST bold the skill name in the bullet points (e.g. **Skill Name**) so recruiters and ATS scanners can immediately see the match.
3. DO NOT ONLY ADD TO SUMMARY OR SKILLS LIST: It is a critical failure if a confirmed skill assigned to a work experience role is missing from that role's 'highlights' array in 'experience'.
4. GENERAL SKILLS: Also ensure all confirmed skills are included in the 'skills' list and reinforced in the 'summary' where relevant.`
      : "";

    const response = await clientAi.models.generateContent({
      model: "gemini-3.7-flash",
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

    if (!response.text) throw new Error("Empty response during optimization");
    const result = JSON.parse(cleanJsonString(response.text));
    return normalizeCVData(result, cv, additionalSkills);
  }
}

export async function translateCV(cv: CVData, targetLanguage: string): Promise<CVData> {
  try {
    const res = await apiCall<CVData>("/api/gemini/translate-cv", { cv, targetLanguage });
    return normalizeCVData(res);
  } catch (error: any) {
    console.info("Server API unavailable, running client Gemini AI processing for translation...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable (404) and no VITE_GEMINI_API_KEY found. If deployed on Netlify, please add VITE_GEMINI_API_KEY to your Netlify Environment Variables and re-deploy.");
    }

    const response = await clientAi.models.generateContent({
      model: "gemini-3.7-flash",
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
    return normalizeCVData(result);
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

export function sanitizeCoverLetterText(text: string): string {
  if (!text || typeof text !== "string") return text || "";

  let cleaned = text;

  // 1. Remove all em-dashes (—) and en-dashes (–)
  cleaned = cleaned.replace(/\s*—\s*/g, ", ");
  cleaned = cleaned.replace(/—/g, ", ");
  cleaned = cleaned.replace(/\s*–\s*/g, ", ");
  cleaned = cleaned.replace(/–/g, ", ");

  // 2. Remove artificial AI section headers (e.g. "**Why I'm a Great Fit:**", "### Key Strengths", "**Experience & Value:**")
  cleaned = cleaned.replace(/^(#+|\*\*)\s*(Why I|Key Strengths|My Qualifications|Why [A-Z]|Core Value|Experience &|Background &|Summary of|In Conclusion|Closing Thoughts)[^:\n]*:?\s*(\*\*|\n)?/gmi, "");

  // 3. Remove artificial bullet point bold headers inside paragraphs
  cleaned = cleaned.replace(/^\s*[\*\-•]\s*\*\*[^*]+\*\*:\s*/gm, "• ");

  // 4. Replace common robotic AI intro clichés with natural human phrasing if present
  cleaned = cleaned.replace(/\bI am writing to express my enthusiastic interest in\b/gi, "I am applying for");
  cleaned = cleaned.replace(/\bI am thrilled to apply for\b/gi, "I am excited to submit my application for");
  cleaned = cleaned.replace(/\bIt is with great enthusiasm that I apply\b/gi, "I am applying for");
  cleaned = cleaned.replace(/\ba testament to\b/gi, "evidence of");
  cleaned = cleaned.replace(/\bdelve into\b/gi, "explore");
  cleaned = cleaned.replace(/\bseamlessly\b/gi, "effectively");
  cleaned = cleaned.replace(/\bplethora of\b/gi, "range of");
  cleaned = cleaned.replace(/\bprofoundly\b/gi, "deeply");
  cleaned = cleaned.replace(/\bspearheaded transformational\b/gi, "led key");

  // 5. Clean up any weird double commas, space before punctuation, or double punctuation
  cleaned = cleaned.replace(/,\s*,+/g, ",");
  cleaned = cleaned.replace(/\s+([,\.\?\!])/g, "$1");
  cleaned = cleaned.replace(/,\s*\./g, ".");
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");

  return cleaned.trim();
}

export async function generateCoverLetter(input: CoverLetterInput): Promise<CoverLetterOutput> {
  try {
    return await apiCall<CoverLetterOutput>("/api/gemini/cover-letter", input);
  } catch (error: any) {
    console.info("Server API unavailable, running client fallback for cover letter generation...");
    const clientAi = getClientAI();
    if (!clientAi) {
      throw new Error("Backend API unavailable and no VITE_GEMINI_API_KEY found.");
    }

    const { cv, companyName, jobTitle, jobDescription = "", hiringManager = "", tone = "Professional & Direct" } = input;

    const userPrompt = `CANDIDATE CV DATA:
${JSON.stringify(cv, null, 2)}

TARGET COMPANY & JOB INFORMATION:
- Company Name: ${companyName}
- Target Job Title: ${jobTitle}
- Hiring Manager / Department: ${hiringManager || "Hiring Manager"}
- Writing Tone Style: ${tone}
- Job Description & Details:
${jobDescription || "No specific job description provided."}`;

    const response = await clientAi.models.generateContent({
      model: "gemini-3.7-flash",
      contents: {
        parts: [{ text: userPrompt }]
      },
      config: {
        systemInstruction: `You are a human career strategist. Generate a highly tailored cover letter strictly grounded in the candidate's CV experience matching company ${companyName} and job ${jobTitle}. Tone: ${tone}.
CRITICAL ANTI-AI RULES:
1. NEVER use em-dashes '—' or en-dashes '–'. Use standard commas or colons.
2. Avoid robotic AI buzzwords ('delve', 'testament', 'beacon', 'tapestry', 'synergy', 'plethora', 'profoundly', 'I am thrilled to apply').
3. Do NOT add bold section headers inside the body. Output JSON only.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            coverLetterText: { type: Type.STRING },
            companyName: { type: Type.STRING },
            jobTitle: { type: Type.STRING },
            salutation: { type: Type.STRING },
            keyHighlightsUsed: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["coverLetterText", "companyName", "jobTitle", "salutation", "keyHighlightsUsed"]
        },
        temperature: 0.3,
      }
    });

    if (!response.text) throw new Error("Empty response from AI for cover letter");
    const parsed = JSON.parse(cleanJsonString(response.text));
    if (parsed && typeof parsed.coverLetterText === "string") {
      parsed.coverLetterText = sanitizeCoverLetterText(parsed.coverLetterText);
    }
    if (parsed && Array.isArray(parsed.keyHighlightsUsed)) {
      parsed.keyHighlightsUsed = parsed.keyHighlightsUsed.map((h: string) => sanitizeCoverLetterText(h));
    }
    return parsed;
  }
}


export async function scanCVForATSFromCVData(cv: CVData): Promise<ATSScanResult> {
  return parseATSFromCVData(cv);
}

