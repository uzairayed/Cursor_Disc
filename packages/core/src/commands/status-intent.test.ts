import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandContext } from "./index.js";
import type { AppConfig } from "../config/index.js";
import { ProjectStore } from "../projects/index.js";
import { handleUserMessage } from "./index.js";

function setup(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "cwa-status-"));
  const workspace = join(root, "tagiser");
  mkdirSync(workspace);
  writeFileSync(join(root, "projects.json"), JSON.stringify({ tagiser: workspace }));
  return new ProjectStore({
    rootDir: root,
    projectsFile: join(root, "projects.json"),
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir: join(root, "general"),
    cursorBin: "cursor",
    defaultProject: "tagiser",
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
  } satisfies AppConfig);
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

describe("status intent", () => {
  it("answers when idle", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "status",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/free/i);
  });

  it("answers when busy", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...baseCtx(projects, {
        getRunStatus: () => ({
          busy: [{ workspace: projects.getCurrent()!.path, projectKey: "tagiser" }],
          queuedCount: 0,
        }),
      }),
      raw: "are you working",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/still working/i);
  });
});
