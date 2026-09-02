import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discordProfile } from "../channels/profiles.js";
import type { DeliveryContext } from "../channels/types.js";
import type { AppConfig } from "../config/index.js";
import { DISCORD_AGENT_PREFIX } from "../prompts/agent-prompt.js";
import { MessageRouter } from "./router.js";

function setup(): AppConfig {
  const root = mkdtempSync(join(tmpdir(), "ask-mode-"));
  const workspace = join(root, "crm");
  mkdirSync(workspace);
  writeFileSync(join(root, "projects.json"), JSON.stringify({ crm: workspace }));
  return {
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
}

function delivery(replies: string[], projectKey = "crm"): DeliveryContext {
  return {
    platform: "discord",
    projectKey,
    sourceId: "u:c",
    conversationKey: "discord:c",
    surface: "project",
    maxChars: discordProfile.maxChars,
    formatOutput: discordProfile.formatOutput,
    reply: async (t) => {
      replies.push(t);
    },
  };
}

describe("MessageRouter ask mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs prompts with executionMode ask and skips plan-first", async () => {
    const config = setup();
    const router = new MessageRouter(config);
    const run = vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      return {
        stdout: "It's a React app.",
        stderr: "",
        exitCode: 0,
        durationSec: 1,
        chatId: null,
        cancelled: false,
        timedOut: false,
        usage: null,
      };
    });

    const replies: string[] = [];
    await router.handle("What stack is this?", delivery(replies), {
      executionMode: "ask",
    });

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]!.executionMode).toBe("ask");
    expect(run.mock.calls[0]![0]!.prompt).toBe(`What stack is this?\n\n${DISCORD_AGENT_PREFIX}`);
    expect(replies.some((r) => /React app/i.test(r))).toBe(true);
  });

  it("uses agent on general when the prompt needs live search", async () => {
    const config = setup();
    mkdirSync(config.generalDir, { recursive: true });
    const router = new MessageRouter(config);
    const run = vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      return {
        stdout: "Karachi headlines…",
        stderr: "",
        exitCode: 0,
        durationSec: 1,
        chatId: null,
        cancelled: false,
        timedOut: false,
        usage: null,
      };
    });

    const replies: string[] = [];
    const d = delivery(replies, "general");
    d.surface = "general";
    await router.handle("news for karachi", d);

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]!.executionMode).toBe("agent");
  });

  it("keeps ask on general for casual chat", async () => {
    const config = setup();
    mkdirSync(config.generalDir, { recursive: true });
    const router = new MessageRouter(config);
    const run = vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      return {
        stdout: "Doing well.",
        stderr: "",
        exitCode: 0,
        durationSec: 1,
        chatId: null,
        cancelled: false,
        timedOut: false,
        usage: null,
      };
    });

    const d = delivery([], "general");
    d.surface = "general";
    await router.handle("how are you", d);

    expect(run.mock.calls[0]![0]!.executionMode).toBe("ask");
  });

  it("lists projects on general without calling Cursor", async () => {
    const config = setup();
    mkdirSync(config.generalDir, { recursive: true });
    const router = new MessageRouter(config);
    const run = vi.spyOn(router.runners, "runAcquired");

    const replies: string[] = [];
    const d = delivery(replies, "general");
    d.surface = "general";
    await router.handle("list projects", d);

    expect(run).not.toHaveBeenCalled();
    expect(replies.some((r) => /CRM/i.test(r))).toBe(true);
    expect(replies.some((r) => /switch to/i.test(r))).toBe(true);
  });

  it("keeps project surface on agent unless ask is requested", async () => {
    const config = setup();
    const router = new MessageRouter(config);
    const run = vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      return {
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        durationSec: 1,
        chatId: null,
        cancelled: false,
        timedOut: false,
        usage: null,
      };
    });

    await router.handle("fix the bug", delivery([]));
    expect(run.mock.calls[0]![0]!.executionMode).toBe("agent");
  });
});
