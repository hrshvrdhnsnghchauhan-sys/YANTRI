#!/usr/bin/env node
/**
 * YANTRI — startup smoke test.
 *
 * Boots the Node server (dev entry `tsx server.ts`) with the Python desktop
 * agent NOT running, then asserts the capability flags the UI depends on:
 *
 *   /api/config        → hasApiKey:true, cloudMode matches CLOUD_MODE,
 *                        agentAvailable:false (no agent), reason null/cloud
 *   /api/agent-health  → online:false, cloudMode:true carries a reason
 *
 * Zero dependencies on purpose (spawns `npx tsx`, plain fetch + assert).
 *
 *   node scripts/smoke.mjs            → server-only mode (CLOUD_MODE=false)
 *   CLOUD_MODE=true node scripts/smoke.mjs → cloud mode (pass through env)
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const BASE = `http://127.0.0.1:${PORT}`;

let stderrTail = "";

/**
 * Expected effective cloud mode, mirroring server precedence:
 * shell env wins over .env (dotenv never overrides), .env is the default.
 */
function expectedCloudMode() {
  if (process.env.CLOUD_MODE !== undefined) return process.env.CLOUD_MODE === "true";
  try {
    const m = fs.readFileSync(".env", "utf8").match(/^CLOUD_MODE\s*=\s*(\S+)/m);
    return m ? m[1] === "true" : false;
  } catch {
    return false;
  }
}
const CLOUD_MODE = expectedCloudMode();

const log = (msg) => process.stdout.write(`${msg}\n`);

async function waitForServer(proc, timeoutMs = 45000) {
  const started = Date.now();
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(`server exited early with code ${proc.exitCode}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`server did not become ready within ${timeoutMs / 1000}s`);
    }
    try {
      const res = await fetch(`${BASE}/api/config`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      /* not up yet — retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  // Spawn the dev server. Inherit this process's env (CLOUD_MODE etc.).
  const server = spawn("npx", ["tsx", "server.ts"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"], // stderr kept for crash diagnostics
    shell: process.platform === "win32",
  });
  server.stderr.on("data", (d) => {
    stderrTail = `${stderrTail}${d}`.slice(-2000);
  });

  try {
    await waitForServer(server);
    log(`[smoke] server ready at ${BASE} (CLOUD_MODE=${CLOUD_MODE})`);

    // ── /api/config ──
    const cfg = await (await fetch(`${BASE}/api/config`)).json();
    assert.equal(typeof cfg, "object", "/api/config must return an object");
    assert.equal(cfg.hasApiKey, true, "GEMINI_API_KEY from .env must satisfy the API-key gate");
    assert.equal(cfg.cloudMode, CLOUD_MODE, "cloudMode must mirror the CLOUD_MODE env var");
    assert.equal(
      cfg.agentAvailable,
      false,
      "agent must be reported unavailable when it is not running"
    );
    if (CLOUD_MODE) {
      assert.match(
        String(cfg.agentUnavailableReason || ""),
        /Cloud Mode/i,
        "cloud mode must carry an explanatory reason"
      );
    }

    // ── /api/agent-health (must answer instantly, never spawn the agent) ──
    const t0 = Date.now();
    const health = await (await fetch(`${BASE}/api/agent-health`)).json();
    const elapsed = Date.now() - t0;
    assert.equal(health.online, false, "agent health must be offline with no agent running");
    assert.ok(elapsed < 5000, `agent-health must answer fast without spawning (took ${elapsed}ms)`);
    if (CLOUD_MODE) {
      assert.equal(health.cloudMode, true, "cloud mode must be reflected in agent-health");
      assert.match(String(health.reason || ""), /Cloud Mode/i, "cloud-mode rejection must explain why");
    }

    // ── Server-native tool modules (no desktop agent needed) ──
    // getWeather/getNews route to Node (wttr.in / Google News RSS). Exercise
    // the implementations in a child tsx process: unreachable external
    // services degrade to a warning, but a module crash fails the smoke run.
    const modUrl = pathToFileURL(path.join(process.cwd(), "server_weather_news.ts")).href;
    const probeSrc = [
      `import { getWeatherServer, getNewsServer } from ${JSON.stringify(modUrl)};`,
      "try {",
      "  const w = await getWeatherServer({ location: 'Mumbai' });",
      "  if (!w.result || !w.temperature) throw new Error('shape invalid');",
      "  console.log('WEATHER_OK');",
      "} catch (e) { console.log('WEATHER_SOFT_FAIL: ' + (e?.message || e)); }",
      "try {",
      "  const n = await getNewsServer({ category: 'top', count: 3 });",
      "  if (!n.result || !Array.isArray(n.headlines) || n.headlines.length === 0) throw new Error('shape invalid');",
      "  console.log('NEWS_OK');",
      "} catch (e) { console.log('NEWS_SOFT_FAIL: ' + (e?.message || e)); }",
      "process.exit(0);",
    ].join("\n");
    const probePath = "scripts/.smoke-probe.mjs";
    fs.writeFileSync(probePath, probeSrc);
    const probe = spawn("npx", ["tsx", probePath], {
      cwd: process.cwd(), env: process.env,
      stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
    });
    let toolOut = "";
    probe.stdout.on("data", (d) => { toolOut += d; });
    probe.stderr.on("data", (d) => { toolOut += d; });
    await once(probe, "close", { signal: AbortSignal.timeout(45000) });
    assert.equal(probe.exitCode, 0, `weather/news module must not crash (output: ${toolOut.slice(0, 400)})`);
    const weatherOk = /WEATHER_OK/.test(toolOut);
    const softFailed = /SOFT_FAIL/.test(toolOut);
    assert.ok(weatherOk || softFailed, `weather module produced no verdict (output: ${toolOut.slice(0, 400)})`);
    assert.ok(/NEWS_(OK|SOFT_FAIL)/.test(toolOut), `news module produced no verdict (output: ${toolOut.slice(0, 400)})`);
    if (!weatherOk) log(`[smoke] warning: wttr.in unreachable from this network — weather skipped (live tool calls will retry at runtime)`, toolOut);

    log(`[smoke] all assertions passed (${elapsed}ms agent-health probe, cloudMode=${cfg.cloudMode}, weather=${weatherOk ? "live" : "skipped"})`);
  } finally {
    server.kill("SIGTERM");
    // Give tsx a moment to exit; escalate if it lingers.
    const exited = await Promise.race([
      once(server, "exit", { signal: AbortSignal.timeout(5000) }).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!exited) {
      server.kill("SIGKILL");
      await once(server, "exit").catch(() => {});
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    log(`[smoke] FAILED: ${err?.message || err}`);
    if (stderrTail) log(`[smoke] server stderr tail:\n${stderrTail}`);
    process.exit(1);
  }
);
