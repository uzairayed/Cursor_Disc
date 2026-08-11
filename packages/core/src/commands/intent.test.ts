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
  const root = mkdtempSync(join(tmpdir(), "cwa-intent-"));
  const cliproom = join(root, "cliproom");
  const tagiser = join(root, "tagiser");
  mkdirSync(cliproom);
  mkdirSync(tagiser);
  writeFileSync(join(root, "projects.json"), JSON.stringify({ cliproom, tagiser }));
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

const idleCtx = (projects: ProjectStore) => baseCtx(projects);

describe("conversational intents", () => {
  it("greetings reply naturally without dumping the project list", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: "Hi",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/hey/i);
    expect(result.reply).toMatch(/cliproom/i);
    expect(result.reply).not.toMatch(/1\.\s*CLIPROOM/i);
    expect(result.reply?.toLowerCase()).not.toContain("*projects:*");
  });

  it("help lists the projects and how to switch, without slash commands", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: "help",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/hey|hi|hello/i);
    expect(result.reply).toMatch(/1\.\s*CLIPROOM/i);
    expect(result.reply).toMatch(/switch to <name>/i);
    expect(result.reply).toMatch(/reply with its number/i);
    expect(result.reply).not.toContain("/project");
  });

  it("sends a normal prompt to the agent in the surface's project", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: "fix the login bug",
    });
    expect(result.handled).toBe(false);
    expect(result.passToAgent).toBe(true);
  });

  it("stops with plain language", () => {
    let stopped = false;
    const projects = setup();
    const result = handleUserMessage({
      ...baseCtx(projects, {
        getRunStatus: () => ({
          busy: [{ workspace: projects.resolve("cliproom")!.path, projectKey: "cliproom" }],
          queuedCount: 0,
        }),
        stopProject: () => {
          stopped = true;
          return true;
        },
      }),
      raw: "stop",
    });
    expect(stopped).toBe(true);
    expect(result.reply).toMatch(/stop/i);
  });
});
