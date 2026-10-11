/**
 * YANTRI User Profile — onboarding types & feature catalog (V4).
 *
 * During first-run onboarding the user identifies themselves with their email,
 * picks what they are (student / working professional / business owner) and
 * then selects ONLY the feature modules relevant to their work. The backend
 * stores this in profile.json and uses it to:
 *   1. Inject a role-specific persona block into the Gemini system instruction.
 *   2. Gate which tool declarations Gemini is offered (only selected features).
 *
 * Shared between the React onboarding wizard, the Settings panel and the Node
 * server (server_profile.ts imports this file, following the same pattern as
 * memoryTypes.ts / reminderTypes.ts).
 */

export type UserRole = "student" | "professional" | "business_owner";

export interface UserProfile {
  /** Login identity — used to personalise replies and label saved data. */
  email: string;
  /** Display name (optional). */
  name: string;
  /** What the user does — drives the persona + feature gating. */
  role: UserRole;
  /** Feature module ids the user opted into during onboarding. */
  features: string[];
  createdAt: string;
  updatedAt: string;
}

/** A selectable feature module shown during onboarding / in Settings. */
export interface FeatureDef {
  id: string;
  label: string;
  description: string;
  /** Tool names unlocked by this feature (server-side gating). */
  tools: string[];
}

/** Tools every user always gets regardless of role/features. */
export const CORE_TOOLS: ReadonlySet<string> = new Set([
  // conversation / UI
  "changeBackground",
  "saveCustomMemory",
  "shutdownYantri",
  // generic reminders
  "setReminder",
  "listReminders",
  "cancelReminder",
  // personal data records (notes, deadlines, flashcards, meetings, ...)
  "saveUserRecord",
  "getUserRecords",
  "updateUserRecord",
  "deleteUserRecord",
  // generic desktop control
  "openApplication",
  "closeApplication",
  "openWebsite",
  "searchWeb",
  "searchYouTube",
  "searchGoogle",
  "searchGitHub",
  "searchTavily",
  "playYouTubeVideo",
  "createFile",
  "readFile",
  "renameFile",
  "deleteFile",
  "moveFile",
  "openFolder",
  "listFiles",
  "searchFiles",
  "volumeUp",
  "volumeDown",
  "muteToggle",
  "setVolume",
  "requestPowerAction",
  "executePowerAction",
  "minimizeWindow",
  "maximizeWindow",
  "closeWindow",
  "switchApplication",
  "copySelected",
  "pasteClipboard",
  "getClipboard",
  "clearClipboard",
  "takeScreenshot",
  "saveScreenshot",
  "analyzeScreenshot",
  "readScreen",
  "desktopBrowserOpen",
  "desktopBrowserNavigate",
  "desktopBrowserOpenTab",
  "desktopBrowserCloseTab",
  "desktopBrowserSearch",
  "desktopBrowserOpenYoutubeVideo",
  "desktopBrowserClick",
  "desktopBrowserType",
  "desktopBrowserFillForm",
  "desktopBrowserGoBack",
  "desktopBrowserGoForward",
  "desktopBrowserScroll",
  "desktopBrowserReadText",
  "desktopBrowserGetLinks",
  "desktopBrowserSetMode",
  "browserMediaControl",
  "browserTabAction",
  "createPythonFile",
  "runPythonScript",
  "createProjectFolder",
  "writeCodeFile",
  "systemInfo",
  "gpuInfo",
  "temperatureInfo",
  "brightnessUp",
  "brightnessDown",
  "setBrightness",
  "enableAutoStart",
  "disableAutoStart",
  "getAutoStartStatus",
  "requestTerminalAction",
  "runTerminalCommand",
  "installPackage",
  "provideSudoPassword",
  "isCommandAllowed",
  "getWeather",
  "getNews",
  "switchWorkspace",
  "listWorkspaces",
  "moveToWorkspace",
  "exportConversation",
  "listExports",
  "osType",
  "osPress",
  "osClick",
  "cameraList",
  "cameraOn",
  "cameraOff",
]);

// ---------------------------------------------------------------------------
// STUDENT feature modules
// ---------------------------------------------------------------------------
export const STUDENT_FEATURES: FeatureDef[] = [
  {
    id: "schedule",
    label: "Academic Schedule & Deadlines",
    description: "Class timetable from Google Calendar, assignment/exam deadlines with reminders",
    tools: [
      "getCalendarEvents", "createCalendarEvent", "getTasks", "createTask",
      "getEmails", "startPomodoro",
    ],
  },
  {
    id: "assignments",
    label: "Assignment & Project Help",
    description: "Draft assignments, create project folders, create and run code files",
    tools: [
      "createPythonFile", "writeCodeFile", "createProjectFolder", "runPythonScript",
      "openFolder", "extractDocumentText",
    ],
  },
  {
    id: "communication",
    label: "Professor & College Communication",
    description: "Draft professional emails to professors, open college portal / LMS",
    tools: [
      "draftEmail", "sendEmail", "getEmails", "readFullEmail", "draftReply",
      "iitmQuickLinks", "iitmOpen", "iitmOpenCustom",
    ],
  },
  {
    id: "notes",
    label: "Study & Notes Management",
    description: "Voice notes by subject, revision plans, flashcards, PDF summaries",
    tools: ["extractDocumentText", "startPomodoro"],
  },
  {
    id: "research",
    label: "Research & Information",
    description: "Web / YouTube / GitHub research, papers, citations, key points",
    tools: ["desktopBrowserOpen", "desktopBrowserSearch", "desktopBrowserReadText", "desktopBrowserGetLinks"],
  },
  {
    id: "productivity",
    label: "Daily Productivity & Focus",
    description: "Pomodoro study plans, focus mode, break reminders, attendance & CGPA tracking",
    tools: [
      "startPomodoro", "startFocusMode", "stopFocusMode", "getFocusStatus",
    ],
  },
  {
    id: "examPrep",
    label: "Exam Preparation Mode",
    description: "Countdown plans, subject-wise revision schedule, mock questions",
    tools: ["startPomodoro", "startFocusMode", "stopFocusMode", "getFocusStatus", "searchWeb"],
  },
  {
    id: "collegeUtils",
    label: "College Life Utilities",
    description: "Library/lab timings, fee payment reminders, club events, group task assignments",
    tools: ["iitmQuickLinks", "iitmOpen", "iitmOpenCustom", "createCalendarEvent"],
  },
];

// ---------------------------------------------------------------------------
// WORKING PROFESSIONAL feature modules
// ---------------------------------------------------------------------------
export const PROFESSIONAL_FEATURES: FeatureDef[] = [
  {
    id: "meetings",
    label: "Meetings & Notes",
    description: "Schedule meetings, keep meeting notes and action items in one place",
    tools: ["getCalendarEvents", "createCalendarEvent", "draftEmail", "sendEmail", "readFullEmail", "draftReply", "startPomodoro"],
  },
  {
    id: "emailAssistant",
    label: "Smart Email Assistant",
    description: "Spot important emails, draft professional replies, send with your approval",
    tools: ["draftEmail", "sendEmail", "getEmails", "readFullEmail", "draftReply"],
  },
  {
    id: "projects",
    label: "Project & Task Tracking",
    description: "Track project progress, maintain team task lists and status",
    tools: ["getTasks", "createTask", "searchFiles"],
  },
  {
    id: "documents",
    label: "Document Management",
    description: "Scan/extract text from PDFs & docs, organise important files",
    tools: ["extractDocumentText", "startFocusMode", "stopFocusMode", "getFocusStatus"],
  },
  {
    id: "timeTracking",
    label: "Work Hours & Productivity",
    description: "Log work sessions, pomodoro timers, focus mode, productivity summaries",
    tools: [
      "startPomodoro", "startFocusMode", "stopFocusMode", "getFocusStatus",
    ],
  },
  {
    id: "clientMgmt",
    label: "Client Coordination",
    description: "Arrange client meetings, follow-up reminders, professional emails",
    tools: ["createCalendarEvent", "getCalendarEvents", "draftEmail", "sendEmail", "readFullEmail", "draftReply"],
  },
  {
    id: "dataAnalysis",
    label: "Business Data Analysis",
    description: "Read spreadsheets, run Python analysis scripts, summarise data",
    tools: [
      "readSpreadsheet", "summarizeSpreadsheet", "writeSpreadsheet", "runPythonScript", "writeCodeFile",
    ],
  },
  {
    id: "researchProf",
    label: "Project Research",
    description: "Deep research on topics, competitors and technologies for your projects",
    tools: ["desktopBrowserOpen", "desktopBrowserSearch", "desktopBrowserReadText", "desktopBrowserGetLinks"],
  },
];

// ---------------------------------------------------------------------------
// BUSINESS OWNER feature modules
// ---------------------------------------------------------------------------
export const BUSINESS_FEATURES: FeatureDef[] = [
  {
    id: "inventory",
    label: "Inventory to Excel",
    description: "Log stock entries from WhatsApp into organised Excel sheets automatically",
    tools: [
      "logInventoryEntry", "writeSpreadsheet", "appendSpreadsheetRows",
      "readSpreadsheet", "summarizeSpreadsheet",
    ],
  },
  {
    id: "feedback",
    label: "Customer Feedback",
    description: "Collect and review customer feedback to understand preferences",
    tools: ["summarizeSpreadsheet", "readSpreadsheet"],
  },
  {
    id: "suppliers",
    label: "Supplier & Payments",
    description: "Manage supplier records, payment dues and account reminders",
    tools: [
      "draftEmail", "sendEmail", "getEmails", "readFullEmail", "draftReply", "writeSpreadsheet", "appendSpreadsheetRows", "readSpreadsheet",
    ],
  },
  {
    id: "salesData",
    label: "Sales & Accounts Analysis",
    description: "Summarise business data, run quick analysis on your Excel sheets",
    tools: [
      "readSpreadsheet", "summarizeSpreadsheet", "writeSpreadsheet", "runPythonScript",
    ],
  },
  {
    id: "documentsBiz",
    label: "Documents & Bills",
    description: "Extract text from bills, invoices and scanned documents",
    tools: ["extractDocumentText", "readSpreadsheet"],
  },
  {
    id: "orders",
    label: "Order & Appointment Reminders",
    description: "Never miss a delivery, payment or customer appointment",
    tools: ["createCalendarEvent", "getCalendarEvents", "startPomodoro"],
  },
];

export const ROLE_FEATURES: Record<UserRole, FeatureDef[]> = {
  student: STUDENT_FEATURES,
  professional: PROFESSIONAL_FEATURES,
  business_owner: BUSINESS_FEATURES,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  student: "Student",
  professional: "Working Professional",
  business_owner: "Business Owner",
};

/** All tool names a given profile may use (core + selected features). */
export function getAllowedToolsForProfile(profile: {
  role: UserRole;
  features: string[];
} | null): Set<string> | null {
  if (!profile) return null; // no profile yet → everything (back-compat)
  const allowed = new Set<string>(CORE_TOOLS);
  const catalog = ROLE_FEATURES[profile.role] || [];
  for (const f of catalog) {
    if (profile.features.includes(f.id)) {
      for (const t of f.tools) allowed.add(t);
    }
  }
  return allowed;
}
