import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/index.js";
import { ConversationManager } from "../conversation/index.js";
import { ProjectStore } from "../projects/index.js";
import type { CommandContext } from "./index.js";
import { handleUserMessage } from "./index.js";

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), "cwa-newchat-"));
  const workspace = join(root, "cliproom");
  mkdirSync(workspace);
  writeFileSync(join(root, "projects.json"), JSON.stringify({ cliproom: workspace }));
  const config: AppConfig = {
    rootDir: root,
    projectsFile: join(root, "projects.json"),
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir: join(root, "general"),
    cursorBin: "cursor",
    defaultProject: "cliproom",
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
  };
  const projects = new ProjectStore(config);
  const conversations = new ConversationManager(config.historyDir);
  conversations.setChatId("cliproom", "old-session-123");
  return { projects, conversations };
}

describe("new chat", () => {
  it("clears the Cursor session for the current project", () => {
    const { projects, conversations } = setup();
    expect(conversations.getChatId("cliproom")).toBe("old-session-123");

    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "new chat",
      conversations,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/fresh|new chat|clean slate/i);
    expect(result.reply?.toLowerCase()).toContain("cliproom");
    expect(conversations.getChatId("cliproom")).toBeNull();
  });

  it("also understands start fresh", () => {
    const { projects, conversations } = setup();
    const result = handleUserMessage({
      ...baseCtx(projects),
      raw: "start fresh",
      conversations,
    });
    expect(result.handled).toBe(true);
    expect(conversations.getChatId("cliproom")).toBeNull();
  });
});
