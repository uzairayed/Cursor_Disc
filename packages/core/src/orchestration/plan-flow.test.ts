import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryContext } from "../channels/types.js";
import { discordProfile } from "../channels/profiles.js";
import type { AppConfig } from "../config/index.js";
import { MessageRouter } from "../commands/router.js";

function setup(): {
  config: AppConfig;
  router: MessageRouter;
  workspace: string;
} {
  const root = mkdtempSync(join(tmpdir(), "cwa-plan-flow-"));
  const workspace = join(root, "crm");
  mkdirSync(workspace);
  writeFileSync(join(root, "projects.json"), JSON.stringify({ crm: workspace }));
  const config: AppConfig = {
    rootDir: root,
    projectsFile: join(root, "projects.json"),
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir: join(root, "general"),
    cursorBin: "cursor",
    defaultProject: "crm",
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
  return { config, router: new MessageRouter(config), workspace };
}

function delivery(replies: string[]): DeliveryContext {
  return {
    platform: "discord",
    reply: async (t) => {
      replies.push(t);
    },
    formatOutput: discordProfile.formatOutput,
    maxChars: discordProfile.maxChars,
  };
}

describe("plan-first router flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the user to enter plan mode for large prompts (does not run yet)", async () => {
    const { router } = setup();
    const run = vi.spyOn(router.runners, "runAcquired");
    const replies: string[] = [];
    const largePrompt = "x".repeat(400);

    await router.handle(largePrompt, delivery(replies));

    expect(run).not.toHaveBeenCalled();
    expect(replies.join("\n")).toMatch(/plan/i);
    expect(replies.join("\n")).toMatch(/run/i);
    expect(router.projects.getPendingLargePrompt()?.userPrompt).toBe(largePrompt);
  });

  it("plan runs Cursor in plan mode and stores a pending plan", async () => {
    const { router } = setup();
    router.projects.setPendingLargePrompt({
      projectKey: "crm",
      userPrompt: "x".repeat(400),
    });

    const run = vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      return {
        stdout: "1. Do the thing\n2. Tests",
        stderr: "",
        exitCode: 0,
        durationSec: 1,
        chatId: "sess",
        cancelled: false,
        timedOut: false,
        usage: null,
      };
    });

    const replies: string[] = [];
    let msgSeq = 0;
    const reacted: string[] = [];
    const d = delivery(replies);
    d.reply = async (t) => {
      replies.push(t);
      msgSeq += 1;
      return { messageId: `plan-msg-${msgSeq}` };
    };
    d.reactToMessage = async (messageId, emoji) => {
      reacted.push(`${messageId}:${emoji}`);
    };

    await router.handle("plan", d);

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]!.executionMode).toBe("plan");
    expect(router.projects.getPendingLargePrompt()).toBeNull();
    expect(router.projects.getPendingPlan()?.planText).toMatch(/Do the thing/);
    expect(router.projects.getPendingPlan()?.approvalMessageId).toBe(`plan-msg-${msgSeq}`);
    expect(reacted).toEqual([`plan-msg-${msgSeq}:✅`]);
    expect(replies.join("\n")).toMatch(/\*\*go\*\*|\*go\*/i);
    expect(replies.join("\n")).toContain("✅");
  });

  it("go runs an agent implement pass from the pending plan", async () => {
    const { router } = setup();
    router.projects.setPendingPlan({
      projectKey: "crm",
      userPrompt: "big task",
      planText: "1. Capture Vipps",
    });

    const run = vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      return {
        stdout: "done",
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
    await router.handle("go", delivery(replies));

    expect(run.mock.calls[0]![0]!.executionMode).toBe("agent");
    expect(run.mock.calls[0]![0]!.prompt).toMatch(/approved plan/i);
    expect(router.projects.getPendingPlan()).toBeNull();
  });

  it("go starts a fresh Cursor session (no resume of the plan chat)", async () => {
    const { router } = setup();
    const d = delivery([]);
    d.conversationKey = "discord:thread-1";
    d.surface = "project";

    const storageKey = "crm__discord:thread-1";
    router.conversations.setChatId(storageKey, "plan-session-fat");
    router.projects.setPendingPlan({
      projectKey: "crm",
      userPrompt: "big task",
      planText: "1. Capture Vipps",
      conversationKey: "discord:thread-1",
    });

    const run = vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      return {
        stdout: "done",
        stderr: "",
        exitCode: 0,
        durationSec: 1,
        chatId: "implement-session",
        cancelled: false,
        timedOut: false,
        usage: null,
      };
    });

    await router.handle("go", d);

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]!.resume).toBe(false);
    expect(router.conversations.getChatId(storageKey)).not.toBe("plan-session-fat");
  });

  it("cancel plan clears pending state", async () => {
    const { router } = setup();
    router.projects.setPendingLargePrompt({
      projectKey: "crm",
      userPrompt: "big",
    });
    const replies: string[] = [];
    await router.handle("cancel plan", delivery(replies));
    expect(router.projects.getPendingLargePrompt()).toBeNull();
    expect(replies.join("\n")).toMatch(/cleared/i);
  });

  it("keeps pending large prompt when queue is full after plan", async () => {
    const { router, workspace } = setup();
    const replies: string[] = [];
    const d = delivery(replies);

    expect(router.runners.tryAcquire(workspace, "crm")).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(
        router.queues.enqueue({
          prompt: `q-${i}`,
          delivery: d,
          projectKey: "crm",
          workspace,
        }).ok
      ).toBe(true);
    }

    const large = "x".repeat(400);
    router.projects.setPendingLargePrompt({
      projectKey: "crm",
      userPrompt: large,
    });

    await router.handle("plan", d);
    expect(replies.some((r) => /queue is full/i.test(r))).toBe(true);
    expect(router.projects.getPendingLargePrompt()?.userPrompt).toBe(large);
  });

  it("go on a large-prompt hold enters plan mode", async () => {
    const { router } = setup();
    const replies: string[] = [];
    let msgSeq = 0;
    const d: DeliveryContext = {
      platform: "discord",
      reply: async (t) => {
        replies.push(t);
        msgSeq += 1;
        return { messageId: `plan-msg-${msgSeq}` };
      },
      formatOutput: discordProfile.formatOutput,
      maxChars: discordProfile.maxChars,
    };

    router.projects.setPendingLargePrompt({
      projectKey: "crm",
      userPrompt: "x".repeat(400),
    });

    vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      try {
        return {
          stdout: "1. Goal\nDo the thing",
          stderr: "",
          exitCode: 0,
          durationSec: 1,
          chatId: null,
          cancelled: false,
          timedOut: false,
          usage: null,
        };
      } finally {
        router.runners.markIdle(opts.workspace);
      }
    });

    await router.handle("go", d);
    expect(replies.some((r) => /no plan waiting/i.test(r))).toBe(false);
    expect(router.projects.getPendingLargePrompt()).toBeNull();
    expect(router.projects.getPendingPlan()?.planText).toMatch(/Do the thing/);
  });

  it("bare cancel clears a waiting plan", async () => {
    const { router } = setup();
    router.projects.setPendingPlan({
      projectKey: "crm",
      userPrompt: "task",
      planText: "plan",
    });
    const replies: string[] = [];
    await router.handle("cancel", delivery(replies));
    expect(router.projects.getPendingPlan()).toBeNull();
    expect(replies.join("\n")).toMatch(/cleared/i);
  });
});
