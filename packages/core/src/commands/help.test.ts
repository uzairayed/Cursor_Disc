import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/index.js";
import { ProjectStore } from "../projects/index.js";
import type { CommandContext } from "./index.js";
import { handleUserMessage } from "./index.js";

function baseCtx(projects: ProjectStore, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    projects,
    project: projects.resolve("cliproom")!,
    raw: "",
    getRunStatus: () => ({ busy: [], queuedCount: 0 }),
    stopProject: () => false,
    stopAllRuns: () => {},
    clearProjectQueue: () => 0,
    clearAllQueues: () => 0,
    ...overrides,
  };
}

function setup(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "cwa-help-"));
  const workspace = join(root, "cliproom");
  mkdirSync(workspace);
  writeFileSync(
    join(root, "projects.json"),
    JSON.stringify({ cliproom: workspace, tagiser: join(root, "tagiser") }),
  );
  mkdirSync(join(root, "tagiser"));
  const config: AppConfig = {
    rootDir: root,
    projectsFile: join(root, "projects.json"),
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir: join(root, "general"),
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

describe("help", () => {
  it("sounds human and prompts a numbered project choice", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "help",
    });

    expect(result.reply).toMatch(/hey|hi|hello/i);
    expect(result.reply).toMatch(/just text|text me|send/i);
    expect(result.reply?.toLowerCase()).toContain("cliproom");
    expect(result.reply).toMatch(/1\./);
    expect(result.reply).toMatch(/new chat/i);
    expect(result.reply).not.toContain("/project");
  });
});
