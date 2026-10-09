import { describe, it, expect } from "vitest";
import {
  buildFunctionDeclarations,
  DESKTOP_TOOLS,
  SERVER_TOOLS,
} from "../src/server/handlers/toolDeclarations";

describe("toolDeclarations", () => {
  it("exposes the full declaration set when nothing is gated", () => {
    const all = buildFunctionDeclarations({ allowedTools: null, agentOnline: true });
    expect(all.length).toBeGreaterThan(50);
    const names = new Set(all.map((d) => d.name));
    expect(names.has("getWeather")).toBe(true);
    expect(names.has("openApplication")).toBe(true);
    expect(names.has("searchTavily")).toBe(true);
  });

  it("withholds desktop-only tools when the agent is offline", () => {
    const gated = buildFunctionDeclarations({ allowedTools: null, agentOnline: false });
    const names = new Set(gated.map((d) => d.name));
    // Desktop-only → withheld.
    expect(names.has("openApplication")).toBe(false);
    expect(names.has("runTerminalCommand")).toBe(false);
    // Server-native → still offered.
    expect(names.has("getWeather")).toBe(true);
    expect(names.has("getNews")).toBe(true);
    expect(names.has("searchTavily")).toBe(true);
  });

  it("applies role/feature gating via allowedTools", () => {
    const gated = buildFunctionDeclarations({
      allowedTools: new Set(["getWeather"]),
      agentOnline: true,
    });
    expect(gated.map((d) => d.name)).toEqual(["getWeather"]);
  });

  it("offers every server-native tool even without the desktop agent", () => {
    const all = buildFunctionDeclarations({ allowedTools: null, agentOnline: true });
    const names = new Set(all.map((d) => d.name));
    // All server tools are declared and remain available with the agent offline.
    const offline = new Set(
      buildFunctionDeclarations({ allowedTools: null, agentOnline: false }).map((d) => d.name)
    );
    for (const t of SERVER_TOOLS) {
      expect(names.has(t)).toBe(true);
      expect(offline.has(t)).toBe(true);
    }
    // A clearly desktop-only tool is not a server-native tool.
    expect(SERVER_TOOLS.has("openApplication")).toBe(false);
    expect(DESKTOP_TOOLS.has("openApplication")).toBe(true);
  });
});
