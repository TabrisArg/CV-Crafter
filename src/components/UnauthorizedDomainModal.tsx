import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, Copy, Check, ExternalLink, X, ArrowRight, UserCheck } from "lucide-react";

interface UnauthorizedDomainModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinueGuest: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

export function UnauthorizedDomainModal({
  isOpen,
  onClose,
  onContinueGuest,
  showToast,
}: UnauthorizedDomainModalProps) {
  const [copied, setCopied] = useState(false);
  const currentDomain = typeof window !== "undefined" ? window.location.hostname : "";
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";

  if (!isOpen) return null;

  const copyDomain = () => {
    navigator.clipboard.writeText(currentDomain).then(() => {
      setCopied(true);
      showToast("Domain copied to clipboard!");
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden"
        >
          {/* Header */}
          <div className="p-6 bg-slate-900 text-white flex items-start justify-between relative">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">Authorize Domain in Firebase</h3>
                <p className="text-xs text-slate-400">Google Sign-In blocked on unauthorized domain</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5 text-slate-700 text-sm">
            <p className="text-xs leading-relaxed text-slate-600">
              Firebase Authentication requires the application domain to be explicitly listed in your Firebase project&apos;s Authorized Domains setting before Google Sign-In can complete.
            </p>

            {/* Domain Box */}
            <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl flex items-center justify-between gap-3">
              <div className="overflow-hidden">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                  Current Hostname to Authorize
                </span>
                <span className="font-mono text-xs font-bold text-indigo-700 truncate block">
                  {currentDomain}
                </span>
              </div>
              <button
                onClick={copyDomain}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-sm shadow-indigo-200"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>

            {/* Instructions */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                Steps to Fix in Firebase Console:
              </span>
              <ol className="space-y-2 text-xs text-slate-600 list-decimal pl-4">
                <li>
                  Open your{" "}
                  <a
                    href="https://console.firebase.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-1"
                  >
                    Firebase Console <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>Go to <strong>Authentication</strong> &rarr; <strong>Settings</strong> &rarr; <strong>Authorized domains</strong>.</li>
                <li>
                  Click <strong>Add domain</strong> and paste exactly: <code className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold">{currentDomain}</code>
                </li>
                <li>Click <strong>Save</strong> and wait ~1 minute for propagation, then refresh.</li>
              </ol>

              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
                <strong>⚠️ Crucial Requirement:</strong> Do <u>NOT</u> include <code>https://</code> or trailing slashes (<code>/</code>). Firebase expects only the bare hostname (e.g. <code>cv-crafter3000.netlify.app</code>).
              </div>
            </div>

            {/* Guest fallback banner */}
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs text-emerald-900 font-medium">
                  All features (builder, AI, scanner) work in Guest Mode using local storage.
                </span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={onContinueGuest}
              className="w-full sm:w-auto px-4 py-2 rounded-xl text-slate-700 hover:bg-slate-200 text-xs font-bold transition-colors"
            >
              Continue in Guest Mode
            </button>
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-100 transition-all flex items-center justify-center gap-2"
            >
              <span>Got It</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
