import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  FileUp, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Copy, 
  FileText, 
  Scan, 
  Search, 
  ArrowLeft, 
  Check, 
  ShieldCheck, 
  Cpu, 
  ListChecks, 
  Tag, 
  Wrench, 
  Layers, 
  ChevronRight,
  ExternalLink,
  Edit3
} from "lucide-react";
import mammoth from "mammoth";
import { 
  scanCVForATSFromText, 
  scanCVForATSFromMultimodal, 
  scanCVForATSFromCVData, 
  type ATSScanResult, 
  type CVData 
} from "../lib/gemini";

interface CV {
  id: string;
  title: string;
  content: CVData;
  template: string;
  updated_at: string;
}

interface ATSScannerProps {
  cvs: CV[];
  onBack: () => void;
  onOpenInEditor?: (cvContent: CVData, title?: string) => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

const SCAN_STEPS = [
  "Stripping graphics, layout columns, and styling layers...",
  "Simulating enterprise ATS linear plain-text stream...",
  "Parsing candidate contact entities & email headers...",
  "Auditing standard section headings & date formats...",
  "Indexing technical keywords & skills for recruiter search...",
  "Calculating ATS readability & compatibility score..."
];

export function ATSScanner({ cvs, onBack, onOpenInEditor, showToast }: ATSScannerProps) {
  const [activeInputTab, setActiveInputTab] = useState<"upload" | "library" | "text">("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [selectedCvId, setSelectedCvId] = useState<string>(cvs[0]?.id || "");
  const [isScanning, setIsScanning] = useState(false);
  const [scanStepIndex, setScanStepIndex] = useState(0);
  const [scanResult, setScanResult] = useState<ATSScanResult | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<"overview" | "raw" | "entities" | "sections" | "keywords">("overview");
  const [copiedRaw, setCopiedRaw] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRunScan = async () => {
    setIsScanning(true);
    setScanResult(null);
    setScanStepIndex(0);

    const stepInterval = setInterval(() => {
      setScanStepIndex((prev) => (prev < SCAN_STEPS.length - 1 ? prev + 1 : prev));
    }, 2500);

    try {
      let result: ATSScanResult;

      if (activeInputTab === "upload") {
        if (!uploadedFile) {
          showToast("Please select a file to scan.", "error");
          setIsScanning(false);
          clearInterval(stepInterval);
          return;
        }

        const fileName = uploadedFile.name.toLowerCase();
        if (fileName.endsWith(".txt")) {
          const text = await uploadedFile.text();
          result = await scanCVForATSFromText(text);
        } else if (fileName.endsWith(".docx") || fileName.endsWith(".doc")) {
          const arrayBuffer = await uploadedFile.arrayBuffer();
          const extracted = await mammoth.extractRawText({ arrayBuffer });
          result = await scanCVForATSFromText(extracted.value);
        } else {
          // Multimodal PDF / PNG / JPG / PSD
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = reader.result as string;
              resolve(res.split(",")[1]);
            };
            reader.onerror = () => reject(new Error("Failed to read file."));
            reader.readAsDataURL(uploadedFile);
          });

          result = await scanCVForATSFromMultimodal([
            {
              inlineData: {
                data: base64,
                mimeType: uploadedFile.type || "application/pdf"
              }
            }
          ]);
        }
      } else if (activeInputTab === "library") {
        const targetCv = cvs.find((c) => c.id === selectedCvId);
        if (!targetCv) {
          showToast("Please select a valid CV from your library.", "error");
          setIsScanning(false);
          clearInterval(stepInterval);
          return;
        }
        result = await scanCVForATSFromCVData(targetCv.content);
      } else {
        if (!pastedText.trim()) {
          showToast("Please paste CV text to scan.", "error");
          setIsScanning(false);
          clearInterval(stepInterval);
          return;
        }
        result = await scanCVForATSFromText(pastedText);
      }

      setScanResult(result);
      showToast("ATS CV Scan complete!");
    } catch (err: any) {
      console.error("ATS Scan Error:", err);
      showToast(err.message || "Failed to scan CV. Please try again.", "error");
    } finally {
      clearInterval(stepInterval);
      setIsScanning(false);
    }
  };

  const copyRawText = () => {
    if (!scanResult) return;
    navigator.clipboard.writeText(scanResult.rawExtractedText).then(() => {
      setCopiedRaw(true);
      showToast("ATS raw stream text copied!");
      setTimeout(() => setCopiedRaw(false), 2500);
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (score >= 60) return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-rose-600 bg-rose-50 border-rose-200";
  };

  const getBadgeColor = (status: "pass" | "warn" | "fail") => {
    if (status === "pass") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (status === "warn") return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-rose-100 text-rose-800 border-rose-200";
  };

  const getSeverityIcon = (severity: "critical" | "warning" | "good") => {
    if (severity === "critical") return <XCircle className="w-5 h-5 text-rose-500 shrink-0" />;
    if (severity === "warning") return <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />;
    return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />;
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      {/* Top Navbar */}
      <nav className="border-b border-slate-200 bg-white/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="h-5 w-px bg-slate-200 mx-1" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-100">
                <Scan className="w-4 h-4" />
              </div>
              <span className="font-bold text-lg tracking-tight">ATS / ATO CV Scanner</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Simulates Workday, Taleo, Greenhouse & Lever ATS Parsers</span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 pt-8">
        {/* Header Hero */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-2 flex items-center gap-3">
            How ATS Parsers Read Your CV
          </h1>
          <p className="text-slate-600 max-w-3xl text-sm leading-relaxed">
            Applicant Tracking Systems (ATS / ATO) use automated text extraction engines that strip away layouts, columns, and graphics.
            Scan your resume to view the exact plain-text stream, parsed entities, and formatting audit generated for recruiters.
          </p>
        </div>

        {/* Input Selector Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-8">
          {/* Input Method Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-4 mb-6">
            <button
              onClick={() => setActiveInputTab("upload")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeInputTab === "upload"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <FileUp className="w-4 h-4" />
              Upload CV Document
            </button>

            {cvs.length > 0 && (
              <button
                onClick={() => setActiveInputTab("library")}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeInputTab === "library"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <FileText className="w-4 h-4" />
                Select from Saved CVs ({cvs.length})
              </button>
            )}

            <button
              onClick={() => setActiveInputTab("text")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeInputTab === "text"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <Edit3 className="w-4 h-4" />
              Paste Raw Resume Text
            </button>
          </div>

          {/* Tab Content */}
          {activeInputTab === "upload" && (
            <div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setUploadedFile(file);
                }}
              />
              {!uploadedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer bg-slate-50/50 hover:bg-indigo-50/30 transition-all group"
                >
                  <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <FileUp className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-800">Click to upload your CV file</p>
                    <p className="text-xs text-slate-400 mt-0.5">Supports PDF, DOCX, DOC, TXT, PNG, JPG (max 15MB)</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{uploadedFile.name}</p>
                      <p className="text-xs text-slate-500">{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setUploadedFile(null)}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-800 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 transition-colors"
                  >
                    Change File
                  </button>
                </div>
              )}
            </div>
          )}

          {activeInputTab === "library" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {cvs.map((cv) => {
                const isSelected = selectedCvId === cv.id;
                return (
                  <div
                    key={cv.id}
                    onClick={() => setSelectedCvId(cv.id)}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-3 ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-200"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-slate-600" />
                      </div>
                      {isSelected && <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 line-clamp-1">{cv.title || "Untitled CV"}</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        {cv.content?.personalInfo?.fullName || "No Name"} • {cv.content?.experience?.length || 0} Roles
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeInputTab === "text" && (
            <div>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste the full plain text of your resume here..."
                rows={7}
                className="w-full p-4 rounded-xl border border-slate-200 text-xs font-mono bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Run Scan Action Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleRunScan}
              disabled={
                isScanning ||
                (activeInputTab === "upload" && !uploadedFile) ||
                (activeInputTab === "library" && !selectedCvId) ||
                (activeInputTab === "text" && !pastedText.trim())
              }
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs tracking-wide shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
            >
              {isScanning ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  <span>Scanning with ATS Engine...</span>
                </>
              ) : (
                <>
                  <Scan className="w-4 h-4" />
                  <span>Scan CV Like ATS</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Loading Progress State */}
        {isScanning && (
          <div className="bg-white rounded-2xl border border-indigo-100 p-8 shadow-xl text-center max-w-xl mx-auto my-12">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4 text-indigo-600">
              <Cpu className="w-8 h-8 animate-pulse" />
            </div>
            <h3 className="font-bold text-lg text-slate-900 mb-2">Simulating ATS Document Parser</h3>
            <p className="text-xs font-medium text-indigo-600 mb-6 bg-indigo-50 py-2 px-4 rounded-full inline-block border border-indigo-100">
              {SCAN_STEPS[scanStepIndex]}
            </p>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className="bg-indigo-600 h-full transition-all duration-500 ease-out"
                style={{ width: `${((scanStepIndex + 1) / SCAN_STEPS.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Scan Results View */}
        {scanResult && !isScanning && (
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            {/* Top Score Banner */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-6">
                <div
                  className={`w-24 h-24 rounded-2xl border-2 flex flex-col items-center justify-center shrink-0 ${getScoreColor(
                    scanResult.overallScore
                  )}`}
                >
                  <span className="text-3xl font-black">{scanResult.overallScore}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">/ 100 ATS</span>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-slate-900">ATS Readability Analysis</h2>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${getBadgeColor(
                        scanResult.overallScore >= 80 ? "pass" : scanResult.overallScore >= 60 ? "warn" : "fail"
                      )}`}
                    >
                      {scanResult.overallScore >= 80 ? "High Compatibility" : scanResult.overallScore >= 60 ? "Needs Polish" : "Parsing Blocked"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 max-w-xl">
                    {scanResult.overallScore >= 80
                      ? "Your CV is well-structured and cleanly parsed by ATS indexers. Key sections and contact data were successfully identified."
                      : "Your CV contains formatting or structural friction that may prevent enterprise ATS engines from cleanly indexing your data."}
                  </p>
                </div>
              </div>

              {onOpenInEditor && activeInputTab === "library" && selectedCvId && (
                <button
                  onClick={() => {
                    const cv = cvs.find((c) => c.id === selectedCvId);
                    if (cv) onOpenInEditor(cv.content, cv.title);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold transition-all flex items-center gap-2 shrink-0"
                >
                  <Wrench className="w-4 h-4" />
                  Edit CV in Builder
                </button>
              )}
            </div>

            {/* Score Breakdown Bar Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Contact Details</span>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-lg font-bold text-slate-900">{scanResult.scoreBreakdown.contactInformation.score}%</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getBadgeColor(scanResult.scoreBreakdown.contactInformation.status)}`}>
                    {scanResult.scoreBreakdown.contactInformation.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Layout & Structure</span>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-lg font-bold text-slate-900">{scanResult.scoreBreakdown.layoutAndStructure.score}%</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getBadgeColor(scanResult.scoreBreakdown.layoutAndStructure.status)}`}>
                    {scanResult.scoreBreakdown.layoutAndStructure.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Formatting Hygiene</span>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-lg font-bold text-slate-900">{scanResult.scoreBreakdown.formattingHygiene.score}%</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getBadgeColor(scanResult.scoreBreakdown.formattingHygiene.status)}`}>
                    {scanResult.scoreBreakdown.formattingHygiene.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Keyword Density</span>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-lg font-bold text-slate-900">{scanResult.scoreBreakdown.keywordDensity.score}%</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getBadgeColor(scanResult.scoreBreakdown.keywordDensity.status)}`}>
                    {scanResult.scoreBreakdown.keywordDensity.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Date Format Checks</span>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-lg font-bold text-slate-900">{scanResult.scoreBreakdown.dateConsistency.score}%</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getBadgeColor(scanResult.scoreBreakdown.dateConsistency.status)}`}>
                    {scanResult.scoreBreakdown.dateConsistency.status.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Navigation Tabs for Scan Results */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center border-b border-slate-200 overflow-x-auto bg-slate-50/50 p-2 gap-2">
                <button
                  onClick={() => setActiveResultTab("overview")}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                    activeResultTab === "overview"
                      ? "bg-white text-indigo-600 shadow border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <ListChecks className="w-4 h-4" />
                  Issues & Recommendations ({scanResult.issues.length})
                </button>

                <button
                  onClick={() => setActiveResultTab("raw")}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                    activeResultTab === "raw"
                      ? "bg-white text-indigo-600 shadow border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Raw ATS Parser Stream
                </button>

                <button
                  onClick={() => setActiveResultTab("entities")}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                    activeResultTab === "entities"
                      ? "bg-white text-indigo-600 shadow border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  Extracted Recruiter Profile
                </button>

                <button
                  onClick={() => setActiveResultTab("sections")}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                    activeResultTab === "sections"
                      ? "bg-white text-indigo-600 shadow border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  Section Heading Audit
                </button>

                <button
                  onClick={() => setActiveResultTab("keywords")}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                    activeResultTab === "keywords"
                      ? "bg-white text-indigo-600 shadow border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Tag className="w-4 h-4" />
                  Indexed Skills & Keywords ({scanResult.extractedKeywords.length})
                </button>
              </div>

              {/* Tab 1: Issues & Recommendations */}
              {activeResultTab === "overview" && (
                <div className="p-6 space-y-6">
                  {/* Quick Fixes Banner */}
                  {scanResult.quickFixes && scanResult.quickFixes.length > 0 && (
                    <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-5">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900 mb-3 flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-indigo-600" />
                        Top Priority Quick Fixes
                      </h4>
                      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-700">
                        {scanResult.quickFixes.map((fix, idx) => (
                          <li key={idx} className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-indigo-100">
                            <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <span>{fix}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Detailed Issues List */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-4">Detailed ATS Audit Log</h3>
                    <div className="space-y-3">
                      {scanResult.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start gap-4"
                        >
                          {getSeverityIcon(issue.severity)}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-sm font-bold text-slate-900">{issue.title}</h4>
                              <span
                                className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                                  issue.severity === "critical"
                                    ? "bg-rose-100 text-rose-800"
                                    : issue.severity === "warning"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {issue.severity}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mb-2">{issue.description}</p>
                            <div className="text-xs font-medium text-indigo-700 bg-indigo-50/80 p-2.5 rounded-lg border border-indigo-100 flex items-center gap-2">
                              <span className="font-bold shrink-0">Recommendation:</span>
                              <span>{issue.recommendation}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Raw ATS Parser Stream */}
              {activeResultTab === "raw" && (
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Unformatted Plain Text Stream</h3>
                      <p className="text-xs text-slate-500">
                        This is the raw linear string of text an ATS parser stores in its database after stripping all formatting, icons, and visual columns.
                      </p>
                    </div>
                    <button
                      onClick={copyRawText}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5"
                    >
                      {copiedRaw ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedRaw ? "Copied" : "Copy Raw Stream"}</span>
                    </button>
                  </div>

                  <div className="bg-slate-900 text-slate-100 p-5 rounded-xl text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed border border-slate-800">
                    {scanResult.rawExtractedText || "No raw text extracted."}
                  </div>
                </div>
              )}

              {/* Tab 3: Extracted Recruiter Profile */}
              {activeResultTab === "entities" && (
                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-1">Parsed Candidate Contact Info</h3>
                    <p className="text-xs text-slate-500 mb-4">
                      How an recruiter's applicant management dashboard displays your extracted metadata.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Full Name</span>
                        <p className="text-xs font-bold text-slate-900 mt-1">
                          {scanResult.parsedEntities.personalInfo.fullName || <span className="text-rose-500 font-normal italic">Not Found</span>}
                        </p>
                      </div>

                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Email Address</span>
                        <p className="text-xs font-bold text-slate-900 mt-1">
                          {scanResult.parsedEntities.personalInfo.email || <span className="text-rose-500 font-normal italic">Not Found</span>}
                        </p>
                      </div>

                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Phone Number</span>
                        <p className="text-xs font-bold text-slate-900 mt-1">
                          {scanResult.parsedEntities.personalInfo.phone || <span className="text-rose-500 font-normal italic">Not Found</span>}
                        </p>
                      </div>

                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Location</span>
                        <p className="text-xs font-bold text-slate-900 mt-1">
                          {scanResult.parsedEntities.personalInfo.location || <span className="text-slate-400 italic">Not Found</span>}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-3">Structured Section Counters</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-500 font-medium">Work History Roles</p>
                          <p className="text-xl font-bold text-indigo-900 mt-0.5">{scanResult.parsedEntities.workExperienceCount} Parsed</p>
                        </div>
                        <CheckCircle2 className="w-6 h-6 text-indigo-600" />
                      </div>

                      <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-500 font-medium">Education Entries</p>
                          <p className="text-xl font-bold text-indigo-900 mt-0.5">{scanResult.parsedEntities.educationCount} Parsed</p>
                        </div>
                        <CheckCircle2 className="w-6 h-6 text-indigo-600" />
                      </div>

                      <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-500 font-medium">Indexed Skills</p>
                          <p className="text-xl font-bold text-indigo-900 mt-0.5">{scanResult.parsedEntities.skillsCount} Tags</p>
                        </div>
                        <CheckCircle2 className="w-6 h-6 text-indigo-600" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Section Audit */}
              {activeResultTab === "sections" && (
                <div className="p-6">
                  <h3 className="text-sm font-bold text-slate-900 mb-1">Standard Section Header Recognition</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    ATS indexers look for standardized section titles to place content into database fields.
                  </p>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                        <tr>
                          <th className="p-3">Standard Section</th>
                          <th className="p-3">Detected Header in Document</th>
                          <th className="p-3">Standard Keyword?</th>
                          <th className="p-3">Audit Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {scanResult.sectionsCheck.map((sec, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="p-3 font-bold text-slate-900">{sec.name}</td>
                            <td className="p-3 font-mono text-slate-600">{sec.extractedHeader || "—"}</td>
                            <td className="p-3">
                              {sec.isStandardHeader ? (
                                <span className="text-emerald-600 font-bold flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" /> Standard
                                </span>
                              ) : (
                                <span className="text-amber-600 font-bold">Non-Standard / Creative</span>
                              )}
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded font-bold text-[10px] border ${getBadgeColor(sec.status)}`}>
                                {sec.status.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 5: Indexed Skills & Keywords */}
              {activeResultTab === "keywords" && (
                <div className="p-6">
                  <h3 className="text-sm font-bold text-slate-900 mb-1">Extracted ATS Search Tags</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    These keywords and skills are saved to your ATS database record so recruiters can match you when searching candidates.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {scanResult.extractedKeywords.map((kw, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-2"
                      >
                        <span>{kw.keyword}</span>
                        <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">
                          {kw.category}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
