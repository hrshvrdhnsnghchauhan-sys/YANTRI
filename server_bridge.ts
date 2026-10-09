/**
 * YANTRI Desktop Agent bridge — HTTP client for the Python FastAPI backend.
 *
 * Extracted from server.ts (V4) so other server-side modules
 * (server_calendar_sync.ts) can route tools to the desktop agent without
 * circular imports. Behavior is unchanged from the original inline code:
 *   - lazy ensure (probe /health, auto-spawn if down)
 *   - 25s timeout, friendly error payloads, command logging
 */

import path from "path";
import { spawn } from "child_process";
import * as fs from "fs";
import { DATA_DIR } from "./server_paths";

// Command logging (same convention as server.ts — best-effort, never throws).
const BRIDGE_LOGS_DIR = path.join(DATA_DIR, "logs");
function logCommandSafe(m: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${m}\n`;
    fs.appendFile(path.join(BRIDGE_LOGS_DIR, "commands.log"), line, () => {});
  } catch {
    /* best-effort */
  }
}

const DESKTOP_AGENT_TIMEOUT = 25_000; // ms

/**
 * Whether the desktop agent has been confirmed alive in this process lifetime.
 * If false, callDesktopAgent will probe /health and attempt an auto-spawn.
 */
let desktopAgentVerified = false;

/**
 * Backoff after a failed probe/spawn. Without this, every desktop tool call
 * while the agent is down re-ran the full 20x1s spawn poll, so ten commands
 * cost ~200s of dead air. Now we re-probe at most once per cooldown.
 */
const AGENT_RESPAWN_COOLDOWN_MS = 60_000;
let agentUnavailableUntil = 0;
let lastSpawnNote = "";

function logStartup(m: string): void { try { console.log(m); } catch {} }
function logError(m: string): void { try { console.error(m); } catch {} }

/** Whether a Python interpreter can actually import the agent's deps. */
async function pythonHasAgentDeps(py: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(py, ["-c", "import fastapi, uvicorn"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Auto-spawn the Python desktop agent as a detached child process if it is not
 * already listening. Looks for the project's bundled Python interpreter first,
 * falling back to `python` / `python3` on PATH. Runs detached so it survives
 * even if YANTRI's node process is killed.
 */
async function spawnDesktopAgent(): Promise<void> {
  const agentEnv = {
    ...process.env,
    YANTRI_AGENT_HOST: "127.0.0.1",
    YANTRI_AGENT_PORT: "8765",
  };

  // Preferred path (packaged app): a PyInstaller-frozen agent exe that embeds
  // its own Python runtime. Set by the Electron main process via YANTRI_AGENT_EXE.
  const frozenExe = process.env.YANTRI_AGENT_EXE;
  if (frozenExe && fs.existsSync(frozenExe)) {
    try {
      const child = spawn(frozenExe, [], {
        cwd: path.dirname(frozenExe),
        detached: true,
        stdio: "ignore",
        windowsHide: true, // never flash a console window
        env: agentEnv,
      });
      child.unref();
      logStartup(`AGENT_SPAWN frozen exe pid=${child.pid} path=${frozenExe}`);
      console.log(`[Desktop Agent] Launched frozen agent (PID ${child.pid}).`);
      return;
    } catch (e: any) {
      logError(`AGENT_SPAWN_FROZEN_FAILED: ${e?.message || e}`);
      // fall through to the Python path below
    }
  }

  // Development fallback: run the agent from source using a local Python.
  // Prefer an interpreter that actually has the agent's deps installed —
  // spawning bare `python3` just to have uvicorn fail is worse than not spawning.
  const candidates = [
    process.env.YANTRI_PYTHON,
    path.join(process.cwd(), ".venv", "bin", "python"),
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "venv", "bin", "python"),
    "python3",
    "python",
  ].filter(Boolean) as string[];

  const usable: string[] = [];
  for (const p of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(p, ["--version"], { stdio: "ignore" });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject()));
      });
      usable.push(p);
    } catch {
      // not usable
    }
  }
  const py = usable.find((p) => pythonHasAgentDeps(p));

  if (!py) {
    // Distinguish "no Python at all" from "Python present, deps missing" —
    // the second is the common case and needs an actionable hint.
    const hint = usable.length
      ? "Python found but fastapi/uvicorn are missing. Install them:\n" +
        `    ${path.join(process.cwd(), ".venv", "bin", "python")} -m pip install -r agent/requirements.txt`
      : "No Python interpreter found on PATH.";
    console.warn(`[Desktop Agent] Cannot auto-start: ${hint}`);
    logError("AGENT_SPAWN_NO_DEPS: " + hint);
    lastSpawnNote = hint;
    return;
  }
  try {
    const child = spawn(
      py,
      ["-m", "uvicorn", "agent.server:app", "--host", "127.0.0.1", "--port", "8765"],
      { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true, env: agentEnv }
    );
    child.unref();
    logStartup(`AGENT_SPAWN python pid=${child.pid}`);
    // Deliberately NOT claiming success here — ensureDesktopAgent() confirms
    // readiness via /health before desktopAgentVerified is set.
    console.log(`[Desktop Agent] Spawned via ${py} (PID ${child.pid}), waiting for readiness...`);
  } catch (e: any) {
    console.warn(`[Desktop Agent] Auto-spawn failed: ${e?.message || e}`);
    logError(`AGENT_SPAWN_PYTHON_FAILED: ${e?.message || e}`);
  }
}

/** Desktop agent base URL (re-exported for health probes in server.ts). */
export const DESKTOP_AGENT_URL = process.env.DESKTOP_AGENT_URL || "http://127.0.0.1:8765";

export const IS_CLOUD_MODE = process.env.CLOUD_MODE === "true";

/**
 * Probe the desktop agent /health endpoint. Returns true if it responds 200.
 */
async function isDesktopAgentAlive(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Why the desktop agent is unavailable, when it is. Surfaced through
 * /api/config so onboarding and health UIs can show an actionable reason
 * ("missing deps") instead of a bare offline flag.
 */
let lastUnavailability: string | null = null;
export function getDesktopAgentUnavailability(): string | null {
  return lastUnavailability;
}

/**
 * Cheap non-spawning availability probe for boot-time UI and gating:
 * attempts a fast /health ping (2s) but never auto-spawns the agent.
 * Use callDesktopAgent/ensureDesktopAgent when you actually want a spawn
 * attempt; use this when you only want to know "is it there right now".
 */
export async function isDesktopAgentAvailable(): Promise<boolean> {
  if (IS_CLOUD_MODE) return false;
  return isDesktopAgentAlive();
}

/**
 * Ensure the desktop agent is running. If not verified yet, probe health; if
 * down, auto-spawn and poll until it is ready (or timeout).
 *
 * Cooldown: after a failed spawn we refuse to re-probe for AGENT_RESPAWN_COOLDOWN_MS
 * so a batch of tool calls while the agent is down costs one timeout, not N.
 * Concurrent callers share the in-flight attempt instead of each starting one.
 */
let inFlightEnsure: Promise<void> | null = null;

export async function ensureDesktopAgent(): Promise<void> {
  if (IS_CLOUD_MODE) {
    console.log("[Desktop Agent] Cloud Mode enabled. Skipping auto-spawn.");
    return;
  }
  if (desktopAgentVerified) return;

  // Inside cooldown: return immediately so callers get their error fast.
  if (Date.now() < agentUnavailableUntil) return;

  // Deduplicate concurrent callers onto a single probe/spawn attempt.
  if (inFlightEnsure) return inFlightEnsure;

  inFlightEnsure = (async () => {
    if (await isDesktopAgentAlive()) {
      desktopAgentVerified = true;
      agentUnavailableUntil = 0;
      lastUnavailability = null;
      console.log("[Desktop Agent] Already running.");
      return;
    }
    console.log("[Desktop Agent] Not detected. Auto-starting...");
    await spawnDesktopAgent();
    for (let i = 1; i <= 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await isDesktopAgentAlive()) {
        desktopAgentVerified = true;
        agentUnavailableUntil = 0;
        console.log(`[Desktop Agent] Online after ${i}s.`);
        return;
      }
    }
    // Arm the cooldown so the next N tool calls fail fast instead of retrying.
    agentUnavailableUntil = Date.now() + AGENT_RESPAWN_COOLDOWN_MS;
    desktopAgentVerified = false;
    const detail = lastSpawnNote ? lastSpawnNote : "Did not respond to health probe within 20s.";
    lastUnavailability = detail;
    const hintLine = "Desktop control unavailable; retrying in " + (AGENT_RESPAWN_COOLDOWN_MS / 1000) + "s.";
    console.warn(`[Desktop Agent] Did not come online within 20s. ${detail.split("\n")[0]} ${hintLine}`);
    logError(`AGENT_UNAVAILABLE: ${detail}`);
  })().finally(() => {
    inFlightEnsure = null;
  });

  return inFlightEnsure;
}

/**
 * Call the Python desktop agent.  Returns the parsed JSON response.
 * If the agent is unreachable, returns a user-friendly error payload.
 */
// Shared secret for Node ↔ Python agent authentication
const AGENT_SHARED_SECRET = process.env.AGENT_SHARED_SECRET || "";

export async function callDesktopAgent(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (IS_CLOUD_MODE) {
    // Instant rejection: no probe, no spawn, no dead-air.
    logCommandSafe(`EXECUTE ${tool} (rejected — cloud mode)`);
    return { ok: false, error: "Desktop control is disabled in Cloud Mode." };
  }
  // Lazy ensure: if we haven't verified the agent, try (re)starting it once.
  if (!desktopAgentVerified) {
    await ensureDesktopAgent();
  }
  try {
    logCommandSafe(`EXECUTE ${tool} ${JSON.stringify(args)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DESKTOP_AGENT_TIMEOUT);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (AGENT_SHARED_SECRET) {
      headers["X-Agent-Secret"] = AGENT_SHARED_SECRET;
    }

    const res = await fetch(`${DESKTOP_AGENT_URL}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tool, args }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logError(`AGENT_HTTP_${res.status} ${tool}: ${text.substring(0, 200)}`);
      return { ok: false, error: `Desktop agent HTTP ${res.status}: ${text}` };
    }
    return await res.json();
  } catch (err: any) {
    if (IS_CLOUD_MODE) {
      return { ok: false, error: "Desktop control is disabled in Cloud Mode." };
    }
    // Mark stale so the next call re-checks health — but keep the cooldown
    // armed so "next call" fails fast rather than burning another 20s poll.
    desktopAgentVerified = false;
    lastUnavailability = lastSpawnNote || "Agent process is not reachable on " + DESKTOP_AGENT_URL;
    const msg = err?.name === "AbortError"
      ? "Desktop agent timed out."
      : lastSpawnNote
        ? `Desktop agent could not start: ${lastSpawnNote.split("\n")[0]} (troubleshooting detail in server errors.log)`
        : "Desktop agent is not running. Start it with: uvicorn agent.server:app --port 8765";
    logError(`AGENT_UNREACHABLE ${tool}: ${msg}`);
    return { ok: false, error: msg };
  }
}
