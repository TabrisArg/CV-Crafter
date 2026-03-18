import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { diffWords } from "diff";
import { 
  Plus, 
  FileText, 
  Layout, 
  Download, 
  Save, 
  Trash2, 
  ChevronRight, 
  Briefcase, 
  GraduationCap, 
  User, 
  Wand2, 
  LogOut,
  Settings,
  Eye,
  Edit3,
  CheckCircle2,
  Sparkles,
  Cloud,
  FileUp,
  X,
  AlertCircle,
  Copy,
  RefreshCw,
  Check
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { generateCVFromText, optimizeCVForJob, type CVData, generateCVFromMultimodal, translateCV, identifyMissingSkills, type MissingSkill } from "./lib/gemini";
import mammoth from "mammoth";
import { exportToSelectablePDF, exportForPlatforms } from "./lib/pdfExport";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import ReactMarkdown from "react-markdown";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface CV {
  id: string;
  title: string;
  content: CVData;
  template: string;
  updated_at: string;
  parent_id?: string;
}

interface UserProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

const BACKEND_URL = ""; // Use relative paths for Netlify proxying
console.log(`[DEBUG] Backend URL: ${BACKEND_URL || "Relative (Netlify Proxy)"}`);

const DiffText = ({ oldText, newText, className }: { oldText?: string, newText?: string, className?: string }) => {
  const components = {
    p: ({children}: any) => <span className="inline">{children}</span>,
    strong: ({children}: any) => <strong className="font-bold text-slate-900">{children}</strong>
  };

  const popupComponents = {
    p: ({children}: any) => <span className="inline text-slate-100">{children}</span>,
    strong: ({children}: any) => <strong className="font-bold text-white shadow-sm">{children}</strong>,
    li: ({children}: any) => <li className="text-slate-100">{children}</li>,
    ul: ({children}: any) => <ul className="list-disc ml-4 text-slate-100">{children}</ul>
  };

  if (!newText) return null;

  // If oldText is undefined, we are not in diff mode, just render normally
  if (oldText === undefined) {
    return (
      <span className={className}>
        <ReactMarkdown components={components}>{newText}</ReactMarkdown>
      </span>
    );
  }

  // Case 1: Pure Addition (Entirely new block in diff mode)
  if (!oldText || oldText.trim() === "") {
    return (
      <span className={cn("relative group inline-block w-full", className)}>
        <span className="text-emerald-600 bg-emerald-50/90 rounded px-1 border border-emerald-200 italic inline-block font-medium">
          <ReactMarkdown components={components}>{newText}</ReactMarkdown>
        </span>
        <span className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-slate-900 text-white text-[11px] p-3 rounded-xl shadow-2xl z-50 min-w-[180px] border border-slate-700 ring-4 ring-black/10">
          <span className="flex items-center gap-2 text-emerald-400 uppercase font-black tracking-widest text-[9px]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>New Addition</span>
          </span>
          <span className="block mt-1 text-slate-300">This content was added to better match the job requirements.</span>
          <span className="absolute -bottom-1.5 left-6 w-3 h-3 bg-slate-900 rotate-45 border-r border-b border-slate-700" />
        </span>
      </span>
    );
  }

  // Case 2: No change
  if (oldText === newText) {
    return (
      <span className={className}>
        <ReactMarkdown components={components}>{newText}</ReactMarkdown>
      </span>
    );
  }
  
  // Case 3: Modification (Granular diff)
  const diff = diffWords(oldText, newText);
  
  return (
    <span className={cn("relative group inline-block w-full", className)}>
      <span className="inline">
        {diff.map((part, index) => {
          if (part.added) {
            // Check if it's a modification (adjacent to a removal) or a pure addition within text
            const isModification = diff[index - 1]?.removed || diff[index + 1]?.removed;
            
            return (
              <span 
                key={index} 
                className={cn(
                  "rounded px-0.5 border italic font-medium mx-0.5",
                  isModification 
                    ? "text-rose-600 bg-rose-50/90 border-rose-200" 
                    : "text-emerald-600 bg-emerald-50/90 border-emerald-200"
                )}
              >
                {part.value}
              </span>
            );
          }
          if (part.removed) return null; // Don't show removed text in main view
          return <span key={index}>{part.value}</span>;
        })}
      </span>
      
      <span className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-slate-900 text-white text-[11px] p-4 rounded-2xl shadow-2xl z-50 min-w-[240px] max-w-sm border border-slate-700 ring-4 ring-black/10">
        <span className="flex items-center gap-2 mb-2 text-indigo-300 uppercase font-black tracking-widest text-[9px]">
          <FileText className="w-3.5 h-3.5" />
          <span>Original Version</span>
        </span>
        <span className="block leading-relaxed text-slate-100 font-medium">
          <ReactMarkdown components={popupComponents}>{oldText}</ReactMarkdown>
        </span>
        <span className="absolute -bottom-1.5 left-6 w-3 h-3 bg-slate-900 rotate-45 border-r border-b border-slate-700" />
      </span>
    </span>
  );
};

const Button = ({ 
  children, 
  className, 
  variant = "primary", 
  size = "md", 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { 
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) => {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
    secondary: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
    outline: "border border-slate-200 text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-rose-500 text-white hover:bg-rose-600 shadow-sm",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button 
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    className={cn(
      "w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
      className
    )}
    {...props}
  />
);

const TextArea = ({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea 
    className={cn(
      "w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all min-h-[100px]",
      className
    )}
    {...props}
  />
);

// --- Templates ---

const ModernTemplate = ({ data, oldData }: { data: CVData, oldData?: CVData }) => (
  <div id="cv-preview" className="bg-white p-12 shadow-2xl min-h-[1100px] w-full max-w-[800px] mx-auto text-slate-800 font-sans">
    <header data-pdf-block className="border-b-2 border-indigo-600 pb-6 mb-8">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 leading-tight pt-1">
        <DiffText oldText={oldData?.personalInfo?.fullName} newText={data.personalInfo.fullName} />
      </h1>
      <div className="flex flex-wrap gap-4 mt-3 text-sm text-slate-500">
        <a href={`mailto:${data.personalInfo.email}`} className="hover:text-indigo-600 transition-colors">{data.personalInfo.email}</a>
        <span>{data.personalInfo.phone}</span>
        <span>{data.personalInfo.location}</span>
        {data.customLinks?.filter(link => link.position === "header" || (!link.position && data.linksPlacement === "header"))?.map((link, i) => (
          link.title && link.url && (
            <a key={i} href={link.url.startsWith('http') ? link.url : `https://${link.url}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
              {link.title}
            </a>
          )
        ))}
      </div>
    </header>

    <section data-pdf-block className="mb-8">
      <h2 className="text-lg font-bold uppercase tracking-wider text-indigo-600 mb-3">Professional Summary</h2>
      <div className="text-sm leading-relaxed text-slate-600">
        <DiffText oldText={oldData?.summary} newText={data.summary} />
      </div>
    </section>

    <section className="mb-8">
      <h2 data-pdf-block className="text-lg font-bold uppercase tracking-wider text-indigo-600 mb-4">Experience</h2>
      <div className="space-y-6">
        {data.experience?.map((exp, i) => (
          <div key={i} data-pdf-block>
            <div className="flex justify-between items-baseline">
              <h3 className="font-bold text-slate-900">
                <DiffText oldText={oldData?.experience?.[i]?.position} newText={exp.position} />
              </h3>
              <span className="text-xs font-medium text-slate-400">{exp.startDate} — {exp.endDate}</span>
            </div>
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-sm font-semibold text-slate-700">
                <DiffText oldText={oldData?.experience?.[i]?.company} newText={exp.company} />
              </span>
              <span className="text-xs text-slate-400">{exp.location}</span>
            </div>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
              {exp.highlights?.map((h, j) => (
                <li key={j} className="inline-block w-full">
                  <DiffText oldText={oldData?.experience?.[i]?.highlights?.[j]} newText={h} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>

    <div className="grid grid-cols-2 gap-8">
      <section data-pdf-block>
        <h2 className="text-lg font-bold uppercase tracking-wider text-indigo-600 mb-4">Education</h2>
        <div className="space-y-4">
          {data.education?.map((edu, i) => (
            <div key={i}>
              <h3 className="font-bold text-slate-900 text-sm">
                <DiffText oldText={oldData?.education?.[i]?.degree} newText={edu.degree} />
              </h3>
              <p className="text-sm text-slate-700">
                <DiffText oldText={oldData?.education?.[i]?.school} newText={edu.school} />
              </p>
              <p className="text-xs text-slate-400">{edu.graduationDate}</p>
            </div>
          ))}
        </div>
      </section>
      <section data-pdf-block>
        <h2 className="text-lg font-bold uppercase tracking-wider text-indigo-600 mb-4">Skills</h2>
        <div className="flex flex-wrap gap-2">
          {data.skills?.map((skill, i) => {
            const isNew = oldData && !oldData.skills?.includes(skill);
            return (
              <span 
                key={i} 
                className={cn(
                  "px-2 py-1 rounded text-xs font-medium transition-all",
                  isNew 
                    ? "bg-emerald-100 text-emerald-700 border border-emerald-200 italic shadow-sm" 
                    : "bg-slate-100 text-slate-700"
                )}
              >
                {skill}
                {isNew && <Sparkles className="w-3 h-3 inline ml-1 animate-pulse" />}
              </span>
            );
          })}
        </div>
      </section>
    </div>

    {data.customLinks?.some(link => link.position === "bottom" || (!link.position && data.linksPlacement === "bottom")) && (
      <section data-pdf-block className="mt-8 pt-8 border-t border-slate-100">
        <h2 className="text-lg font-bold uppercase tracking-wider text-indigo-600 mb-4">Links</h2>
        <div className="flex flex-wrap gap-6">
          {data.customLinks?.filter(link => link.position === "bottom" || (!link.position && data.linksPlacement === "bottom"))?.map((link, i) => (
            link.title && link.url && (
              <a key={i} href={link.url.startsWith('http') ? link.url : `https://${link.url}`} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline font-medium">
                {link.title}
              </a>
            )
          ))}
        </div>
      </section>
    )}
  </div>
);

const MinimalTemplate = ({ data, oldData }: { data: CVData, oldData?: CVData }) => (
  <div id="cv-preview" className="bg-white p-16 shadow-2xl min-h-[1100px] w-full max-w-[800px] mx-auto text-slate-900 font-sans">
    <div data-pdf-block className="text-center mb-12">
      <h1 className="text-5xl font-light tracking-tighter mb-4 leading-tight pt-2">
        <DiffText oldText={oldData?.personalInfo?.fullName} newText={data.personalInfo.fullName} />
      </h1>
      <div className="flex justify-center flex-wrap gap-x-4 gap-y-2 text-xs uppercase tracking-widest text-slate-500">
        <a href={`mailto:${data.personalInfo.email}`} className="hover:text-indigo-600 transition-colors">{data.personalInfo.email}</a>
        <span>•</span>
        <span>{data.personalInfo.phone}</span>
        <span>•</span>
        <span>{data.personalInfo.location}</span>
        {data.customLinks?.filter(link => link.position === "header" || (!link.position && data.linksPlacement === "header"))?.map((link, i) => (
          link.title && link.url && (
            <React.Fragment key={i}>
              <span>•</span>
              <a href={link.url.startsWith('http') ? link.url : `https://${link.url}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                {link.title}
              </a>
            </React.Fragment>
          )
        ))}
      </div>
    </div>

    <div className="max-w-2xl mx-auto">
      <section data-pdf-block className="mb-12">
        <div className="italic text-lg text-slate-600 leading-relaxed text-center">
          <DiffText oldText={oldData?.summary} newText={data.summary} />
        </div>
      </section>

      <section className="mb-12">
        <h2 data-pdf-block className="text-xs font-bold uppercase tracking-[0.2em] border-b border-slate-200 pb-2 mb-6">Experience</h2>
        <div className="space-y-10">
          {data.experience?.map((exp, i) => (
            <div key={i} data-pdf-block>
              <div className="flex justify-between items-baseline mb-1">
                <h3 className="text-lg font-medium">
                  <DiffText oldText={oldData?.experience?.[i]?.company} newText={exp.company} />
                </h3>
                <span className="text-xs italic text-slate-400">{exp.startDate} — {exp.endDate}</span>
              </div>
              <p className="text-sm font-bold text-slate-500 mb-3 uppercase tracking-wide">
                <DiffText oldText={oldData?.experience?.[i]?.position} newText={exp.position} />
              </p>
              <ul className="space-y-2">
                {exp.highlights?.map((h, j) => (
                  <li key={j} className="text-sm text-slate-600 leading-relaxed flex gap-3">
                    <span className="text-slate-300">•</span>
                    <div className="inline">
                      <DiffText oldText={oldData?.experience?.[i]?.highlights?.[j]} newText={h} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-12">
        <section data-pdf-block>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] border-b border-slate-200 pb-2 mb-6">Education</h2>
          <div className="space-y-6">
            {data.education?.map((edu, i) => (
              <div key={i}>
                <h3 className="text-sm font-medium">
                  <DiffText oldText={oldData?.education?.[i]?.school} newText={edu.school} />
                </h3>
                <p className="text-xs text-slate-500">
                  <DiffText oldText={oldData?.education?.[i]?.degree} newText={edu.degree} />
                </p>
                <p className="text-[10px] italic text-slate-400">{edu.graduationDate}</p>
              </div>
            ))}
          </div>
        </section>
        <section data-pdf-block>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] border-b border-slate-200 pb-2 mb-6">Expertise</h2>
          <div className="grid grid-cols-1 gap-y-1">
            {data.skills?.map((skill, i) => {
              const isNew = oldData && !oldData.skills?.includes(skill);
              return (
                <span 
                  key={i} 
                  className={cn(
                    "text-sm transition-all",
                    isNew ? "text-emerald-600 font-medium italic" : "text-slate-600"
                  )}
                >
                  {skill}
                  {isNew && <Sparkles className="w-3 h-3 inline ml-1 text-emerald-400" />}
                </span>
              );
            })}
          </div>
        </section>
      </div>

      {data.customLinks?.some(link => link.position === "bottom" || (!link.position && data.linksPlacement === "bottom")) && (
        <section data-pdf-block className="mt-12">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] border-b border-slate-200 pb-2 mb-6">Links</h2>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {data.customLinks?.filter(link => link.position === "bottom" || (!link.position && data.linksPlacement === "bottom"))?.map((link, i) => (
              link.title && link.url && (
                <a key={i} href={link.url.startsWith('http') ? link.url : `https://${link.url}`} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline">
                  {link.title}
                </a>
              )
            ))}
          </div>
        </section>
      )}
    </div>
  </div>
);

// --- Main App ---

const LOADING_MESSAGES = [
  "Reading your document...",
  "Performing high-fidelity OCR...",
  "Analyzing your professional experience...",
  "Scraping job requirements...",
  "Analyzing job description...",
  "Matching your skills to the role...",
  "Optimizing for ATS compatibility...",
  "Crafting a powerful summary...",
  "Polishing the final layout...",
  "Large files or URLs may take up to 3 minutes...",
  "Almost there, finalizing details..."
];

export default function App() {
  const [view, setView] = useState<"dashboard" | "editor" | "cv-list">("dashboard");
  const [cvs, setCvs] = useState<CV[]>([]);
  const [currentCv, setCurrentCv] = useState<CV | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isIdentifyingSkills, setIsIdentifyingSkills] = useState(false);
  const [missingSkills, setMissingSkills] = useState<MissingSkill[]>([]);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [currentSkillIndex, setCurrentSkillIndex] = useState(0);
  const [confirmedSkills, setConfirmedSkills] = useState<Array<{ skill: string, placement: "skills" | string }>>([]);
  const [selectingExperienceFor, setSelectingExperienceFor] = useState<string | null>(null);

  const [rawText, setRawText] = useState("");
  const [jobDesc, setJobDesc] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [optimizeTab, setOptimizeTab] = useState<"manual" | "link">("manual");
  const [showJobModal, setShowJobModal] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState("modern");
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [pendingOptimizedCv, setPendingOptimizedCv] = useState<CV | null>(null);
  const [isDiffMode, setIsDiffMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("English");
  const [isTranslating, setIsTranslating] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: "success" | "error" } | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const copyToClipboardATS = () => {
    const data = isDiffMode && pendingOptimizedCv ? pendingOptimizedCv.content : currentCv?.content;
    if (!data) return;

    let text = `${data.personalInfo.fullName.toUpperCase()}\n`;
    text += `${data.personalInfo.email} | ${data.personalInfo.phone} | ${data.personalInfo.location}\n\n`;
    
    if (data.summary) {
      text += `PROFESSIONAL SUMMARY\n${data.summary}\n\n`;
    }

    if (data.experience?.length > 0) {
      text += `PROFESSIONAL EXPERIENCE\n`;
      data.experience.forEach(exp => {
        text += `${exp.company}\n`;
        text += `${exp.position} | ${exp.startDate} - ${exp.endDate}\n`;
        if (exp.location) text += `${exp.location}\n`;
        exp.highlights.forEach(h => {
          text += `- ${h.replace(/\*\*/g, "")}\n`;
        });
        text += `\n`;
      });
    }

    if (data.education?.length > 0) {
      text += `EDUCATION\n`;
      data.education.forEach(edu => {
        text += `${edu.school}\n`;
        text += `${edu.degree} | ${edu.graduationDate}\n`;
        if (edu.location) text += `${edu.location}\n`;
        text += `\n`;
      });
    }

    if (data.skills?.length > 0) {
      text += `SKILLS\n${data.skills.join(", ")}\n`;
    }

    navigator.clipboard.writeText(text).then(() => {
      showToast("ATS-friendly text copied to clipboard!");
    }).catch(err => {
      console.error("Failed to copy:", err);
      showToast("Failed to copy to clipboard", "error");
    });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (currentCv) {
      setActiveTemplate(currentCv.template || "modern");
    }
  }, [currentCv?.id]);

  const playChime = () => {
    const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
    audio.volume = 0.5;
    audio.play().catch(e => console.log("Audio play failed", e));
  };

  useEffect(() => {
    let interval: any;
    if (isGenerating || isOptimizing) {
      let i = 0;
      setLoadingMessage(LOADING_MESSAGES[0]);
      interval = setInterval(() => {
        i = (i + 1) % LOADING_MESSAGES.length;
        setLoadingMessage(LOADING_MESSAGES[i]);
      }, 3000);
    } else {
      setLoadingMessage("");
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating, isOptimizing]);

  const generateId = () => {
    try {
      return crypto.randomUUID();
    } catch (e) {
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
  };

  useEffect(() => {
    fetchCvs();
  }, []);

  const fetchCvs = async () => {
    const localCvsStr = localStorage.getItem("cv_crafter_cvs");
    let localCvs: CV[] = [];
    if (localCvsStr) {
      try {
        localCvs = JSON.parse(localCvsStr);
      } catch (e) {
        console.error("Failed to parse local CVs:", e);
      }
    }
    
    localCvs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    setCvs(localCvs);
  };

  const saveCvsLocally = async (updatedCvs: CV[]) => {
    localStorage.setItem("cv_crafter_cvs", JSON.stringify(updatedCvs));
    setCvs(updatedCvs);
  };

  const handleCreateNew = async () => {
    const newCv: CV = {
      id: generateId(),
      title: "Untitled CV",
      content: {
        personalInfo: { fullName: "", email: "", phone: "", location: "" },
        summary: "",
        experience: [],
        education: [],
        skills: [],
      },
      template: "modern",
      updated_at: new Date().toISOString(),
    };
    
    const updatedCvs = [newCv, ...cvs];
    await saveCvsLocally(updatedCvs);
    setCurrentCv(newCv);
    setView("editor");
  };

  const handleGenerate = async () => {
    if (isGenerating || (!rawText.trim() && !uploadedFile)) return;
    
    setIsGenerating(true);
    setError(null);
    console.log("Starting CV generation process...");
    
    try {
      let content: CVData;
      
      if (uploadedFile) {
        if (uploadedFile.size > 15 * 1024 * 1024) {
          throw new Error("File is too large (max 15MB). Please try a smaller file or paste the text manually.");
        }
        
        const fileType = uploadedFile.type;
        const fileName = uploadedFile.name.toLowerCase();
        
        if (fileName.endsWith(".txt")) {
          const text = await uploadedFile.text();
          content = await generateCVFromText(text);
        } else if (fileName.endsWith(".docx") || fileName.endsWith(".doc")) {
          const arrayBuffer = await uploadedFile.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          content = await generateCVFromText(result.value);
        } else {
          // Handle PDF, Images, etc. via Multimodal Gemini
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.onerror = () => reject(new Error("Failed to read the uploaded file."));
            reader.readAsDataURL(uploadedFile);
          });
          
          content = await generateCVFromMultimodal([
            {
              inlineData: {
                data: base64,
                mimeType: fileType || "application/pdf"
              }
            }
          ]);
        }
      } else {
        content = await generateCVFromText(rawText);
      }

      console.log("CV generation successful");
      
      const newCv: CV = {
        id: generateId(),
        title: content.personalInfo?.fullName || "Untitled CV",
        content,
        template: "modern",
        updated_at: new Date().toISOString(),
      };
      
      const updatedCvs = [newCv, ...cvs];
      await saveCvsLocally(updatedCvs);
      playChime();

      setCurrentCv(newCv);
      setView("editor");
      setRawText("");
      setUploadedFile(null);
    } catch (err: any) {
      console.error("CV Generation failed:", err);
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const runFinalOptimization = async (additionalSkills: Array<{ skill: string, placement: "skills" | string }>) => {
    if (!currentCv) return;
    setIsOptimizing(true);
    setError(null);
    try {
      const optimized = await optimizeCVForJob(
        currentCv.content, 
        jobDesc, 
        optimizeTab === "link" ? jobUrl : undefined,
        additionalSkills
      );
      
      // Force preserve ALL original custom links
      const originalLinks = currentCv.content.customLinks || [];
      const aiLinks = optimized.customLinks || [];
      
      // Merge: keep original links and add any new ones the AI might have found
      const mergedLinks = [...originalLinks];
      aiLinks.forEach(aiLink => {
        // Only add if URL is truly new
        if (!mergedLinks.some(l => l.url?.toLowerCase() === aiLink.url?.toLowerCase())) {
          mergedLinks.push({
            ...aiLink,
            position: aiLink.position || currentCv.content.linksPlacement || "header"
          });
        }
      });
      
      optimized.customLinks = mergedLinks;
      optimized.linksPlacement = currentCv.content.linksPlacement || "header";

      const baseName = currentCv.content.personalInfo?.fullName || currentCv.title.split(" - ")[0];
      const newTitle = optimized.suggestedTitle 
        ? `${optimized.suggestedTitle.replace(" - ", " at ")} - ${baseName}`
        : `Optimized - ${baseName}`;

      const newCv: CV = {
        id: generateId(),
        title: newTitle,
        content: optimized,
        template: currentCv.template,
        updated_at: new Date().toISOString(),
        parent_id: currentCv.parent_id || currentCv.id, // Link to the base CV
      };
      
      setPendingOptimizedCv(newCv);
      setIsDiffMode(true);
      setShowJobModal(false);
      setShowSkillsModal(false);
      setJobDesc("");
      setJobUrl("");
      playChime();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to optimize CV. Please try again.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleOptimize = async () => {
    if ((optimizeTab === "manual" && !jobDesc.trim()) || (optimizeTab === "link" && !jobUrl.trim()) || !currentCv) return;
    
    setIsIdentifyingSkills(true);
    setError(null);
    try {
      const missing = await identifyMissingSkills(currentCv.content, jobDesc, optimizeTab === "link" ? jobUrl : undefined);
      if (missing && missing.length > 0) {
        setMissingSkills(missing);
        setCurrentSkillIndex(0);
        setConfirmedSkills([]);
        setShowSkillsModal(true);
        setShowJobModal(false);
      } else {
        // No missing skills, proceed to direct optimization
        await runFinalOptimization([]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to analyze job requirements. Please try again.");
      // Fallback to standard optimization if identification fails
      await runFinalOptimization([]);
    } finally {
      setIsIdentifyingSkills(false);
    }
  };

  const handleCommitOptimization = async () => {
    if (!pendingOptimizedCv) return;
    setIsSaving(true);
    try {
      const updatedCvs = [pendingOptimizedCv, ...cvs.filter(c => c.id !== pendingOptimizedCv.id)];
      await saveCvsLocally(updatedCvs);
      
      setCurrentCv(pendingOptimizedCv);
      setPendingOptimizedCv(null);
      setIsDiffMode(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setError("Failed to save optimized CV.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardOptimization = () => {
    setPendingOptimizedCv(null);
    setIsDiffMode(false);
  };

  // Auto-save effect
  useEffect(() => {
    if (!currentCv || view !== "editor") return;

    const timer = setTimeout(async () => {
      setIsSaving(true);
      try {
        const now = new Date().toISOString();
        const cvToSave = { ...currentCv, updated_at: now };
        
        const updatedCvs = [...cvs];
        const index = updatedCvs.findIndex(c => c.id === cvToSave.id);
        if (index >= 0) {
          updatedCvs[index] = cvToSave;
        } else {
          updatedCvs.unshift(cvToSave);
        }
        
        await saveCvsLocally(updatedCvs);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } catch (err) {
        console.error("Auto-save failed:", err);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timer);
  }, [currentCv?.content, currentCv?.title, currentCv?.template]);

  const handleSave = async () => {
    if (!currentCv) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const cvToSave = { ...currentCv, updated_at: now };
      
      const updatedCvs = [...cvs];
      const index = updatedCvs.findIndex(c => c.id === cvToSave.id);
      if (index >= 0) {
        updatedCvs[index] = cvToSave;
      } else {
        updatedCvs.unshift(cvToSave);
      }
      
      await saveCvsLocally(updatedCvs);
      setCurrentCv(cvToSave);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setError("Failed to save CV.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const updatedCvs = cvs.filter(c => c.id !== id);
    await saveCvsLocally(updatedCvs);
  };

  const handleDownload = async (mode: "standard" | "platform" = "standard") => {
    let dataToExport = isDiffMode && pendingOptimizedCv ? pendingOptimizedCv.content : currentCv?.content;
    if (!dataToExport) return;

    if (selectedLanguage !== "English") {
      setIsTranslating(true);
      showToast(`Translating CV to ${selectedLanguage}...`);
      try {
        dataToExport = await translateCV(dataToExport, selectedLanguage);
      } catch (err: any) {
        showToast(err.message || "Translation failed", "error");
        setIsTranslating(false);
        return;
      } finally {
        setIsTranslating(false);
      }
    }
    
    // Construct a descriptive filename
    let filename = "";
    const name = dataToExport.personalInfo.fullName || "CV";
    
    if (dataToExport.suggestedTitle) {
      // Format: "Software Engineer - Google - John Doe"
      filename = `${dataToExport.suggestedTitle} - ${name}`;
    } else {
      // Fallback to CV title or default
      filename = isDiffMode && pendingOptimizedCv ? pendingOptimizedCv.title : currentCv?.title || name;
    }

    if (selectedLanguage !== "English") {
      filename = `${filename} (${selectedLanguage})`;
    }
    
    // Clean filename for OS compatibility (remove characters that are invalid in filenames)
    const cleanFilename = filename.replace(/[/\\?%*:|"<>]/g, '-').trim();
    
    if (mode === "platform") {
      exportForPlatforms(dataToExport, cleanFilename);
    } else {
      // Use the new selectable PDF export for ATS compatibility
      exportToSelectablePDF(dataToExport, cleanFilename, activeTemplate);
    }
  };

  if (view === "cv-list") {
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => setView("dashboard")}>
                <ChevronRight className="w-4 h-4 rotate-180 mr-2" />
                Back to Dashboard
              </Button>
              <div className="h-6 w-px bg-slate-200 mx-2" />
              <span className="font-bold text-xl tracking-tight">My Saved CVs</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 rounded-full border border-indigo-100">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-indigo-900">{cvs.length} Resumes</span>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-12">
          <header className="mb-12">
            <h1 className="text-4xl font-bold tracking-tight mb-2">Your Resume Library</h1>
            <p className="text-slate-500">Manage, edit, and optimize all your professional versions.</p>
          </header>

          <div className="space-y-20">
            {(() => {
              const baseCvs = cvs.filter(cv => !cv.parent_id || !cvs.some(c => c.id === cv.parent_id));
              
              if (baseCvs.length === 0 && cvs.length > 0) {
                // If we have CVs but no base CVs (orphans), treat them all as base CVs to avoid an empty library
                return cvs.map((cv) => (
                  <div key={cv.id} className="flex flex-col gap-8">
                    <div className="flex items-center gap-4">
                      <div className="h-px flex-1 bg-slate-200" />
                      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">CV: {cv.content.personalInfo?.fullName || cv.title}</h2>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                    <div className="flex flex-col lg:flex-row gap-10 items-start">
                      <div className="w-full lg:w-[380px] shrink-0">
                        <motion.div 
                          whileHover={{ y: -4 }}
                          className="bg-white border-2 border-indigo-100 rounded-3xl p-8 flex flex-col gap-6 shadow-xl hover:shadow-2xl transition-all relative overflow-hidden group"
                        >
                          <div className="flex justify-between items-start">
                            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                              <FileText className="text-indigo-600 w-7 h-7" />
                            </div>
                            <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDelete(cv.id)}>
                              <Trash2 className="w-5 h-5 text-rose-500" />
                            </Button>
                          </div>
                          <div>
                            <h3 className="font-black text-2xl mb-2 tracking-tight text-slate-900 leading-tight">{cv.title}</h3>
                            <div className="flex items-center gap-2 text-slate-400">
                              <p className="text-xs font-medium uppercase tracking-wider">Updated {new Date(cv.updated_at).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="pt-4">
                            <Button variant="outline" className="w-full py-6 text-lg rounded-2xl border-2 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-all" onClick={() => { setCurrentCv(cv); setView("editor"); }}>
                              <Eye className="w-5 h-5 mr-3" />
                              View & Edit
                            </Button>
                          </div>
                        </motion.div>
                      </div>
                    </div>
                  </div>
                ));
              }

              if (baseCvs.length === 0) {
                return (
                  <div className="py-20 text-center bg-white border border-dashed border-slate-200 rounded-3xl">
                    <FileText className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-slate-400">No CVs saved yet</h3>
                    <p className="text-slate-400 mb-6">Start by creating one from the dashboard.</p>
                    <Button variant="outline" onClick={() => setView("dashboard")}>Go to Dashboard</Button>
                  </div>
                );
              }

              return baseCvs.map((baseCv) => {
                const optimized = cvs.filter(cv => cv.parent_id === baseCv.id);
                return (
                  <div key={baseCv.id} className="flex flex-col gap-8">
                    <div className="flex items-center gap-4">
                      <div className="h-px flex-1 bg-slate-200" />
                      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Base: {baseCv.content.personalInfo?.fullName || baseCv.title}</h2>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                    
                    <div className="flex flex-col lg:flex-row gap-10 items-start">
                      {/* Base CV Card - Large */}
                      <div className="w-full lg:w-[380px] shrink-0">
                        <motion.div 
                          whileHover={{ y: -4 }}
                          className="bg-white border-2 border-indigo-100 rounded-3xl p-8 flex flex-col gap-6 shadow-xl hover:shadow-2xl transition-all relative overflow-hidden group"
                        >
                          <div className="absolute top-0 right-0 px-4 py-1.5 bg-indigo-600 text-[10px] font-black text-white uppercase tracking-[0.2em] rounded-bl-2xl shadow-lg">
                            Base CV
                          </div>
                          <div className="flex justify-between items-start">
                            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                              <FileText className="text-indigo-600 w-7 h-7" />
                            </div>
                            <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDelete(baseCv.id)}>
                              <Trash2 className="w-5 h-5 text-rose-500" />
                            </Button>
                          </div>
                          <div>
                            <h3 className="font-black text-2xl mb-2 tracking-tight text-slate-900 leading-tight">{baseCv.title}</h3>
                            <div className="flex items-center gap-2 text-slate-400">
                              <p className="text-xs font-medium uppercase tracking-wider">Updated {new Date(baseCv.updated_at).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="pt-4">
                            <Button variant="outline" className="w-full py-6 text-lg rounded-2xl border-2 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-all" onClick={() => { setCurrentCv(baseCv); setView("editor"); }}>
                              <Eye className="w-5 h-5 mr-3" />
                              View & Edit
                            </Button>
                          </div>
                        </motion.div>
                      </div>

                      {/* Optimized CVs - Grid of smaller cards */}
                      <div className="flex-1 w-full">
                        {optimized.length > 0 ? (
                          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
                            {optimized.map((optCv) => (
                              <motion.div 
                                key={optCv.id}
                                whileHover={{ scale: 1.02, y: -2 }}
                                className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-lg transition-all relative overflow-hidden group aspect-square justify-between"
                              >
                                <div className="absolute top-0 right-0 px-2 py-1 bg-emerald-500 text-[8px] font-black text-white uppercase tracking-widest rounded-bl-lg">
                                  Optimized
                                </div>
                                
                                <div className="flex justify-between items-start">
                                  <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                                    <Wand2 className="text-emerald-600 w-5 h-5" />
                                  </div>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDelete(optCv.id)}>
                                    <Trash2 className="w-4 h-4 text-rose-500" />
                                  </Button>
                                </div>

                                <div className="space-y-1">
                                  <h3 className="font-bold text-sm text-slate-900 line-clamp-2 leading-snug">{optCv.title}</h3>
                                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter italic">
                                    {new Date(optCv.updated_at).toLocaleDateString()}
                                  </p>
                                </div>

                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="w-full text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded-lg py-2 border border-transparent hover:border-indigo-100"
                                  onClick={() => { setCurrentCv(optCv); setView("editor"); }}
                                >
                                  <Eye className="w-3 h-3 mr-2" />
                                  Open
                                </Button>
                              </motion.div>
                            ))}
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center py-12 bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl">
                            <div className="text-center">
                              <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No optimizations yet</p>
                              <Button variant="ghost" size="sm" className="mt-2 text-indigo-600" onClick={() => { setCurrentCv(baseCv); setView("editor"); }}>
                                Tailor this CV
                                <ChevronRight className="w-4 h-4 ml-1" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </main>
      </div>
    );
  }

  if (view === "dashboard") {
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <FileText className="text-white w-5 h-5" />
              </div>
              <span className="font-bold text-xl tracking-tight">CV Craft AI</span>
            </div>
            <div className="flex items-center gap-4">
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-12">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 p-4 bg-rose-50 border border-rose-200 text-rose-600 rounded-2xl flex items-center gap-3"
            >
              <Trash2 className="w-5 h-5" />
              <span className="text-sm font-medium">{error}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setError(null)}>Dismiss</Button>
            </motion.div>
          )}
          <header className="mb-12 flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight mb-2">Welcome Back</h1>
              <p className="text-slate-500">What would you like to build today?</p>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Create New Card */}
            <motion.div 
              whileHover={{ y: -4 }}
              className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
              onClick={handleCreateNew}
            >
              <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                <Plus className="text-indigo-600 group-hover:text-white w-6 h-6" />
              </div>
              <div className="text-center">
                <h3 className="font-bold mb-1">Create from scratch</h3>
                <p className="text-sm text-slate-400">Start with a blank template</p>
              </div>
              <Button onClick={handleCreateNew} className="mt-2">Start Building</Button>
            </motion.div>

            {/* AI Generation Card */}
            <motion.div 
              whileHover={{ y: -4 }}
              className="bg-indigo-600 rounded-2xl p-8 text-white flex flex-col gap-4 shadow-xl shadow-indigo-200"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-200" />
                  <h3 className="font-bold">AI Quick Generate</h3>
                </div>
                {uploadedFile && (
                  <button 
                    onClick={() => setUploadedFile(null)}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-sm text-indigo-100">Paste your raw experience text or upload a file (PDF, Word, TXT, Image).</p>
              
              {!uploadedFile ? (
                <div className="space-y-3">
                  <TextArea 
                    placeholder="Paste your experience here..." 
                    className="bg-indigo-700/50 border-indigo-500/50 text-white placeholder:text-indigo-300/70 text-xs min-h-[120px]"
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-indigo-500/30" />
                    <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">OR</span>
                    <div className="h-px flex-1 bg-indigo-500/30" />
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.psd"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setUploadedFile(file);
                    }}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3 border-2 border-dashed border-indigo-400/50 rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-all group"
                  >
                    <FileUp className="w-6 h-6 text-indigo-300 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-indigo-200">Upload CV File</span>
                  </button>
                </div>
              ) : (
                <div className="bg-white/10 rounded-xl p-4 border border-white/20 flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                    <FileText className="w-6 h-6 text-indigo-200" />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-bold truncate">{uploadedFile.name}</p>
                    <p className="text-[10px] text-indigo-300">{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
              )}

              <Button 
                variant="secondary" 
                className="w-full bg-white text-indigo-600 hover:bg-indigo-50"
                onClick={(e) => {
                  e.preventDefault();
                  handleGenerate();
                }}
                disabled={isGenerating || (!rawText.trim() && !uploadedFile)}
              >
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      <span>Generating...</span>
                    </div>
                    <span className="text-[10px] font-normal opacity-70">{loadingMessage}</span>
                  </div>
                ) : "Generate CV"}
              </Button>
            </motion.div>

            {/* My Saved CVs Entry Card */}
            <motion.div 
              whileHover={{ y: -4 }}
              className="bg-white border border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
              onClick={() => setView("cv-list")}
            >
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                <FileText className="text-slate-600 group-hover:text-white w-6 h-6" />
              </div>
              <div className="text-center">
                <h3 className="font-bold mb-1">My Saved CVs</h3>
                <p className="text-sm text-slate-400">{cvs.length} resumes saved</p>
              </div>
              <Button variant="outline" onClick={() => setView("cv-list")} className="mt-2">View Library</Button>
            </motion.div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900">
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={cn(
              "fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[100] flex items-center gap-3",
              toast.type === "success" ? "bg-slate-900 text-white" : "bg-rose-600 text-white"
            )}
          >
            {toast.type === "success" ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-sm font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Header */}
      <nav className="bg-white border-b border-slate-200 px-6 h-16 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setView("cv-list")}>
            <Layout className="w-4 h-4 mr-2" />
            My CVs
          </Button>
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <Input 
            value={currentCv?.title} 
            onChange={(e) => currentCv && setCurrentCv({ ...currentCv, title: e.target.value })}
            className="border-none font-bold text-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500/10 rounded-lg w-64"
          />
          <span className="text-[10px] font-bold bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded uppercase tracking-wider">v1.1</span>
        </div>
        <div className="flex items-center gap-3">
          {currentCv?.updated_at && (
            <span className="text-xs text-slate-400 mr-2">
              Last saved {new Date(currentCv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {!currentCv?.parent_id && (
            <Button variant="outline" onClick={() => setShowJobModal(true)}>
              <Wand2 className="w-4 h-4 mr-2 text-indigo-600" />
              Optimize for Job
            </Button>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 min-w-[100px] justify-center">
            {isSaving ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                >
                  <Save className="w-3.5 h-3.5 text-slate-400" />
                </motion.div>
                <span className="text-xs text-slate-500 font-medium">Saving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs text-emerald-600 font-medium">Saved</span>
              </>
            )}
          </div>
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <div className="relative" ref={exportMenuRef}>
            <Button onClick={() => setShowExportMenu(!showExportMenu)}>
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
            
            <AnimatePresence>
              {showExportMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 p-2 z-50 overflow-hidden"
                >
                  <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Language</span>
                    <div className="flex gap-1">
                      {["English", "Spanish"].map((lang) => (
                        <button
                          key={lang}
                          onClick={() => setSelectedLanguage(lang)}
                          className={clsx(
                            "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                            selectedLanguage === lang 
                              ? "bg-indigo-100 text-indigo-700" 
                              : "text-slate-500 hover:bg-slate-100"
                          )}
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      handleDownload("standard");
                      setShowExportMenu(false);
                    }}
                    disabled={isTranslating}
                    className="w-full flex flex-col gap-1 p-3 hover:bg-slate-50 rounded-xl transition-colors text-left group disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <Layout className="w-4 h-4 text-indigo-600" />
                      <span className="text-sm font-bold text-slate-900">Standard Export</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">High-fidelity, visually polished CV. Best for direct emailing or human review.</p>
                  </button>
                  
                  <div className="h-px bg-slate-100 my-1 mx-2" />
                  
                  <button 
                    onClick={() => {
                      handleDownload("platform");
                      setShowExportMenu(false);
                      showToast("Generating platform-optimized PDF...");
                    }}
                    disabled={isTranslating}
                    className="w-full flex flex-col gap-1 p-3 hover:bg-indigo-50 rounded-xl transition-colors text-left group disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      <span className="text-sm font-bold text-slate-900">Export for Platforms</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">ATS-optimized structure. Best for Workday, Greenhouse, and automated portals.</p>
                    <div className="mt-1 flex gap-1">
                      <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-black uppercase rounded tracking-widest">Workday Ready</span>
                    </div>
                  </button>

                  <div className="h-px bg-slate-100 my-1 mx-2" />

                  <button 
                    onClick={() => {
                      copyToClipboardATS();
                      setShowExportMenu(false);
                    }}
                    className="w-full flex flex-col gap-1 p-3 hover:bg-slate-50 rounded-xl transition-colors text-left group"
                  >
                    <div className="flex items-center gap-2">
                      <Copy className="w-4 h-4 text-slate-600" />
                      <span className="text-sm font-bold text-slate-900">Copy ATS Text</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">Copy plain text optimized for manual pasting into application forms.</p>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="h-6 w-px bg-slate-200 mx-1" />
        </div>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Editor */}
        <aside className={cn(
          "w-96 bg-white border-r border-slate-200 overflow-y-auto p-6 flex flex-col gap-8 transition-all duration-300",
          (isDiffMode || isOptimizing) && "opacity-60 pointer-events-none grayscale-[0.3]"
        )}>
          {(isDiffMode || isOptimizing) && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl mb-2 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2 text-amber-700 mb-1">
                <AlertCircle className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Editor Locked</span>
              </div>
              <p className="text-[10px] text-amber-600 leading-relaxed">
                {isOptimizing 
                  ? "AI is currently tailoring your CV. Please wait..." 
                  : "Reviewing optimization. Keep or Discard changes to resume editing."}
              </p>
            </div>
          )}
          <section>
            <div className="flex items-center gap-2 mb-4 text-slate-400">
              <User className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Personal Info</h3>
            </div>
            <div className="space-y-3">
              <Input 
                placeholder="Full Name" 
                value={currentCv?.content.personalInfo.fullName}
                onChange={(e) => currentCv && setCurrentCv({
                  ...currentCv,
                  content: { ...currentCv.content, personalInfo: { ...currentCv.content.personalInfo, fullName: e.target.value } }
                })}
              />
              <Input 
                placeholder="Email" 
                value={currentCv?.content.personalInfo.email}
                onChange={(e) => currentCv && setCurrentCv({
                  ...currentCv,
                  content: { ...currentCv.content, personalInfo: { ...currentCv.content.personalInfo, email: e.target.value } }
                })}
              />
              <Input 
                placeholder="Phone" 
                value={currentCv?.content.personalInfo.phone}
                onChange={(e) => currentCv && setCurrentCv({
                  ...currentCv,
                  content: { ...currentCv.content, personalInfo: { ...currentCv.content.personalInfo, phone: e.target.value } }
                })}
              />
              <Input 
                placeholder="Location" 
                value={currentCv?.content.personalInfo.location}
                onChange={(e) => currentCv && setCurrentCv({
                  ...currentCv,
                  content: { ...currentCv.content, personalInfo: { ...currentCv.content.personalInfo, location: e.target.value } }
                })}
              />
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4 text-slate-400">
              <FileText className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Summary</h3>
            </div>
            <TextArea 
              value={currentCv?.content.summary}
              onChange={(e) => currentCv && setCurrentCv({
                ...currentCv,
                content: { ...currentCv.content, summary: e.target.value }
              })}
            />
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Sparkles className="w-4 h-4" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Custom Links</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => {
                if (!currentCv) return;
                const newLink = { title: "", url: "" };
                setCurrentCv({
                  ...currentCv,
                  content: { 
                    ...currentCv.content, 
                    customLinks: [...(currentCv.content.customLinks || []), newLink],
                    linksPlacement: currentCv.content.linksPlacement || "header"
                  }
                });
              }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="space-y-3">
              {currentCv?.content.customLinks?.map((link, i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2 relative group">
                  <button 
                    onClick={() => {
                      const newLinks = [...(currentCv.content.customLinks || [])];
                      newLinks.splice(i, 1);
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, customLinks: newLinks } });
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="Link Title (e.g. Portfolio)" 
                      value={link.title}
                      className="h-8 text-xs flex-1"
                      onChange={(e) => {
                        const newLinks = [...(currentCv.content.customLinks || [])];
                        newLinks[i] = { ...newLinks[i], title: e.target.value };
                        setCurrentCv({ ...currentCv, content: { ...currentCv.content, customLinks: newLinks } });
                      }}
                    />
                    <div className="flex items-center gap-1 p-0.5 bg-slate-200 rounded-lg h-8">
                      <button 
                        onClick={() => {
                          const newLinks = [...(currentCv.content.customLinks || [])];
                          newLinks[i] = { ...newLinks[i], position: "header" };
                          setCurrentCv({ ...currentCv, content: { ...currentCv.content, customLinks: newLinks } });
                        }}
                        className={cn(
                          "px-2 h-full text-[9px] font-bold uppercase tracking-tighter rounded-md transition-all",
                          (link.position === "header" || (!link.position && currentCv?.content.linksPlacement === "header")) ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        Top
                      </button>
                      <button 
                        onClick={() => {
                          const newLinks = [...(currentCv.content.customLinks || [])];
                          newLinks[i] = { ...newLinks[i], position: "bottom" };
                          setCurrentCv({ ...currentCv, content: { ...currentCv.content, customLinks: newLinks } });
                        }}
                        className={cn(
                          "px-2 h-full text-[9px] font-bold uppercase tracking-tighter rounded-md transition-all",
                          (link.position === "bottom" || (!link.position && currentCv?.content.linksPlacement === "bottom")) ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        Btm
                      </button>
                    </div>
                  </div>
                  <Input 
                    placeholder="URL (https://...)" 
                    value={link.url}
                    className="h-8 text-xs"
                    onChange={(e) => {
                      const newLinks = [...(currentCv.content.customLinks || [])];
                      newLinks[i] = { ...newLinks[i], url: e.target.value };
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, customLinks: newLinks } });
                    }}
                  />
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Briefcase className="w-4 h-4" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Experience</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => {
                if (!currentCv) return;
                const newExp = { company: "", position: "", location: "", startDate: "", endDate: "", highlights: [""] };
                setCurrentCv({
                  ...currentCv,
                  content: { ...currentCv.content, experience: [...currentCv.content.experience, newExp] }
                });
              }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-6">
              {currentCv?.content.experience?.map((exp, i) => (
                <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3 relative group">
                  <button 
                    onClick={() => {
                      const newExp = [...(currentCv.content.experience || [])];
                      newExp.splice(i, 1);
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <Input 
                    placeholder="Company" 
                    value={exp.company}
                    onChange={(e) => {
                      const newExp = [...(currentCv.content.experience || [])];
                      newExp[i] = { ...newExp[i], company: e.target.value };
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                    }}
                  />
                  <Input 
                    placeholder="Position" 
                    value={exp.position}
                    onChange={(e) => {
                      const newExp = [...(currentCv.content.experience || [])];
                      newExp[i] = { ...newExp[i], position: e.target.value };
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input 
                      placeholder="Start Date" 
                      value={exp.startDate}
                      onChange={(e) => {
                        const newExp = [...(currentCv.content.experience || [])];
                        newExp[i] = { ...newExp[i], startDate: e.target.value };
                        setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                      }}
                    />
                    <Input 
                      placeholder="End Date" 
                      value={exp.endDate}
                      onChange={(e) => {
                        const newExp = [...(currentCv.content.experience || [])];
                        newExp[i] = { ...newExp[i], endDate: e.target.value };
                        setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    {exp.highlights?.map((h, j) => (
                      <div key={j} className="flex gap-2 group/highlight">
                        <Input 
                          placeholder="Highlight" 
                          value={h}
                          className="flex-1"
                          onChange={(e) => {
                            const newExp = [...(currentCv.content.experience || [])];
                            const newHighlights = [...newExp[i].highlights];
                            newHighlights[j] = e.target.value;
                            newExp[i] = { ...newExp[i], highlights: newHighlights };
                            setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                          }}
                        />
                        <button 
                          onClick={() => {
                            const newExp = [...(currentCv.content.experience || [])];
                            const newHighlights = [...newExp[i].highlights];
                            newHighlights.splice(j, 1);
                            newExp[i] = { ...newExp[i], highlights: newHighlights };
                            setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                          }}
                          className="p-1 text-slate-300 hover:text-rose-500 opacity-0 group-hover/highlight:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => {
                      const newExp = [...(currentCv.content.experience || [])];
                      newExp[i] = { ...newExp[i], highlights: [...(newExp[i].highlights || []), ""] };
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, experience: newExp } });
                    }}>Add Highlight</Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-400">
                <GraduationCap className="w-4 h-4" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Education</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => {
                if (!currentCv) return;
                const newEdu = { school: "", degree: "", location: "", graduationDate: "" };
                setCurrentCv({
                  ...currentCv,
                  content: { ...currentCv.content, education: [...(currentCv.content.education || []), newEdu] }
                });
              }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-4">
              {currentCv?.content.education?.map((edu, i) => (
                <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3 relative group">
                  <button 
                    onClick={() => {
                      const newEdu = [...(currentCv.content.education || [])];
                      newEdu.splice(i, 1);
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, education: newEdu } });
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <Input 
                    placeholder="School / University" 
                    value={edu.school}
                    onChange={(e) => {
                      const newEdu = [...(currentCv.content.education || [])];
                      newEdu[i] = { ...newEdu[i], school: e.target.value };
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, education: newEdu } });
                    }}
                  />
                  <Input 
                    placeholder="Degree / Field of Study" 
                    value={edu.degree}
                    onChange={(e) => {
                      const newEdu = [...(currentCv.content.education || [])];
                      newEdu[i] = { ...newEdu[i], degree: e.target.value };
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, education: newEdu } });
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input 
                      placeholder="Location" 
                      value={edu.location}
                      onChange={(e) => {
                        const newEdu = [...(currentCv.content.education || [])];
                        newEdu[i] = { ...newEdu[i], location: e.target.value };
                        setCurrentCv({ ...currentCv, content: { ...currentCv.content, education: newEdu } });
                      }}
                    />
                    <Input 
                      placeholder="Graduation Date" 
                      value={edu.graduationDate}
                      onChange={(e) => {
                        const newEdu = [...(currentCv.content.education || [])];
                        newEdu[i] = { ...newEdu[i], graduationDate: e.target.value };
                        setCurrentCv({ ...currentCv, content: { ...currentCv.content, education: newEdu } });
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-400">
                <CheckCircle2 className="w-4 h-4" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Skills</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => {
                if (!currentCv) return;
                setCurrentCv({
                  ...currentCv,
                  content: { ...currentCv.content, skills: [...(currentCv.content.skills || []), ""] }
                });
              }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {currentCv?.content.skills?.map((skill, i) => (
                <div key={i} className="flex gap-2 group">
                  <Input 
                    placeholder="Skill" 
                    value={skill}
                    className="h-9 text-xs"
                    onChange={(e) => {
                      const newSkills = [...(currentCv.content.skills || [])];
                      newSkills[i] = e.target.value;
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, skills: newSkills } });
                    }}
                  />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-9 w-9 p-0 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      const newSkills = [...(currentCv.content.skills || [])];
                      newSkills.splice(i, 1);
                      setCurrentCv({ ...currentCv, content: { ...currentCv.content, skills: newSkills } });
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => {
                  setActiveTemplate("modern");
                  if (currentCv) setCurrentCv({ ...currentCv, template: "modern" });
                }}
                className={cn(
                  "p-3 rounded-xl border-2 transition-all text-left",
                  activeTemplate === "modern" ? "border-indigo-600 bg-indigo-50" : "border-slate-100 hover:border-slate-200"
                )}
              >
                <div className="w-full aspect-[3/4] bg-slate-200 rounded mb-2" />
                <span className="text-xs font-bold">Modern</span>
              </button>
              <button 
                onClick={() => {
                  setActiveTemplate("minimal");
                  if (currentCv) setCurrentCv({ ...currentCv, template: "minimal" });
                }}
                className={cn(
                  "p-3 rounded-xl border-2 transition-all text-left",
                  activeTemplate === "minimal" ? "border-indigo-600 bg-indigo-50" : "border-slate-100 hover:border-slate-200"
                )}
              >
                <div className="w-full aspect-[3/4] bg-slate-200 rounded mb-2" />
                <span className="text-xs font-bold">Minimal</span>
              </button>
            </div>
          </section>
        </aside>

        {/* Preview Area */}
        <main className="flex-1 overflow-y-auto p-12 bg-slate-100 relative">
          {isDiffMode && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-6 bg-white/95 backdrop-blur-md px-8 py-4 rounded-3xl shadow-2xl border border-indigo-100 min-w-[600px]">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Optimization Preview</span>
                  <span className="text-sm font-bold text-slate-900">Review AI Improvements</span>
                </div>
              </div>
              
              <div className="h-10 w-px bg-slate-200" />
              
              {pendingOptimizedCv?.content.matchRate && (
                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Original Match</span>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-xl font-black text-slate-400">{pendingOptimizedCv.content.matchRate.original}</span>
                      <span className="text-[10px] font-bold text-slate-300">/10</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center relative">
                    <div className="absolute -top-1 -right-1">
                      <Sparkles className="w-3 h-3 text-emerald-500 animate-bounce" />
                    </div>
                    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-tighter">Optimized Match</span>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-2xl font-black text-emerald-600">{pendingOptimizedCv.content.matchRate.optimized}</span>
                      <span className="text-[10px] font-bold text-emerald-300">/10</span>
                    </div>
                  </div>
                  <div className="max-w-[180px] group relative">
                    <p className="text-[10px] text-slate-500 line-clamp-2 leading-tight italic cursor-help">
                      "{pendingOptimizedCv.content.matchRate.explanation}"
                    </p>
                    <div className="absolute top-full left-0 mt-2 hidden group-hover:block bg-slate-900 text-white text-[10px] p-3 rounded-xl shadow-xl z-50 w-64 border border-slate-700">
                      {pendingOptimizedCv.content.matchRate.explanation}
                      <div className="absolute -top-1 left-4 w-2 h-2 bg-slate-900 rotate-45" />
                    </div>
                  </div>
                </div>
              )}

              <div className="h-10 w-px bg-slate-200" />
              
              <div className="flex gap-3">
                <Button size="sm" variant="outline" className="rounded-xl px-5" onClick={handleDiscardOptimization}>Discard</Button>
                <Button size="sm" variant="primary" className="rounded-xl px-5 shadow-lg shadow-indigo-200" onClick={handleCommitOptimization}>Commit Changes</Button>
              </div>
            </div>
          )}
          <div className="max-w-[800px] mx-auto">
            {activeTemplate === "modern" ? (
              <ModernTemplate 
                data={isDiffMode && pendingOptimizedCv ? pendingOptimizedCv.content : currentCv!.content} 
                oldData={isDiffMode ? currentCv!.content : undefined}
              />
            ) : (
              <MinimalTemplate 
                data={isDiffMode && pendingOptimizedCv ? pendingOptimizedCv.content : currentCv!.content} 
                oldData={isDiffMode ? currentCv!.content : undefined}
              />
            )}
          </div>
        </main>
      </div>

      {/* Optimization Modal */}
      <AnimatePresence>
        {showJobModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowJobModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white rounded-3xl p-8 w-full max-w-xl shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center">
                  <Wand2 className="text-indigo-600 w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Optimize for Job</h2>
                  <p className="text-slate-500 text-sm">Tailor your CV to a specific job post.</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl mb-6">
                <button 
                  onClick={() => setOptimizeTab("manual")}
                  className={cn(
                    "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                    optimizeTab === "manual" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Manual Description
                </button>
                <button 
                  onClick={() => setOptimizeTab("link")}
                  className={cn(
                    "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                    optimizeTab === "link" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Job Post Link
                </button>
              </div>
              
              {optimizeTab === "manual" ? (
                <TextArea 
                  placeholder="Paste job description here..." 
                  className="min-h-[250px] mb-6"
                  value={jobDesc}
                  onChange={(e) => setJobDesc(e.target.value)}
                />
              ) : (
                <div className="space-y-4 mb-6">
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                    </div>
                    <p className="text-xs text-indigo-700 leading-relaxed">
                      Paste the link to the job posting (LinkedIn, Indeed, etc.) and our AI will extract the key requirements for you.
                    </p>
                  </div>
                  <Input 
                    placeholder="https://www.linkedin.com/jobs/view/..." 
                    className="h-12 px-4 rounded-xl"
                    value={jobUrl}
                    onChange={(e) => setJobUrl(e.target.value)}
                  />
                  <TextArea 
                    placeholder="Any additional context? (optional)" 
                    className="min-h-[120px]"
                    value={jobDesc}
                    onChange={(e) => setJobDesc(e.target.value)}
                  />
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-xs font-medium flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowJobModal(false)}>Cancel</Button>
                <Button 
                  variant="primary" 
                  className="flex-1" 
                  onClick={handleOptimize}
                  disabled={isOptimizing || isIdentifyingSkills || (optimizeTab === "manual" ? !jobDesc.trim() : !jobUrl.trim())}
                >
                  {isOptimizing || isIdentifyingSkills ? (
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        >
                          <Wand2 className="w-4 h-4" />
                        </motion.div>
                        <span>{isIdentifyingSkills ? "Analyzing Job..." : "Optimizing..."}</span>
                      </div>
                      <span className="text-[10px] font-normal opacity-70">{loadingMessage}</span>
                    </div>
                  ) : "Optimize Now"}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Skills Check Modal */}
      <AnimatePresence>
        {showSkillsModal && missingSkills.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <CheckCircle2 className="text-emerald-600 w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Skill Verification</h2>
                    <p className="text-slate-500 text-xs">Step {currentSkillIndex + 1} of {missingSkills.length}</p>
                  </div>
                </div>
                <button onClick={() => setShowSkillsModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-8">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 mb-4">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 block">Missing Skill</span>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{missingSkills[currentSkillIndex].skill}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed italic">
                    "{missingSkills[currentSkillIndex].reason}"
                  </p>
                </div>

                <p className="text-sm font-medium text-slate-700 mb-4">Do you have experience with this skill?</p>
                
                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    variant="outline" 
                    className="h-12 rounded-xl border-slate-200 hover:bg-slate-50"
                    onClick={() => {
                      if (currentSkillIndex < missingSkills.length - 1) {
                        setCurrentSkillIndex(prev => prev + 1);
                      } else {
                        setShowSkillsModal(false);
                        runFinalOptimization(confirmedSkills);
                      }
                    }}
                  >
                    No, skip it
                  </Button>
                  <Button 
                    variant="primary" 
                    className="h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-100"
                    onClick={() => {
                      const skill = missingSkills[currentSkillIndex];
                      if (skill.suggestedPlacement === "experience" && currentCv?.content.experience.length) {
                        setSelectingExperienceFor(skill.skill);
                      } else {
                        const newConfirmed = [...confirmedSkills, { skill: skill.skill, placement: "skills" }];
                        setConfirmedSkills(newConfirmed);
                        if (currentSkillIndex < missingSkills.length - 1) {
                          setCurrentSkillIndex(prev => prev + 1);
                        } else {
                          setShowSkillsModal(false);
                          runFinalOptimization(newConfirmed);
                        }
                      }
                    }}
                  >
                    Yes, I have it
                  </Button>
                </div>
              </div>

              {/* Experience Selection Overlay */}
              <AnimatePresence>
                {selectingExperienceFor && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute inset-0 bg-white rounded-3xl p-8 flex flex-col z-10"
                  >
                    <h3 className="text-lg font-bold mb-2">Where did you use this?</h3>
                    <p className="text-slate-500 text-sm mb-6">Select the position where you used **{selectingExperienceFor}**.</p>
                    
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                      {currentCv?.content.experience.map((exp, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            const newConfirmed = [...confirmedSkills, { skill: selectingExperienceFor, placement: exp.company }];
                            setConfirmedSkills(newConfirmed);
                            setSelectingExperienceFor(null);
                            if (currentSkillIndex < missingSkills.length - 1) {
                              setCurrentSkillIndex(prev => prev + 1);
                            } else {
                              setShowSkillsModal(false);
                              runFinalOptimization(newConfirmed);
                            }
                          }}
                          className="w-full p-4 text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 rounded-2xl transition-all group"
                        >
                          <div className="font-bold text-slate-900 group-hover:text-indigo-700">{exp.position}</div>
                          <div className="text-xs text-slate-500">{exp.company}</div>
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          const newConfirmed = [...confirmedSkills, { skill: selectingExperienceFor, placement: "skills" }];
                          setConfirmedSkills(newConfirmed);
                          setSelectingExperienceFor(null);
                          if (currentSkillIndex < missingSkills.length - 1) {
                            setCurrentSkillIndex(prev => prev + 1);
                          } else {
                            setShowSkillsModal(false);
                            runFinalOptimization(newConfirmed);
                          }
                        }}
                        className="w-full p-4 text-left bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 rounded-2xl transition-all group"
                      >
                        <div className="font-bold text-slate-900 group-hover:text-indigo-700">Just add to Skills section</div>
                        <div className="text-xs text-slate-500">General list</div>
                      </button>
                    </div>
                    
                    <Button 
                      variant="ghost" 
                      className="mt-4"
                      onClick={() => setSelectingExperienceFor(null)}
                    >
                      Back
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-center gap-1 mt-4">
                {missingSkills.map((_, i) => (
                  <div 
                    key={i} 
                    className={cn(
                      "h-1 rounded-full transition-all",
                      i === currentSkillIndex ? "w-4 bg-indigo-600" : "w-1 bg-slate-200"
                    )} 
                  />
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
