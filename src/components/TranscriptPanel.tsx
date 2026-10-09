import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Search,
  Copy,
  Palette,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Maximize2,
  Trash2,
  Filter,
  Loader2,
} from "lucide-react";

export interface TranscriptEntry {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: Date;
  emotion?: string;
}

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onClear?: () => void;
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  entries,
  isOpen,
  onClose,
  onMinimize,
  searchTerm,
  onSearchChange,
  selectedIds = new Set(),
  onSelectionChange,
  onClear,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Format timestamp
  const formatTimestamp = (entry: TranscriptEntry) => {
    return entry.timestamp.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Highlight matching text - safely escape HTML then highlight
  const highlightMatch = (text: string, term: string) => {
    if (!term) return text;
    // Escape HTML entities first to prevent XSS
    const escaped = text
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, "\"")
      .replace(/'/g, "'");
    const regex = new RegExp(`(${escapeRegExp(term)})`, "gi");
    return escaped.replace(regex, "<mark class=\"bg-yellow-500/30 text-yellow-200\">$1</mark>");
  };

  // Helper to escape regex special characters
  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  // Copy entry to clipboard
  const copyEntry = async (entry: TranscriptEntry) => {
    const text = `[${formatTimestamp(entry)}] ${entry.role.toUpperCase()}: ${entry.content}`;
    await navigator.clipboard.writeText(text);
  };

  // Clear all entries with confirmation
  const clearAll = () => {
    if (entries.length === 0) return;
    const confirmed = window.confirm(
      "Permanently clear full conversation history? This cannot be undone."
    );
    if (confirmed && onClear) onClear();
  };

  // Toggle entry selection
  const toggleEntrySelection = (entryId: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(entryId)) newSet.delete(entryId);
    else newSet.add(entryId);
    // For now, parent component manages this; we can expose a callback if needed.
  };

  // Emit ambient emotion lighting if enabled (legacy)
  useEffect(() => {
    if (entries.length > 0) {
      const latest = entries[entries.length - 1];
      if (latest.role === "model" && latest.emotion && latest.emotion !== "idle") {
        console.log(
          `[${new Date().toISOString()}] EMOTION AMBIANCE: Legacy Emotion 1.0 Ambient lighting triggered for emotion: ${latest.emotion}`
        );
      }
    }
  }, [entries]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="fixed bottom-4 right-4 z-50 w-[420px] max-h-[60vh] bg-[#0a0a12]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col font-mono"
        role="dialog"
        aria-label="Conversation transcript"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold tracking-widest text-white uppercase">Transcript</span>
            <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-white/5 font-mono">
              {entries.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-40 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 focus:bg-white/10"
              aria-label="Search transcript"
            />
            {!isMinimized && (
              <button
                onClick={clearAll}
                disabled={entries.length === 0}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-500 hover:text-slate-200 transition opacity-50 disabled:opacity-20 disabled:cursor-not-allowed"
                title="Clear all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-500 hover:text-slate-200 transition"
              title={isMinimized ? "Expand" : "Minimize"}
            >
              {isMinimized ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-slate-500 hover:text-red-400 transition"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Entries list */}
          <AnimatePresence mode="wait">
            {!isMinimized && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex-1 overflow-y-auto p-3 space-y-3"
                ref={listRef}
              >
                {entries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500">
                    <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
                    <p className="text-xs text-center max-w-xs">
                      No conversation history yet. Start talking to Yantri!
                    </p>
                  </div>
                ) : (
                  entries.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      className={`group relative rounded-xl p-3 transition-all ${
                        entry.role === "user"
                          ? "bg-cyan-500/10 border-l-2 border-cyan-400"
                          : "bg-purple-500/10 border-l-2 border-purple-400"
                      } ${selectedIds.has(entry.id) ? "ring-1 ring-cyan-400/50" : ""}`}
                    >
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full ${
                              entry.role === "user"
                                ? "bg-cyan-500/20 text-cyan-300"
                                : "bg-purple-500/20 text-purple-300"
                            }`}
                          >
                            {entry.role.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {formatTimestamp(entry)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => toggleEntrySelection(entry.id)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-500 hover:text-slate-200 transition"
                            title={selectedIds.has(entry.id) ? "Deselect" : "Select"}
                          >
                            {selectedIds.has(entry.id) ? (
                              <Filter className="w-3 h-3 text-cyan-400" />
                            ) : (
                              <Filter className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            onClick={() => copyEntry(entry)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-500 hover:text-slate-200 transition"
                            title="Copy to clipboard"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Entry content */}
                      <div
                        className="text-xs text-slate-200 font-mono leading-relaxed whitespace-pre-wrap break-words"
                        dangerouslySetInnerHTML={{ __html: highlightMatch(entry.content, searchTerm) }}
                      />

                      {/* Ambient emotion lighting hint */}
                      {entry.emotion && entry.emotion !== "idle" && (
                        <div className="mt-2.5 pt-2.5 border-t border-white/5">
                          <div className="flex items-center gap-2">
                            <Palette className="w-3 h-3 text-orange-400" />
                            <span className="text-[10px] text-orange-300 font-mono">
                              Emotion: {entry.emotion}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Selection indicator */}
                      {selectedIds.has(entry.id) && (
                        <div className="absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b from-cyan-400 via-purple-400 to-cyan-400" />
                      )}
                    </motion.div>
                  ))
                )}
              </motion.div>
            )}

            {/* Minimized view */}
            {isMinimized && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="p-3.5 text-center border-t border-white/10"
              >
                <div className="text-xs text-slate-400 font-mono uppercase tracking-wider mb-2">
                  Transcript
                </div>
                <div className="text-slate-300 font-bold text-sm">
                  {entries.length} entries
                </div>
                <div className="text-[10px] text-slate-600 mt-1">
                  Press F4 to expand
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};