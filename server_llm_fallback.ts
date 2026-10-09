/**
 * YANTRI — Multi-provider text LLM fallback.
 *
 * Plain text-generation calls (memory consolidation, email drafting, future
 * summarizers) first hit Gemini with the user's GEMINI_API_KEY; if Gemini is
 * unconfigured/unreachable/rate-limited, the identical prompt runs on Groq
 * (GROQ_API_KEY) and then OpenCode-compatible providers (OPENCODE_API_KEY +
 * optional OPENCODE_BASE_URL / OPENCODE_MODEL). Nothing here touches the
 * Live voice path — that stays Gemini-only by necessity (audio bidi).
 *
 * Keys live in .env / host env only. OpenCode is the open "any OpenAI-base-URL
 * compatible" slot, so BYO gateway (openrouter, LM studio, etc.) works too.
 *
 * Env contract (.env.example documents all):
 *   GEMINI_API_KEY     primary
 *   GROQ_API_KEY       fallback 1   (https://api.groq.com/openai/v1)
 *   OPENCODE_API_KEY   fallback 2   (https://opencode.ai/zen/v1) — free-tier keys are
 *                      OpenCode-client-only; server-side use needs a paid key or a
 *                      different OpenAI-compatible gateway via OPENCODE_BASE_URL
 *   OPENCODE_BASE_URL  optional base URL (default https://api.opencode.ai/v1)
 *   OPENCODE_MODEL     optional model override (default model decided by provider)
 */

const GROQ_BASE = "https://api.groq.com/openai/v1";
/**
 * OpenCode hosts its OpenAI-compatible gateway at opencode.ai/zen/v1
 * (api.opencode.ai/v1 is not the chat path). Overridable for BYO gateways.
 * NOTE: OpenCode's FREE-tier keys are restricted to their own client —
 * server-side API use requires a paid tier key. A unusable-tier key fails
 * fast with a clear message and the chain simply moves to the next provider.
 */
const OPENCODE_BASE = process.env.OPENCODE_BASE_URL?.trim() || "https://opencode.ai/zen/v1";
const OPENCODE_MODEL = process.env.OPENCODE_MODEL?.trim() || "mimo-v2.6-flash-free";
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "qwen/qwen3.8-27b";
const TIMEOUT_MS = 25_000;

export interface LLMResult {
  text: string;
  provider: "gemini" | "groq" | "opencode";
  model: string;
}

/** Best-effort single-shot text completion via OpenAI-compatible chat API. */
async function openAICompatibleChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  wantJson: boolean,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: wantJson
              ? "You are a precise data-processing engine. Output ONLY valid JSON matching the requested schema. No prose, no markdown fences."
              : "You are a helpful assistant.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`provider HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as any;
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("provider returned an empty completion");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate plain text. Tries Gemini → Groq → OpenCode in order; any provider
 * without a configured key is skipped. Throws only when every provider fails
 * (or none is configured).
 */
export async function generateText(
  prompt: string,
  opts: { geminiApiKey?: string; wantJson?: boolean } = {},
): Promise<LLMResult> {
  const failures: string[] = [];

  // ── 1. Gemini (primary) ──
  if (opts.geminiApiKey) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: opts.geminiApiKey });
      const resp = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: prompt,
        ...(opts.wantJson ? { config: { responseMimeType: "application/json" } } : {}),
      });
      const text = (resp.text || "").trim();
      if (text) return { text, provider: "gemini", model: "gemini-flash-latest" };
      failures.push("gemini: empty response");
    } catch (e: any) {
      failures.push(`gemini: ${e?.message || e}`);
    }
  } else {
    failures.push("gemini: no key");
  }

  // ── 2. Groq ──
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    try {
      const text = await openAICompatibleChat(GROQ_BASE, groqKey, GROQ_MODEL, prompt, !!opts.wantJson);
      return { text, provider: "groq", model: GROQ_MODEL };
    } catch (e: any) {
      failures.push(`groq: ${e?.message || e}`);
    }
  } else {
    failures.push("groq: no key");
  }

  // ── 3. OpenCode / OpenAI-compatible ──
  const ocKey = process.env.OPENCODE_API_KEY?.trim();
  if (ocKey) {
    try {
      const text = await openAICompatibleChat(OPENCODE_BASE, ocKey, OPENCODE_MODEL, prompt, !!opts.wantJson);
      return { text, provider: "opencode", model: OPENCODE_MODEL };
    } catch (e: any) {
      failures.push(`opencode: ${e?.message || e}`);
    }
  } else {
    failures.push("opencode: no key");
  }

  throw new Error("All LLM providers failed — " + failures.join(" | "));
}
