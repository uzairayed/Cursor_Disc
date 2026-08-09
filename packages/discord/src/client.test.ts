import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageRouter } from "@cursor-bridge/core";
import { ChannelType } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDiscordMessage } from "./client.js";
import type { DiscordConfig } from "./config.js";
import { ProjectChannelRegistry } from "./project-channels.js";

function emptyRegistry(): ProjectChannelRegistry {
  const dir = mkdtempSync(join(tmpdir(), "cdc-reg-"));
  return new ProjectChannelRegistry(join(dir, "discord-project-channels.json"));
}

function baseConfig(overrides: Partial<DiscordConfig> = {}): DiscordConfig {
  return {
    rootDir: "/tmp",
    projectsFile: "/tmp/projects.json",
    historyDir: "/tmp/history",
    logsDir: "/tmp/logs",
    stateFile: "/tmp/state.json",
    generalDir: "/tmp/general",
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
    discordBotToken: "token",
    discordAllowedUserIds: ["user-1"],
    discordAllowedChannelIds: ["chan-1", "parent-1"],
    discordAllowedGuildIds: [],
    bridgeLeaseChannelId: null,
    bridgeHost: "test-host",
    bridgeLeaseStaleMs: 90_000,
    bridgeForce: false,
    ...overrides,
  };
}

function mockProjects() {
  return {
    resolve: vi.fn((name: string) => {
      const key = name.toLowerCase();
      if (["crm", "fleet", "general", "cliproom"].includes(key)) {
        return { key, path: `/tmp/${key}`, displayPath: `/tmp/${key}` };
      }
      return null;
    }),
    list: vi.fn(() => ["cliproom", "crm", "fleet", "general"]),
  };
}

function mockRouter() {
  return {
    handle: vi.fn<MessageRouter["handle"]>(async () => undefined),
    projects: mockProjects(),
  };
}

function mockGuild(guildId: string) {
  return {
    id: guildId,
    channels: {
      fetch: vi.fn(async (id?: string) => {
        if (typeof id === "string") {
          return { id, name: "existing", type: ChannelType.GuildText };
        }
        return new Map();
      }),
      create: vi.fn(async (opts: { name: string }) => ({
        id: `chan-${opts.name}`,
        name: opts.name,
        type: ChannelType.GuildText,
      })),
    },
  };
}

const BOT_ID = "bot-99";

function mockMessage(opts: {
  content?: string;
  userId?: string;
  bot?: boolean;
  channelType?: ChannelType;
  channelId?: string;
  parentId?: string | null;
  guildId?: string | null;
  withGuild?: boolean;
  /** When false, omit bot mention (guild messages will be ignored). */
  mentionBot?: boolean;
  attachments?: Array<{
    id: string;
    url: string;
    name: string;
    contentType: string;
    size: number;
  }>;
}) {
  const sends: string[] = [];
  const reacts: string[] = [];
  const channelId = opts.channelId ?? "chan-1";
  const isThread =
    opts.channelType === ChannelType.PublicThread || opts.channelType === ChannelType.PrivateThread;
  const isDm = opts.channelType === ChannelType.DM;
  const guildId = opts.guildId === undefined ? "g1" : opts.guildId;
  const mentionBot = opts.mentionBot ?? !isDm;
  const body = opts.content ?? "";
  const content =
    mentionBot && body && !body.includes(`<@${BOT_ID}>`)
      ? `<@${BOT_ID}> ${body}`
      : mentionBot && !body
        ? `<@${BOT_ID}>`
        : body;
  const thread = {
    id: "thread-auto",
    send: vi.fn(async (text: string) => {
      sends.push(text);
      return {};
    }),
  };
  const channel = {
    id: channelId,
    type: opts.channelType ?? ChannelType.GuildText,
    parentId: opts.parentId ?? null,
    isThread: () => isThread,
    isDMBased: () => isDm,
    send: vi.fn(async (text: string) => {
      sends.push(text);
      return {};
    }),
  };
  const attachments = new Map(
    (opts.attachments ?? []).map((a) => [
      a.id,
      {
        id: a.id,
        url: a.url,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
      },
    ]),
  );
  const mentionUsers = new Map<string, { id: string }>();
  if (mentionBot) mentionUsers.set(BOT_ID, { id: BOT_ID });

  const message = {
    id: "msg-1",
    content,
    author: { id: opts.userId ?? "user-1", bot: opts.bot ?? false },
    channelId,
    guildId,
    client: { user: { id: BOT_ID } },
    mentions: { users: mentionUsers },
    guild: opts.withGuild === false || isDm || !guildId ? null : mockGuild(guildId),
    channel,
    attachments,
    startThread: vi.fn(async () => thread),
    reply: vi.fn(async (text: string) => {
      sends.push(text);
      return {};
    }),
    react: vi.fn(async (emoji: string) => {
      reacts.push(emoji);
      return {};
    }),
  };

  return { message, sends, reacts, channel, thread };
}

describe("handleDiscordMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores unauthorized users", async () => {
    const { message, sends } = mockMessage({ userId: "stranger", withGuild: false });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(router.handle).not.toHaveBeenCalled();
    expect(sends).toEqual([]);
  });

  it("ignores bots", async () => {
    const { message } = mockMessage({ bot: true, withGuild: false });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(router.handle).not.toHaveBeenCalled();
  });

  it("routes authorized guild channel text to the router in a new thread", async () => {
    const { message } = mockMessage({ content: "help", withGuild: false });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(message.startThread).toHaveBeenCalledOnce();
    expect(router.handle).toHaveBeenCalledOnce();
    expect(router.handle.mock.calls[0]?.[0]).toBe("help");
    expect(router.handle.mock.calls[0]?.[1]?.platform).toBe("discord");
    expect(router.handle.mock.calls[0]?.[1]?.surface).toBe("general");
    expect(router.handle.mock.calls[0]?.[1]?.conversationKey).toBe("discord:thread-auto");
  });

  it("ignores guild messages that do not @mention the bot", async () => {
    const { message } = mockMessage({
      content: "help",
      withGuild: false,
      mentionBot: false,
    });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(router.handle).not.toHaveBeenCalled();
  });

  it("allows DMs for allowlisted users without channel allowlist", async () => {
    const { message } = mockMessage({
      content: "status",
      channelType: ChannelType.DM,
      channelId: "dm-99",
      guildId: null,
    });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig({ discordAllowedChannelIds: [] }),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(message.startThread).not.toHaveBeenCalled();
    expect(router.handle).toHaveBeenCalledOnce();
    expect(router.handle.mock.calls[0]?.[1]?.conversationKey).toBe("discord:dm-99");
    expect(router.handle.mock.calls[0]?.[1]?.projectKey).toBe("general");
  });

  it("reuses an existing allowlisted parent thread without creating another", async () => {
    const { message } = mockMessage({
      content: "status",
      channelType: ChannelType.PublicThread,
      channelId: "thread-7",
      parentId: "parent-1",
      withGuild: false,
    });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(message.startThread).not.toHaveBeenCalled();
    expect(router.handle).toHaveBeenCalledOnce();
  });

  it("ignores threads whose parent is not allowlisted", async () => {
    const { message } = mockMessage({
      content: "status",
      channelType: ChannelType.PublicThread,
      channelId: "thread-7",
      parentId: "other-parent",
      withGuild: false,
    });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(router.handle).not.toHaveBeenCalled();
  });

  it("allows messages in auto-created project channels and locks the project", async () => {
    const reg = emptyRegistry();
    reg.set("g1", "crm", "project-chan-1");
    const { message } = mockMessage({
      content: "status",
      channelId: "project-chan-1",
      guildId: "g1",
      withGuild: false,
    });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig({
        discordAllowedChannelIds: ["chan-1"],
        discordAllowedGuildIds: ["g1"],
      }),
      router: router as never,
      projectChannels: reg,
    });
    expect(router.handle).toHaveBeenCalledOnce();
    expect(router.handle.mock.calls[0]?.[1]?.surface).toBe("project");
    expect(router.handle.mock.calls[0]?.[1]?.projectKey).toBe("crm");
  });

  it("from general, switch to a project redirects with a channel mention", async () => {
    const { message, thread } = mockMessage({
      content: "switch to crm",
      channelId: "chan-1",
      guildId: "g1",
    });
    const router = mockRouter();
    const reg = emptyRegistry();

    await handleDiscordMessage({
      message: message as never,
      config: baseConfig({ discordAllowedGuildIds: ["g1"] }),
      router: router as never,
      projectChannels: reg,
    });

    expect(router.handle).not.toHaveBeenCalled();
    expect(reg.get("g1", "crm")).toBe("chan-crm");
    const replyText = String(thread.send.mock.calls[0]?.[0] ?? "");
    expect(replyText).toMatch(/<#chan-crm>/);
    expect(replyText).toMatch(/CRM/);
    expect(replyText).toMatch(/GENERAL/i);
  });

  it("strips the bot @mention before routing the prompt", async () => {
    const { message } = mockMessage({
      content: "status",
      withGuild: false,
    });
    const router = mockRouter();
    await handleDiscordMessage({
      message: message as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });
    expect(router.handle.mock.calls[0]?.[0]).toBe("status");
  });

  it("from a project channel, refuses switching to another project", async () => {
    const reg = emptyRegistry();
    reg.set("g1", "crm", "project-chan-1");
    reg.set("g1", "fleet", "project-chan-2");
    const { message, thread } = mockMessage({
      content: "switch to fleet",
      channelId: "project-chan-1",
      guildId: "g1",
    });
    const router = mockRouter();

    await handleDiscordMessage({
      message: message as never,
      config: baseConfig({
        discordAllowedChannelIds: [],
        discordAllowedGuildIds: ["g1"],
      }),
      router: router as never,
      projectChannels: reg,
    });

    expect(router.handle).not.toHaveBeenCalled();
    const replyText = String(thread.send.mock.calls[0]?.[0] ?? "");
    expect(replyText).toMatch(/CRM/);
    expect(replyText).toMatch(/<#project-chan-2>/);
  });

  it("keeps overlapping messages in different channels on their own projects", async () => {
    const reg = emptyRegistry();
    reg.set("g1", "crm", "project-chan-crm");
    reg.set("g1", "fleet", "project-chan-fleet");
    const crm = mockMessage({
      content: "crm status",
      channelId: "project-chan-crm",
      guildId: "g1",
      withGuild: false,
    });
    const fleet = mockMessage({
      content: "fleet status",
      channelId: "project-chan-fleet",
      guildId: "g1",
      withGuild: false,
    });
    const router = mockRouter();

    // Hold both runs inside router.handle at the same time. The old code bound
    // the project by mutating a single shared `currentProject` just before
    // handing off, so the second message clobbered the first mid-run.
    let arrived = 0;
    let releaseBoth: () => void = () => {};
    const bothArrived = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    router.handle.mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) releaseBoth();
      await bothArrived;
      return undefined;
    });

    const config = baseConfig({
      discordAllowedChannelIds: [],
      discordAllowedGuildIds: ["g1"],
    });
    const first = handleDiscordMessage({
      message: crm.message as never,
      config,
      router: router as never,
      projectChannels: reg,
    });
    const second = handleDiscordMessage({
      message: fleet.message as never,
      config,
      router: router as never,
      projectChannels: reg,
    });
    await Promise.all([first, second]);

    expect(router.handle).toHaveBeenCalledTimes(2);
    expect(router.handle).toHaveBeenCalledWith(
      "crm status",
      expect.objectContaining({ projectKey: "crm", surface: "project" }),
    );
    expect(router.handle).toHaveBeenCalledWith(
      "fleet status",
      expect.objectContaining({ projectKey: "fleet", surface: "project" }),
    );
  });
});
