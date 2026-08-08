import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/index.js";
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

function setup(opts: { defaultProject?: string | null } = {}): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "cwa-intent-"));
  const cliproom = join(root, "cliproom");
  const tagiser = join(root, "tagiser");
  mkdirSync(cliproom);
  mkdirSync(tagiser);
  writeFileSync(
    join(root, "projects.json"),
    JSON.stringify({ cliproom, tagiser })
  );
  const config: AppConfig = {
    rootDir: root,
    projectsFile: join(root, "projects.json"),
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir: join(root, "general"),
    cursorBin: "cursor",
    defaultProject: opts.defaultProject ?? null,
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
  return new ProjectStore(config);
}

const idleCtx = (projects: ProjectStore) => baseCtx(projects);

describe("conversational intents", () => {
  it("greetings reply naturally without dumping the project list", () => {
    const projects = setup({ defaultProject: "cliproom" });
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: "Hi",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/hey/i);
    expect(result.reply).toMatch(/cliproom/i);
    expect(result.reply).not.toMatch(/1\.\s*CLIPROOM/i);
    expect(result.reply?.toLowerCase()).not.toContain("*projects:*");
    expect(projects.isAwaitingProjectPick()).toBe(false);
  });

  it("help asks the user to pick a project by number, without slash commands", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: "help",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/hey|hi|hello/i);
    expect(result.reply).toMatch(/1\.\s*CLIPROOM/i);
    expect(result.reply).toMatch(/reply with (a )?number|just reply/i);
    expect(result.reply).not.toContain("/project");
    expect(projects.isAwaitingProjectPick()).toBe(true);
  });

  it("accepts a number to choose a project", () => {
    const projects = setup();
    handleUserMessage({ ...idleCtx(projects), raw: "help" });
    const tagiserNum = projects.list().indexOf("tagiser") + 1;
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: String(tagiserNum),
    });
    expect(result.reply).toMatch(/tagiser/i);
    expect(projects.getCurrent()?.key).toBe("tagiser");
    expect(projects.isAwaitingProjectPick()).toBe(false);
  });

  it("understands switch to <name>", () => {
    const projects = setup({ defaultProject: "tagiser" });
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: "switch to cliproom",
    });
    expect(result.handled).toBe(true);
    expect(projects.getCurrent()?.key).toBe("cliproom");
    expect(result.reply).toMatch(/cliproom/i);
  });

  it("prompts to choose a project before running a normal prompt", () => {
    const projects = setup();
    const result = handleUserMessage({
      ...idleCtx(projects),
      raw: "fix the login bug",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/which project/i);
    expect(result.reply).toMatch(/1\./);
    expect(projects.isAwaitingProjectPick()).toBe(true);
  });

  it("stops with plain language", () => {
    let stopped = false;
    const projects = setup({ defaultProject: "cliproom" });
    const result = handleUserMessage({
      ...baseCtx(projects, {
        getRunStatus: () => ({
          busy: [{ workspace: projects.getCurrent()!.path, projectKey: "cliproom" }],
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
    expect(result.reply).toMatch(/stop/i);
  });
});
