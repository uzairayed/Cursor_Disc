import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/index.js";
import { ProjectStore } from "../projects/index.js";
import { parseProjectIntent } from "./project-intent.js";

function store(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "cwa-intent-"));
  const generalDir = join(root, "general");
  writeFileSync(
    join(root, "projects.json"),
    JSON.stringify({
      aliases: {
        crm: join(root, "crm"),
        fleet: join(root, "fleet"),
      },
    }),
  );
  const config: AppConfig = {
    rootDir: root,
    projectsFile: join(root, "projects.json"),
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir,
    cursorBin: "cursor",
    appName: "CursorDiscord",
    cursorTimeoutMin: 15,
    openaiApiKey: null,
    voiceTtsVoice: "alloy",
    voiceSttMode: "realtime",
    retentionDays: 7,
    previewDefaultPort: 3000,
    previewCloudflaredBin: "cloudflared",
    previewPortsEnv: null,
    cursorPlanModel: null,
    cursorAgentModel: null,
    cursorAskModel: null,
    cursorMaxConcurrent: 3,
    logPrompts: false,
    bridgeHost: "test-host",
  };
  return new ProjectStore(config);
}

describe("parseProjectIntent", () => {
  it("parses switch to / bare name / list / current", () => {
    const projects = store();
    expect(parseProjectIntent("switch to crm", projects)).toEqual({
      action: "select",
      key: "crm",
    });
    expect(parseProjectIntent("fleet", projects)).toEqual({
      action: "select",
      key: "fleet",
    });
    expect(parseProjectIntent("general", projects)?.action).toBe("select");
    expect(parseProjectIntent("projects", projects)).toEqual({ action: "list" });
    expect(parseProjectIntent("what project am I on?", projects)).toEqual({
      action: "current",
    });
  });

  it("parses picker numbers when allowed", () => {
    const projects = store();
    const keys = projects.list();
    const crmIndex = keys.indexOf("crm") + 1;
    expect(parseProjectIntent(String(crmIndex), projects, { allowNumber: true })).toEqual({
      action: "select",
      key: "crm",
    });
    expect(parseProjectIntent(String(crmIndex), projects)).toBeNull();
  });

  it("resolves 'switch to <number>' against the picker, digits or words", () => {
    const projects = store();
    const keys = projects.list();
    const second = keys[1]!;
    // No allowNumber needed: "switch to" names the picker slot explicitly.
    expect(parseProjectIntent("switch to 2", projects)).toEqual({ action: "select", key: second });
    expect(parseProjectIntent("switch to project 2", projects)).toEqual({
      action: "select",
      key: second,
    });
    expect(parseProjectIntent("switch to two", projects)).toEqual({ action: "select", key: second });
    expect(parseProjectIntent(`switch to ${keys.length + 1}`, projects)).toBeNull();
  });

  it("returns null for normal prompts", () => {
    const projects = store();
    expect(parseProjectIntent("refactor the auth middleware", projects)).toBeNull();
  });
});
