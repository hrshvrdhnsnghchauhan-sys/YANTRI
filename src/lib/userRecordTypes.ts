/**
 * YANTRI User Data Records — client-side types & display config (V4).
 *
 * Mirrors the UserRecord shape persisted by server_userdata.ts and provides
 * the presentation config (label / icon / color) used by the DataDashboard
 * panel. Any record type not listed here falls back to the "other" bucket so
 * future feature-specific types still render.
 */

export interface UserRecord {
  id: string;
  email: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  due?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

import {
  CalendarClock,
  GraduationCap,
  StickyNote,
  Layers,
  Users,
  ClipboardList,
  NotebookPen,
  Package,
  Truck,
  MessageSquareHeart,
  BellRing,
  Tag,
} from "lucide-react";

export interface RecordTypeConfig {
  label: string;
  icon: any;
  /** Tailwind classes for icon chip border + text. */
  color: string;
  /** Tailwind classes for card hover background. */
  bg: string;
}

export const RECORD_TYPE_CONFIG: Record<string, RecordTypeConfig> = {
  deadline: { label: "Deadlines", icon: CalendarClock, color: "text-rose-400 border-rose-500/30", bg: "bg-rose-950/20 hover:bg-rose-900/30" },
  exam: { label: "Exams", icon: GraduationCap, color: "text-orange-400 border-orange-500/30", bg: "bg-orange-950/20 hover:bg-orange-900/30" },
  note: { label: "Notes", icon: StickyNote, color: "text-amber-400 border-amber-500/30", bg: "bg-amber-950/20 hover:bg-amber-900/30" },
  flashcard: { label: "Flashcards", icon: Layers, color: "text-emerald-400 border-emerald-500/30", bg: "bg-emerald-950/20 hover:bg-emerald-900/30" },
  attendance: { label: "Attendance", icon: Users, color: "text-sky-400 border-sky-500/30", bg: "bg-sky-950/20 hover:bg-sky-900/30" },
  meeting: { label: "Meetings", icon: ClipboardList, color: "text-cyan-400 border-cyan-500/30", bg: "bg-cyan-950/20 hover:bg-cyan-900/30" },
  work_session: { label: "Work Sessions", icon: NotebookPen, color: "text-indigo-400 border-indigo-500/30", bg: "bg-indigo-950/20 hover:bg-indigo-900/30" },
  inventory: { label: "Inventory", icon: Package, color: "text-lime-400 border-lime-500/30", bg: "bg-lime-950/20 hover:bg-lime-900/30" },
  supplier: { label: "Suppliers", icon: Truck, color: "text-teal-400 border-teal-500/30", bg: "bg-teal-950/20 hover:bg-teal-900/30" },
  feedback: { label: "Feedback", icon: MessageSquareHeart, color: "text-fuchsia-400 border-fuchsia-500/30", bg: "bg-fuchsia-950/20 hover:bg-fuchsia-900/30" },
  custom_reminder: { label: "Reminders", icon: BellRing, color: "text-violet-400 border-violet-500/30", bg: "bg-violet-950/20 hover:bg-violet-900/30" },
};

/** Fallback for unknown/future record types. */
export const OTHER_TYPE_CONFIG: RecordTypeConfig = {
  label: "Other",
  icon: Tag,
  color: "text-slate-400 border-slate-500/30",
  bg: "bg-slate-950/20 hover:bg-slate-900/30",
};

export function getConfigForType(type: string): RecordTypeConfig {
  return RECORD_TYPE_CONFIG[type] || OTHER_TYPE_CONFIG;
}

/** All known type keys, for filter chips. */
export const KNOWN_RECORD_TYPES: string[] = Object.keys(RECORD_TYPE_CONFIG);
