import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discordProfile } from "../channels/profiles.js";
import type { DeliveryContext } from "../channels/types.js";
import type { AppConfig } from "../config/index.js";
import type { CursorRunOptions, CursorRunResult } from "../cursor/runner.js";
import { MessageRouter } from "./router.js";

function idleResult(overrides: Partial<CursorRunResult> = {}): CursorRunResult {
  return {
    stdout: "ok",
    stderr: "",
    exitCode: 0,
    durationSec: 1,
    chatId: null,
    cancelled: false,
    timedOut: false,
    usage: null,
    ...overrides,
  };
}

/** Mock runAcquired while still releasing the reserved slot (real impl does this). */
function mockRunAcquired(
  router: MessageRouter,
  impl: (opts: CursorRunOptions) => Promise<CursorRunResult> | CursorRunResult,
) {
  return vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
    try {
      return await impl(opts);
    } finally {
      router.runners.markIdle(opts.workspace);
    }
  });
}

function setup(): { config: AppConfig; workspace: string; fleetWorkspace: string } {
  const root = mkdtempSync(join(tmpdir(), "cwa-router-"));
  const workspace = join(root, "crm");
  const fleetWorkspace = join(root, "fleet");
  mkdirSync(workspace);
  mkdirSync(fleetWorkspace);
  writeFileSync(
    join(root, "projects.json"),
    JSON.stringify({ crm: workspace, fleet: fleetWorkspace }),
  );
  return {
    workspace,
    fleetWorkspace,
    config: {
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
    },
  };
}

function makeDelivery(
  replies: string[],
  projectKey = "crm",
  reacts?: string[],
  sourceId = "discord",
): DeliveryContext {
  return {
    platform: "discord",
    projectKey,
    reply: async (t) => {
      replies.push(t);
    },
    react: reacts
      ? async (emoji) => {
          reacts.push(emoji);
        }
      : undefined,
    formatOutput: discordProfile.formatOutput,
    maxChars: discordProfile.maxChars,
    sourceId,
  };
}

describe("MessageRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("explains an unknown delivery project in plain language", async () => {
    const { config } = setup();
    const router = new MessageRouter(config);
    const run = vi.spyOn(router.runners, "runAcquired");
    const replies: string[] = [];
    await router.handle("do something", makeDelivery(replies, "nope"));
    expect(replies[0]).toMatch(/don't have a project/i);
    expect(replies[0]).toMatch(/nope/i);
    expect(run).not.toHaveBeenCalled();
  });

  it("queues prompts when the same workspace is busy", async () => {
    const { config, workspace } = setup();
    const router = new MessageRouter(config);
    router.runners.markRunning(workspace, "crm");

    const replies: string[] = [];
    await router.handle("do something", makeDelivery(replies));
    expect(replies[0]).toMatch(/queued/i);
    expect(replies[0]).toMatch(/1 task ahead/i);
  });

  it("starts prompts on different workspaces in parallel", async () => {
    const { config, workspace } = setup();
    const router = new MessageRouter(config);
    const projectsRun: string[] = [];

    mockRunAcquired(router, async (opts) => {
      projectsRun.push(opts.projectKey);
      return idleResult();
    });

    router.runners.markRunning(workspace, "crm");

    const fleetReplies: string[] = [];
    await router.handle("fleet task", makeDelivery(fleetReplies, "fleet"));

    expect(fleetReplies[0]).not.toMatch(/queued/i);
    expect(projectsRun).toEqual(["fleet"]);
  });

  it("keeps overlapping messages from two channels in their own workspaces", async () => {
    const { config, workspace, fleetWorkspace } = setup();
    const router = new MessageRouter(config);
    const ranIn: string[] = [];

    mockRunAcquired(router, async (opts) => {
      ranIn.push(opts.workspace);
      return idleResult();
    });

    const crmReplies: string[] = [];
    const fleetReplies: string[] = [];
    // Both in flight at once — the second must not inherit the first's project.
    const crm = router.handle("crm task", makeDelivery(crmReplies, "crm"));
    const fleet = router.handle("fleet task", makeDelivery(fleetReplies, "fleet"));
    await Promise.all([crm, fleet]);

    expect(ranIn.slice().sort()).toEqual([fleetWorkspace, workspace].sort());
    expect(crmReplies.some((r) => /queued/i.test(r))).toBe(false);
    expect(fleetReplies.some((r) => /queued/i.test(r))).toBe(false);
  });

  it("queues when global concurrency cap is reached", async () => {
    const { config, workspace, fleetWorkspace } = setup();
    const root = config.rootDir;
    const third = join(root, "third");
    const alpha = join(root, "alpha");
    mkdirSync(third);
    mkdirSync(alpha);
    writeFileSync(
      config.projectsFile,
      JSON.stringify({ crm: workspace, fleet: fleetWorkspace, third, alpha }),
    );

    const router = new MessageRouter(config);
    router.runners.markRunning(workspace, "crm");
    router.runners.markRunning(fleetWorkspace, "fleet");
    router.runners.markRunning(alpha, "alpha");

    const replies: string[] = [];
    await router.handle("another task", makeDelivery(replies, "third"));

    expect(replies[0]).toMatch(/queued/i);
    expect(replies[0]).toMatch(/waiting for a free agent/i);
    expect(replies[0]).toMatch(/3 running/i);
  });

  it("drains queued prompts through their original deliveries", async () => {
    const { config, workspace } = setup();
    const router = new MessageRouter(config);
    const prompts: string[] = [];
    const threadAReplies: string[] = [];
    const threadBReplies: string[] = [];

    mockRunAcquired(router, async (opts) => {
      prompts.push(opts.prompt);
      return idleResult({ stdout: `done:${opts.prompt}` });
    });

    router.runners.markRunning(workspace, "crm");

    await router.handle(
      "from-thread-a",
      makeDelivery(threadAReplies, "crm", undefined, "thread-a"),
    );
    expect(threadAReplies[0]).toMatch(/queued/i);

    await router.handle(
      "from-thread-b",
      makeDelivery(threadBReplies, "crm", undefined, "thread-b"),
    );
    expect(threadBReplies[0]).toMatch(/queued/i);

    router.runners.markIdle(workspace);
    const kickReplies: string[] = [];
    await router.handle("kickoff", makeDelivery(kickReplies));

    expect(prompts).toEqual(["kickoff", "from-thread-a", "from-thread-b"]);
    expect(threadAReplies.some((r) => r.includes("done:from-thread-a"))).toBe(true);
    expect(threadBReplies.some((r) => r.includes("done:from-thread-b"))).toBe(true);
    expect(kickReplies.some((r) => r.includes("done:from-thread-b"))).toBe(false);
    expect(threadAReplies.some((r) => r.includes("done:from-thread-b"))).toBe(false);
  });

  it("runs queued prompts with the project they were admitted with", async () => {
    const { config, workspace } = setup();
    const router = new MessageRouter(config);
    const runProjects: string[] = [];

    mockRunAcquired(router, async (opts) => {
      runProjects.push(opts.projectKey);
      return idleResult();
    });

    router.runners.markRunning(workspace, "crm");
    await router.handle("crm task", makeDelivery([], "crm"));
    router.runners.markIdle(workspace);

    await router.handle("start drain", makeDelivery([], "fleet"));

    expect(runProjects).toContain("fleet");
    expect(runProjects).toContain("crm");
  });

  it("drains a queued plan with plan mode, not the literal word plan", async () => {
    const { config, workspace } = setup();
    const router = new MessageRouter(config);
    const large = "x".repeat(400);
    router.projects.setPendingLargePrompt({
      projectKey: "crm",
      userPrompt: large,
    });

    const modes: string[] = [];
    const prompts: string[] = [];
    mockRunAcquired(router, async (opts) => {
      modes.push(opts.executionMode ?? "agent");
      prompts.push(opts.prompt);
      return idleResult({ stdout: "1. Step" });
    });

    router.runners.markRunning(workspace, "crm");
    const queueReplies: string[] = [];
    await router.handle("plan", makeDelivery(queueReplies));
    expect(queueReplies[0]).toMatch(/queued/i);
    expect(router.projects.getPendingLargePrompt("crm")).toBeNull();

    router.runners.markIdle(workspace);
    await router.handle("kickoff", makeDelivery([]));

    expect(modes).toContain("plan");
    expect(prompts.some((p) => p.includes(large) || p.length >= 400)).toBe(true);
    expect(prompts).not.toContain("plan");
  });

  it("fills multiple free slots when draining across directories", async () => {
    const { config, workspace, fleetWorkspace } = setup();
    const root = config.rootDir;
    const third = join(root, "third");
    mkdirSync(third);
    writeFileSync(
      config.projectsFile,
      JSON.stringify({ crm: workspace, fleet: fleetWorkspace, third }),
    );

    const router = new MessageRouter(config);
    const started: string[] = [];

    mockRunAcquired(router, async (opts) => {
      started.push(opts.projectKey);
      return idleResult({ stdout: opts.projectKey });
    });

    router.runners.markRunning(workspace, "crm");
    router.runners.markRunning(fleetWorkspace, "fleet");
    router.runners.markRunning(third, "third");

    await router.handle("fleet work", makeDelivery([], "fleet"));
    await router.handle("third work", makeDelivery([], "third"));
    expect(router.queues.totalSize()).toBe(2);

    router.runners.markIdle(workspace);
    router.runners.markIdle(fleetWorkspace);
    router.runners.markIdle(third);

    await router.handle("kick", makeDelivery([], "crm"));

    expect(started).toEqual(expect.arrayContaining(["crm", "fleet", "third"]));
    expect(started.filter((p) => p === "fleet" || p === "third").length).toBe(2);
  });

  it("runs cursor and splits long Discord replies at 2000 chars", async () => {
    const { config } = setup();
    const router = new MessageRouter(config);
    const long = "x".repeat(2500);

    mockRunAcquired(router, async () => idleResult({ stdout: long, chatId: "sess-1" }));

    const replies: string[] = [];
    const delivery = makeDelivery(replies);
    delivery.maxChars = 2000;
    await router.handle("refactor auth", delivery);

    const bodyChunks = replies.filter((r) => r.includes("x"));
    expect(bodyChunks.length).toBeGreaterThan(1);
    expect(bodyChunks.every((c) => c.length <= 2000)).toBe(true);
    expect(bodyChunks.join("")).toContain(long);
    expect(router.conversations.getChatId("crm")).toBe("sess-1");
  });

  it("reacts with eyes instead of sending the working text bubble", async () => {
    const { config } = setup();
    const router = new MessageRouter(config);
    mockRunAcquired(router, async () => idleResult());

    const replies: string[] = [];
    const reacts: string[] = [];
    await router.handle("refactor auth", makeDelivery(replies, "crm", reacts));

    expect(reacts).toEqual(["👀"]);
    expect(replies.some((r) => /on it|working in/i.test(r))).toBe(false);
    expect(replies.some((r) => r.includes("ok"))).toBe(true);
  });

  it("reports Cursor CLI not found", async () => {
    const { config } = setup();
    const router = new MessageRouter(config);
    const { CursorNotFoundError } = await import("../cursor/runner.js");
    vi.spyOn(router.runners, "runAcquired").mockImplementation(async (opts) => {
      router.runners.markIdle(opts.workspace);
      throw new CursorNotFoundError("cursor");
    });

    const replies: string[] = [];
    await router.handle("refactor the auth middleware", makeDelivery(replies));
    expect(replies.at(-1)).toBe("Cursor CLI not found.");
  });
});
