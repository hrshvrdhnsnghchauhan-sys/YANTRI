/**
 * DataDashboard — view/edit panel for role-feature data records (V4).
 *
 * Shows everything Gemini saved via saveUserRecord / getUserRecords:
 * deadlines, exams, notes, flashcards, attendance, meetings, inventory
 * entries, supplier dues, feedback... in one filterable grid, scoped to the
 * onboarded user's email on the server side.
 *
 * Mirrors MemoryDashboard's holographic-terminal visual language so the two
 * panels feel like siblings. Data is fetched live from /api/userdata on open.
 */

import { useEffect, useState } from "react";
import {
  X,
  Trash2,
  Database,
  Inbox,
  RefreshCw,
  Plus,
  CalendarClock,
  CalendarCheck,
  CalendarX,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { API_BASE } from "../lib/config";
import {
  getConfigForType,
  KNOWN_RECORD_TYPES,
  RECORD_TYPE_CONFIG,
  type UserRecord,
} from "../lib/userRecordTypes";

interface DataDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  themeColor: string;
}

/** Payload keys surfaced as chips under the title, in priority order. */
const PAYLOAD_CHIP_KEYS = [
  "subject", "item", "supplier", "member", "who", "status",
  "quantity", "qty", "price", "unit_price", "total", "marks", "chapter",
] as const;

function payloadChips(rec: UserRecord): string[] {
  const chips: string[] = [];
  for (const key of PAYLOAD_CHIP_KEYS) {
    const v = rec.payload?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      chips.push(`${key.replace(/_/g, " ")}: ${String(v)}`);
    }
    if (chips.length >= 4) break;
  }
  return chips;
}

/** Payload keys that are internal sync bookkeeping — never displayed. */
const HIDDEN_PAYLOAD_KEYS = new Set(["calendarEventId", "calendarSynced", "calendarSyncError"]);

/** Calendar sync state for the badge on record cards. */
type SyncState = "synced" | "failed" | null;
function calendarSyncState(rec: UserRecord): SyncState {
  if (rec.payload?.calendarEventId && rec.payload?.calendarSynced) return "synced";
  if (rec.payload?.calendarSyncError) return "failed";
  return null;
}

/** Remaining payload key/values not shown as chips. */
function payloadExtras(rec: UserRecord): string[] {
  const used = new Set<string>(PAYLOAD_CHIP_KEYS);
  const out: string[] = [];
  for (const [k, v] of Object.entries(rec.payload || {})) {
    if (HIDDEN_PAYLOAD_KEYS.has(k)) continue;
    if (!used.has(k) && v !== undefined && v !== null && String(v).trim() !== "") {
      out.push(`${k}: ${String(v)}`);
    }
  }
  return out;
}

function isDueSoon(due?: string): boolean {
  if (!due) return false;
  const t = new Date(due).getTime();
  if (Number.isNaN(t)) return false;
  const diffDays = (t - Date.now()) / 86_400_000;
  return diffDays <= 3;
}

export function DataDashboard({ isOpen, onClose, themeColor }: DataDashboardProps) {
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/userdata?limit=200`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || "Could not load records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen]);

  async function handleDelete(id: string) {
    setDeleteId(id);
    try {
      const res = await fetch(`${API_BASE}/api/userdata/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRecords((prev) => prev.filter((r) => r.id !== id));
      }
    } catch {
      /* keep row on failure */
    } finally {
      setDeleteId(null);
    }
  }

  const presentTypes: string[] = Array.from(new Set<string>(records.map((r) => r.type)));
  const filterTabs: string[] = ["all", ...presentTypes];

  const filtered = records.filter((r) => {
    if (activeTab !== "all" && r.type !== activeTab) return false;
    if (search.trim()) {
      const hay = (r.title + " " + JSON.stringify(r.payload || {})).toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  // Soonest due first; undated last, newest first.
  const sorted = [...filtered].sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const dueCount = records.filter((r) => isDueSoon(r.due) && r.type !== "inventory").length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Full-screen backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 z-40 backdrop-blur-md bg-[linear-gradient(rgba(0,255,255,0.03)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-auto"
          />

          {/* Central holographic terminal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="absolute inset-0 m-4 max-w-[1400px] mx-auto bg-black/90 backdrop-blur-3xl z-50 flex flex-col shadow-[0_0_100px_rgba(6,182,212,0.15)] overflow-hidden"
            style={{ clipPath: "polygon(0 0, calc(100% - 30px) 0, 100% 30px, 100% 100%, 30px 100%, 0 calc(100% - 30px))" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-cyan-500/20 bg-black/40 relative z-10">
              <div className="flex items-center gap-3">
                <Database size={24} className="text-cyan-400" />
                <h2 className="text-xl font-mono tracking-widest text-white uppercase">
                  DATA VAULT
                </h2>
                {dueCount > 0 && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 border border-rose-500/40 bg-rose-950/30 text-[9px] font-mono uppercase tracking-widest text-rose-300">
                    <CalendarClock size={10} />
                    {dueCount} due ≤3d
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void refresh()}
                  className="p-2 border border-cyan-500/30 bg-cyan-950/40 text-cyan-400 hover:bg-cyan-500/20 transition-all cursor-pointer"
                  title="Refresh records"
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 border border-cyan-500/30 bg-cyan-950/40 text-cyan-400 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/50 transition-all cursor-pointer"
                  style={{ clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)" }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-cyan-950/10 border-b border-cyan-500/20">
              <div className="flex flex-wrap items-center gap-1.5 flex-1">
                {filterTabs.map((t) => {
                  const cfg = t === "all" ? null : getConfigForType(t);
                  const label = t === "all" ? "All" : cfg?.label || t;
                  const count = t === "all" ? records.length : records.filter((r) => r.type === t).length;
                  const active = activeTab === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t)}
                      className={`px-3 py-1.5 border text-[10px] font-mono uppercase tracking-widest transition-all cursor-pointer ${
                        active
                          ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                          : "border-cyan-900/50 bg-black/40 text-cyan-700 hover:border-cyan-500/40 hover:text-cyan-400"
                      }`}
                      style={{ clipPath: "polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)" }}
                    >
                      {label} [{count}]
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records..."
                className="w-48 px-3 py-1.5 text-xs bg-black/60 border border-cyan-500/30 text-cyan-50 placeholder-cyan-900/60 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            {/* Records grid */}
            <div className="flex-1 overflow-y-auto p-6 relative z-10 no-scrollbar">
              {loading && records.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-cyan-600">
                  <RefreshCw size={36} className="animate-spin opacity-50" />
                  <p className="mt-4 text-xs font-mono uppercase tracking-widest">Decrypting vault...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-rose-400">
                  <X size={40} className="opacity-50" />
                  <h4 className="mt-4 text-sm font-mono uppercase tracking-widest">Vault Unreachable</h4>
                  <p className="mt-2 text-xs font-mono text-rose-500/70">{error}</p>
                  <button
                    onClick={() => void refresh()}
                    className="mt-4 px-4 py-2 border border-rose-500/40 bg-rose-950/30 text-[10px] font-mono uppercase tracking-widest text-rose-300 hover:bg-rose-500/20 transition cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-cyan-600">
                  <div className="relative w-32 h-32 mb-6 flex items-center justify-center">
                    <div className="absolute inset-0 border-2 border-cyan-500/20 animate-[spin_20s_linear_infinite]" style={{ clipPath: "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)" }} />
                    <Inbox size={48} className="opacity-40 text-cyan-500/50 animate-pulse" />
                  </div>
                  <h4 className="text-lg font-mono tracking-widest text-cyan-400 uppercase">Vault Empty</h4>
                  <p className="text-xs max-w-sm mt-3 font-mono uppercase text-cyan-700 leading-relaxed">
                    {activeTab === "all"
                      ? "Records Yantri saves for you — deadlines, notes, inventory — appear here."
                      : `No records in ${getConfigForType(activeTab).label}.`}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <AnimatePresence initial={false}>
                    {sorted.map((rec) => {
                      const cfg = getConfigForType(rec.type);
                      const Icon = cfg.icon;
                      const chips = payloadChips(rec);
                      const extras = payloadExtras(rec);
                      const dueSoon = isDueSoon(rec.due);
                      const isDeleting = deleteId === rec.id;
                      return (
                        <motion.div
                          key={rec.id}
                          layout
                          initial={{ opacity: 0, scale: 0.9, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, y: -20 }}
                          className={`group relative p-[1px] ${cfg.bg} transition-all duration-300 hover:-translate-y-1`}
                          style={{ clipPath: "polygon(20px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%, 0 20px)" }}
                        >
                          <div className="relative bg-black/80 backdrop-blur-xl p-5 border border-white/5 flex flex-col min-h-[150px]">
                            {/* Card header */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={`p-2 bg-black/60 border ${cfg.color}`} style={{ clipPath: "polygon(25% 0%,100% 0%,75% 100%,0% 100%)" }}>
                                  <Icon size={14} />
                                </div>
                                <span className={`text-[10px] font-mono uppercase tracking-widest ${cfg.color.split(" ")[0]}`}>{cfg.label}</span>
                              </div>
                              {isDeleting ? (
                                <button
                                  onClick={() => void handleDelete(rec.id)}
                                  className="px-2 py-1 bg-rose-500/20 border border-rose-500 text-[9px] font-mono tracking-widest text-rose-300 uppercase animate-pulse cursor-pointer"
                                >
                                  PURGE
                                </button>
                              ) : (
                                <button
                                  onClick={() => setDeleteId(rec.id)}
                                  className="opacity-0 group-hover:opacity-100 p-1.5 border border-rose-500/30 bg-rose-950/40 text-rose-500 hover:bg-rose-500 hover:text-black transition-all cursor-pointer"
                                  title="Delete record"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>

                            {/* Title + due + sync badge */}
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm text-cyan-50 font-mono break-words">{rec.title}</p>
                              <div className="flex shrink-0 items-center gap-1">
                                {calendarSyncState(rec) === "synced" && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 border border-emerald-500/40 bg-emerald-950/30 text-[9px] font-mono uppercase text-emerald-300" title="Mirrored to Google Calendar">
                                    <CalendarCheck size={10} /> CAL
                                  </span>
                                )}
                                {calendarSyncState(rec) === "failed" && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 border border-amber-500/40 bg-amber-950/30 text-[9px] font-mono uppercase text-amber-300" title={String(rec.payload?.calendarSyncError || "Calendar sync failed — will retry")}>
                                    <CalendarX size={10} /> RETRY
                                  </span>
                                )}
                                {rec.due && (
                                  <span className={`px-1.5 py-0.5 border text-[9px] font-mono uppercase ${
                                    dueSoon ? "border-rose-500/50 bg-rose-950/40 text-rose-300 animate-pulse" : "border-cyan-900 bg-black/40 text-cyan-500"
                                  }`}>
                                    {new Date(rec.due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Payload chips */}
                            {chips.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2.5">
                                {chips.map((c) => (
                                  <span key={c} className="px-1.5 py-0.5 bg-cyan-950/40 border border-cyan-900/60 text-[9px] font-mono text-cyan-400 uppercase">
                                    {c}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Extras + tags */}
                            <div className="mt-2 space-y-0.5">
                              {extras.slice(0, 3).map((x) => (
                                <p key={x} className="text-[10px] font-mono text-cyan-600 break-words">{x}</p>
                              ))}
                              {rec.tags.length > 0 && (
                                <p className="text-[10px] font-mono text-cyan-800">#{rec.tags.join(" #")}</p>
                              )}
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-between border-t border-cyan-900/40 pt-2 mt-auto text-[9px] font-mono text-cyan-800 uppercase">
                              <span>{rec.type}</span>
                              <span>{new Date(rec.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-cyan-500/20 bg-black/60 flex items-center justify-between text-[9px] font-mono text-cyan-700 tracking-widest uppercase">
              <span className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  {[1, 2, 3].map((i) => (
                    <span key={i} className="w-1 h-2 bg-cyan-500 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </span>
                {sorted.length} RECORD{sorted.length === 1 ? "" : "S"} SCOPED TO PROFILE
              </span>
              <span>STORE: USERDATA.JSON</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
