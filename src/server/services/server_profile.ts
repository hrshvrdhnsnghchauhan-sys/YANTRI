/**
 * YANTRI User Profile store (V4) — role-based onboarding persistence.
 *
 * Stores the onboarding result (email, role, selected features) in
 * profile.json inside the writable data dir, following the same pattern as
 * server_reminders.ts / server_memory.ts.
 *
 * Also builds the role-specific persona block injected into the Gemini
 * system instruction, and computes the allowed-tool set used to gate which
 * function declarations Gemini is offered.
 */

import fs from "fs/promises";
import {
  ROLE_FEATURES,
  UserRole,
  UserProfile,
  getAllowedToolsForProfile,
} from "../../lib/profileTypes";
import { dataFile } from "./server_paths";
import { queueUpload } from "./server_storage";

const PROFILE_FILE = dataFile("profile.json");

let cachedProfile: UserProfile | null = null;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadProfile(): Promise<UserProfile | null> {
  if (cachedProfile) return cachedProfile;
  try {
    const data = await fs.readFile(PROFILE_FILE, "utf-8");
    const parsed = JSON.parse(data) as UserProfile;
    if (parsed && parsed.email && parsed.role) {
      cachedProfile = parsed;
      return parsed;
    }
    return null;
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      console.error("[Profile] Error loading profile:", error);
    }
    return null;
  }
}

export async function saveProfile(
  patch: { email: string; name?: string; role: UserRole; features: string[] }
): Promise<UserProfile> {
  const now = new Date().toISOString();
  const existing = await loadProfile();
  const profile: UserProfile = {
    email: String(patch.email || "").trim().toLowerCase(),
    name: String(patch.name || existing?.name || "").trim(),
    role: patch.role,
    features: Array.isArray(patch.features) ? patch.features : [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!profile.email) throw new Error("Email is required.");
  await fs.writeFile(PROFILE_FILE, JSON.stringify(profile, null, 2), "utf-8");
  queueUpload("profile.json"); // V5.1: mirror to cloud object storage if configured
  cachedProfile = profile;
  console.log(`[Profile] Saved profile for ${profile.email} (role=${profile.role}, features=[${profile.features.join(", ")}])`);
  return profile;
}

/** True when onboarding has been completed at least once. */
export async function hasProfile(): Promise<boolean> {
  return (await loadProfile()) !== null;
}

// ---------------------------------------------------------------------------
// Allowed-tool gating
// ---------------------------------------------------------------------------

/**
 * Resolve the set of tool names the current profile may use.
 * Returns null when no profile exists yet (offer everything — back-compat).
 */
export async function getAllowedToolNames(): Promise<Set<string> | null> {
  const profile = await loadProfile();
  return getAllowedToolsForProfile(profile);
}

// ---------------------------------------------------------------------------
// Persona block injected into the Gemini system instruction
// ---------------------------------------------------------------------------

const ROLE_PERSONA: Record<UserRole, string> = {
  student:
    "ROLE: The user is a STUDENT. You are their academic companion.\n" +
    "   - Help with schedules, deadlines, assignments, exam prep and study plans proactively.\n" +
    "   - When they mention an exam or assignment, offer to create calendar events, tasks or reminders.\n" +
    "   - Explain concepts in simple language; structure study help as step-by-step plans.\n",
  professional:
    "ROLE: The user is a WORKING PROFESSIONAL. You are their workplace efficiency partner.\n" +
    "   - Focus on meetings, emails, project tracking, documents and productivity.\n" +
    "   - Draft emails professionally and ALWAYS get approval before sending.\n" +
    "   - Keep meeting notes and action items organised; offer follow-ups proactively.\n",
  business_owner:
    "ROLE: The user is a BUSINESS OWNER. You are their business operations assistant.\n" +
    "   - Focus on inventory logging, customer feedback, supplier payments and sales analysis.\n" +
    "   - When they dictate stock or order details, log them into spreadsheets automatically.\n" +
    "   - Summarise business data in plain language with actionable takeaways.\n",
};

/**
 * Build the role-specific persona block appended to the system instruction.
 * Lists ONLY the feature modules the user selected so Gemini does not offer
 * capabilities the user turned off.
 */
export function buildPersonaBlock(profile: UserProfile | null): string {
  if (!profile) return "";

  let block =
    "\n=== USER PROFILE (ONBOARDED) ===\n" +
    `USER: ${profile.name || "the user"} (${profile.email})\n` +
    ROLE_PERSONA[profile.role] +
    "SELECTED FEATURE MODULES (offer help ONLY around these):\n";

  const catalog = ROLE_FEATURES[profile.role] || [];
  const selected = catalog.filter((f) => profile.features.includes(f.id));
  if (selected.length === 0) {
    block += "  - (none selected yet — general assistant mode)\n";
  } else {
    for (const f of selected) {
      block += `  - ${f.label}: ${f.description}\n`;
    }
  }
  block +=
    "IMPORTANT: The user deliberately chose these modules during onboarding. " +
    "Do NOT offer features outside them; if asked, explain it is not part of their selected toolkit and they can enable more in Settings.\n" +
    "================================\n";
  return block;
}

export async function buildPersonaBlockAsync(): Promise<string> {
  const profile = await loadProfile();
  return buildPersonaBlock(profile);
}
