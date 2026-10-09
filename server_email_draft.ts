/**
 * YANTRI Email Draft Engine (V4) — voice-driven one-shot email flow.
 *
 * The user speaks ONE command: "Send an email to ravi@gmail.com saying I'll
 * be late for the 3pm meeting, keep it short and formal." Yantri extracts
 * recipient + intent via `draftEmail`, the server composes a polished draft
 * (deterministic skeleton + optional Gemini polish), reads it back for
 * approval, then `sendEmail` merges and sends — all in the same turn.
 *
 * Drafts are keyed per WS client so parallel sessions don't clobber each
 * other; they expire after 10 minutes and are single-use (consumed on send).
 */

import { generateText } from "./server_llm_fallback";

export interface EmailDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** Brief/request the user actually spoke — kept for traceability. */
  request: string;
  createdAt: number;
  /** How the subject/body were produced. */
  composedBy: "skeleton" | "gemini";
  /** V5.2: reply threading — Gmail message/thread being replied to. */
  replyToMessageId?: string;
  threadId?: string;
  /** Original message's sender display form, for context in previews. */
  replyToFrom?: string;
  /** Snippet of the original email being replied to. */
  replyToSnippet?: string;
}

const DRAFT_TTL_MS = 10 * 60 * 1000;
const drafts = new Map<string, EmailDraft>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function storeDraft(wsKey: string, draft: EmailDraft): void {
  const createdAt = Number(draft.createdAt) > 0 ? draft.createdAt : Date.now();
  drafts.set(wsKey, { ...draft, createdAt });
}

export function takeDraft(wsKey: string): EmailDraft | null {
  const d = drafts.get(wsKey);
  if (!d) return null;
  drafts.delete(wsKey);
  if (Date.now() - d.createdAt > DRAFT_TTL_MS) return null;
  return d;
}

export function peekDraft(wsKey: string): EmailDraft | null {
  const d = drafts.get(wsKey);
  if (!d || Date.now() - d.createdAt > DRAFT_TTL_MS) return null;
  return d;
}

/**
 * Stable per-connection key so per-client drafts work even though the WS
 * client object isn't hashable — the server assigns a monotonic id at connect.
 */
export function wsKeyFor(clientId: number): string {
  return `ws-${clientId}`;
}

// ---------------------------------------------------------------------------
// Recipient parsing
// ---------------------------------------------------------------------------

const EMAIL_RE =
  /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|int|io|info|biz|in|co\.in|edu\.in|ac\.in|gov\.in|ac\.uk|co\.uk|uk|us|ca|de|fr|au|nz|eu)/i;

/**
 * Extract recipient addresses from spoken text:
 *   "ravi dot kumar at gmail dot com"  → ravi.kumar@gmail.com
 *   "send to a@b.com and c@d.com"      → [a@b.com, c@d.com]
 *   "email the professor"              → [] (no address — Yantri must ask)
 */
export function parseRecipients(raw: string): { to: string[]; cc: string[] } {
  const text = (raw || "").toLowerCase();

  // Spoken-form repair: "dot" → ".", " at " → "@", underscore stays.
  let repaired = text
    .replace(/\bdot\b/g, ".")
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s*,\s*/g, ",")
    // collapse spaces around @ and dots that the repair created
    // ("ravi . kumar@ gmail . com" → "ravi.kumar@gmail.com")
    .replace(/\s*@\s*/g, "@")
    .replace(/([a-z0-9])\s*\.\s*([a-z0-9])/g, "$1.$2");

  const to: string[] = [];
  const cc: string[] = [];

  // Split on "cc" to separate primary recipients from CC.
  const ccSplit = repaired.split(/\bcc\b|carbon copy\b/);
  const mainPart = ccSplit[0] || "";
  const ccPart = ccSplit.slice(1).join(" ") || "";

  const pull = (part: string): string[] => {
    const found: string[] = [];
    // 1) direct email regex on the repaired text
    const direct = part.match(new RegExp(EMAIL_RE.source, "gi")) || [];
    found.push(...direct.map((s) => s.trim().toLowerCase()));
    // 2) strip trailing punctuation artifacts from sentence boundaries
    return found.map((e) => e.replace(/[.,;:!?)']+$/, ""));
  };

  to.push(...pull(mainPart));
  cc.push(...pull(ccPart));

  // de-dup
  return {
    to: Array.from(new Set(to)),
    cc: Array.from(new Set(cc)),
  };
}

/**
 * Recipients explicitly provided as tool args (preferred over parsing speech).
 */
export function normalizeRecipients(args: {
  to?: unknown;
  cc?: unknown;
}): { to: string[]; cc: string[]; invalid: string[] } {
  const collect = (v: unknown): { ok: string[]; bad: string[] } => {
    const out: string[] = [];
    const bad: string[] = [];
    const push = (s: string) => {
      const t = s.trim().toLowerCase();
      if (!t) return;
      if (EMAIL_RE.test(t)) out.push(t);
      else bad.push(t);
    };
    if (typeof v === "string") {
      v.split(/[,;\s]+/).forEach(push);
    } else if (Array.isArray(v)) {
      v.forEach((x) => typeof x === "string" && push(x));
    }
    return { ok: out, bad };
  };
  const to = collect(args.to);
  const cc = collect(args.cc);
  return { to: to.ok, cc: cc.ok, invalid: [...to.bad, ...cc.bad] };
}

// ---------------------------------------------------------------------------
// Subject + body composition
// ---------------------------------------------------------------------------

/**
 * Infer a concise subject from the request text.
 */
export function inferSubject(request: string): string {
  const t = (request || "").trim().replace(/\s+/g, " ");
  if (!t) return "Message from Yantri";

  // "requesting extension for X" → "Request for Extension – X"
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/^(?:please\s+)?(?:i\s+)?(?:want|would like|need)\s+to\s+(?:request|ask)\s+(?:for\s+)?(.{3,60})/i,
      (m) => `Request: ${titleCase(m[1])}`],
    [/^request(?:ing)?\s+(?:an?\s+)?extension\s*(?:for|on)?\s*(.{0,50})?$/i,
      (m) => `Request for Extension${m[1] ? ` – ${titleCase(m[1])}` : ""}`],
    [/^(?:leave|absence|sick leave|absent)\b.{0,40}$/i,
      () => "Leave Request"],
    [/^meeting\s*(?:request|invite)?\b.{0,40}$/i,
      () => "Meeting Request"],
    [/^application\s*(?:for)?\s*(.{3,50})?$/i,
      (m) => `Application${m[1] ? `: ${titleCase(m[1])}` : ""}`],
    [/^follow\s*up\b.{0,40}$/i,
      () => "Follow-up"],
    [/^thank(?:s| you)\b.{0,30}$/i,
      () => "Thank You"],
    [/^remind(?:er)?\b.{0,40}$/i,
      () => "Reminder"],
    [/^inquiry|enquiry\b.{0,40}$/i,
      () => "Inquiry"],
    [/^query\s+(?:about|regarding)\s+(.{3,50})$/i,
      (m) => `Query: ${titleCase(m[1])}`],
  ];

  for (const [re, build] of patterns) {
    const m = t.match(re);
    if (m) return build(m).slice(0, 70);
  }

  // Generic fallback: first clause, title-cased, trimmed.
  const firstClause = t.split(/[.,;\n]|\s(?:and|then|also|please)\s/i)[0].trim();
  const base = titleCase(firstClause.slice(0, 50)) || "Message from Yantri";
  return base;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export interface ComposeInput {
  request: string;
  to: string[];
  cc: string[];
  tone?: "formal" | "casual" | "polite";
  userName?: string;
  userEmail?: string;
  /** Extra context from memory (e.g. professor name). */
  extraContext?: string;
}

export interface ComposedEmail {
  subject: string;
  body: string;
  composedBy: "skeleton" | "gemini";
}

/**
 * Compose a full email. Tries Gemini for natural, well-structured prose;
 * falls back to a deterministic skeleton when no API key is available or
 * generation fails — the flow must never hard-fail at composition.
 */
export async function composeEmail(
  input: ComposeInput,
  apiKey?: string
): Promise<ComposedEmail> {
  const subject = inferSubject(input.request);
  const tone = input.tone || "formal";

  // --- Try LLM polish (Gemini → Groq → OpenCode, automatic fallback) ---
  if (apiKey) {
    try {
      const prompt =
        `Write a complete, ready-to-send email for the user.\n` +
        `Request (spoken by user): "${input.request}"\n` +
        `Recipient(s): ${input.to.join(", ")}${input.cc.length ? ` (cc: ${input.cc.join(", ")})` : ""}\n` +
        `Tone: ${tone}.\n` +
        (input.userName ? `Sign as: ${input.userName}\n` : "Sign as: (user's name)\n") +
        (input.extraContext ? `Helpful context: ${input.extraContext}\n` : "") +
        `\nRules:\n` +
        `- Output ONLY the email body text (no subject line, no markdown fences).\n` +
        `- Start with an appropriate greeting ("Dear Professor Sharma,") — if the recipient name is unknown use "Hello," or "Dear Sir/Madam,".\n` +
        `- Keep it concise (3-6 short paragraphs max, or fewer for simple notes).\n` +
        `- Cover everything the user asked. Do not invent facts, dates or promises.\n` +
        `- End with a sign-off ("Best regards," / "Kind regards,") and the user's name on the next line.`;

      const resp = await generateText(prompt, { geminiApiKey: apiKey });
      const body = resp.text.trim();
      if (body.length > 40) {
        if (resp.provider !== "gemini") {
          console.log(`[EmailDraft] polished via fallback provider: ${resp.provider} (${resp.model})`);
        }
        return { subject, body, composedBy: "gemini" };
      }
    } catch (e: any) {
      console.warn("[EmailDraft] LLM composition failed, using skeleton:", e?.message || e);
    }
  }

  // --- Deterministic skeleton fallback ---------------------------------------
  const greeting = input.to.length
    ? (() => {
        const handle = input.to[0].split("@")[0].replace(/[._\-\d]+/g, " ").trim();
        const name = handle
          .split(" ")
          .filter(Boolean)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return name ? `Dear ${name},` : "Hello,";
      })()
    : "Hello,";

  const clean = input.request.trim().replace(/\s+/g, " ");
  const signOff = input.userName ? `Best regards,\n${input.userName}` : "Best regards,";
  const body = `${greeting}\n\n${clean}.\n\n${signOff}`;
  return { subject, body, composedBy: "skeleton" };
}

/**
 * Merge a stored draft into sendEmail args. Args the model passes to
 * sendEmail win over the draft (the model may have refined wording after
 * reading the preview back).
 */
export function mergeDraftWithArgs(
  draft: EmailDraft,
  args: { to?: string; subject?: string; body?: string; cc?: string }
): {
  to: string;
  subject: string;
  body: string;
  cc: string;
  inReplyTo?: string;
  threadId?: string;
} {
  return {
    to: (args.to || "").trim() || draft.to,
    subject: (args.subject || "").trim() || draft.subject,
    body: (args.body || "").trim() || draft.body,
    cc: (args.cc || "").trim() || draft.cc,
    inReplyTo: draft.replyToMessageId,
    threadId: draft.threadId,
  };
}
