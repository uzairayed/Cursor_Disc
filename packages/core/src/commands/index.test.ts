import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../projects/index.js";
import type { AppConfig } from "../config/index.js";
import type { CommandContext } from "./index.js";
import { handleUserMessage } from "./index.js";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const root = mkdtempSync(join(tmpdir(), "cwa-"));
  const projectsFile = join(root, "projects.json");
  writeFileSync(
    projectsFile,
    JSON.stringify({ crm: join(root, "crm"), fleet: join(root, "fleet") })
  );
  return {
    rootDir: root,
    projectsFile,
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir: join(root, "general"),
    cursorBin: "cursor",
    defaultProject: null,
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
    ...overrides,
  };
}

function baseCtx(
  projects: ProjectStore,
  overrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    projects,
    raw: "",
    getRunStatus: () => ({ busy: [], queuedCount: 0 }),
    stopCurrent: () => false,
    stopAllRuns: () => {},
    clearCurrentQueue: () => 0,
    clearAllQueues: () => 0,
    ...overrides,
  };
}

describe("handleUserMessage", () => {
  it("passes normal prompts to the agent when a project is set", () => {
    const projects = new ProjectStore(testConfig({ defaultProject: "crm" }));
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "Refactor auth",
    });
    expect(result.handled).toBe(false);
    expect(result.passToAgent).toBe(true);
  });

  it("lists projects conversationally", () => {
    const projects = new ProjectStore(testConfig());
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "projects",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/1\.\s*CRM/i);
    expect(result.reply).toMatch(/2\.\s*FLEET/i);
  });

  it("does not list projects on a plain greeting", () => {
    const projects = new ProjectStore(testConfig());
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "hello",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/hey/i);
    expect(result.reply).not.toMatch(/1\.\s*CRM/i);
    expect(projects.isAwaitingProjectPick()).toBe(false);
  });

  it("switches project by name", () => {
    const projects = new ProjectStore(testConfig());
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "switch to crm",
    });
    expect(result.reply).toMatch(/CRM/i);
    expect(projects.getCurrent()?.key).toBe("crm");
  });

  it("rejects unknown project names when switching", () => {
    const projects = new ProjectStore(testConfig());
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "switch to missing",
    });
    expect(result.reply).toMatch(/don't have a project/i);
    expect(result.reply).toMatch(/CRM/i);
  });

  it("stops the current project run with plain language", () => {
    let stopped = false;
    const projects = new ProjectStore(testConfig({ defaultProject: "crm" }));
    const current = projects.getCurrent()!;
    const result = handleUserMessage({
      ...baseCtx(projects, {
        getRunStatus: () => ({
          busy: [{ workspace: current.path, projectKey: "crm" }],
          queuedCount: 0,
        }),
        stopCurrent: () => {
          stopped = true;
          return true;
        },
      }),
      raw: "stop",
    });
    expect(stopped).toBe(true);
    expect(result.reply).toMatch(/stopping/i);
  });

  it("stop all clears every queue and stops all runs", () => {
    let stoppedAll = false;
    let cleared = false;
    const projects = new ProjectStore(testConfig({ defaultProject: "crm" }));
    const result = handleUserMessage({
      ...baseCtx(projects, {
        getRunStatus: () => ({
          busy: [{ workspace: projects.getCurrent()!.path, projectKey: "crm" }],
          queuedCount: 2,
        }),
        stopAllRuns: () => {
          stoppedAll = true;
        },
        clearAllQueues: () => {
          cleared = true;
          return 2;
        },
      }),
      raw: "stop all",
    });
    expect(stoppedAll).toBe(true);
    expect(cleared).toBe(true);
    expect(result.reply).toMatch(/stopping|clear/i);
  });
});
