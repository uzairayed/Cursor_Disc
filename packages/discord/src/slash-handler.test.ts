import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordConfig } from "./config.js";
import { ProjectChannelRegistry } from "./project-channels.js";
import { handleDiscordSlashCommand } from "./slash-handler.js";

function emptyRegistry(): ProjectChannelRegistry {
  const dir = mkdtempSync(join(tmpdir(), "cdc-slash-"));
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
    defaultProject: "general",
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
    discordBotToken: "token",
    discordAllowedUserIds: ["user-1"],
    discordAllowedChannelIds: ["chan-1", "parent-1"],
    discordAllowedGuildIds: [],
    ...overrides,
  };
}

function mockProjects() {
  return {
    getCurrent: vi.fn(() => ({ key: "general", path: "/tmp/general" })),
    setCurrent: vi.fn((key: string) => ({ key, path: `/tmp/${key}` })),
    isAwaitingProjectPick: vi.fn(() => false),
    resolve: vi.fn((name: string) => {
      const key = name.toLowerCase();
      if (["crm", "fleet", "general", "cliproom"].includes(key)) {
        return { key, path: `/tmp/${key}` };
      }
      return null;
    }),
    list: vi.fn(() => ["cliproom", "crm", "fleet", "general"]),
  };
}

function mockRouter() {
  return {
    handle: vi.fn(async () => undefined),
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

function mockInteraction(opts: {
  commandName: string;
  userId?: string;
  bot?: boolean;
  channelType?: ChannelType;
  channelId?: string;
  parentId?: string | null;
  guildId?: string | null;
  withGuild?: boolean;
  options?: Record<string, string | null>;
  deferred?: boolean;
}) {
  const edits: string[] = [];
  const replies: Array<{ content: string; ephemeral?: boolean }> = [];
  const followUps: Array<{ content: string; ephemeral?: boolean }> = [];
  const channelId = opts.channelId ?? "chan-1";
  const isThread =
    opts.channelType === ChannelType.PublicThread ||
    opts.channelType === ChannelType.PrivateThread;
  const isDm = opts.channelType === ChannelType.DM;
  const guildId = opts.guildId === undefined ? "g1" : opts.guildId;
  const guild =
    opts.withGuild === false || isDm || !guildId ? null : mockGuild(guildId);

  const thread = {
    id: "thread-slash",
    send: vi.fn(async (text: string) => {
      edits.push(text);
      return {};
    }),
    messages: {
      fetch: vi.fn(async () => ({
        react: vi.fn(),
        edit: vi.fn(),
      })),
    },
  };

  const starter = {
    id: "starter-1",
    react: vi.fn(),
    startThread: vi.fn(async () => thread),
  };

  const channel = {
    id: channelId,
    type: opts.channelType ?? ChannelType.GuildText,
    parentId: opts.parentId ?? null,
    isThread: () => isThread,
    isTextBased: () => true,
    messages: {
      fetch: vi.fn(async () => ({
        react: vi.fn(),
        edit: vi.fn(),
      })),
    },
  };

  let deferred = opts.deferred ?? false;
  let replied = false;

  const interaction = {
    commandName: opts.commandName,
    user: { id: opts.userId ?? "user-1", bot: opts.bot ?? false },
    channelId,
    guildId,
    guild,
    channel,
    options: {
      getString: vi.fn((name: string) => opts.options?.[name] ?? null),
      getInteger: vi.fn((name: string) => {
        const raw = opts.options?.[name];
        if (raw == null) return null;
        const n = Number.parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
      }),
    },
    get deferred() {
      return deferred;
    },
    get replied() {
      return replied;
    },
    deferReply: vi.fn(async () => {
      deferred = true;
    }),
    reply: vi.fn(async (payload: { content: string; ephemeral?: boolean }) => {
      replied = true;
      replies.push(payload);
      return {};
    }),
    editReply: vi.fn(async (payload: { content: string }) => {
      edits.push(payload.content);
      return starter;
    }),
    followUp: vi.fn(async (payload: { content: string; ephemeral?: boolean }) => {
      followUps.push(payload);
      return {};
    }),
    fetchReply: vi.fn(async () => starter),
  };

  return { interaction, edits, replies, followUps, starter, thread, guild };
}

describe("handleDiscordSlashCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replies ephemerally for unauthorized users", async () => {
    const { interaction, replies } = mockInteraction({
      commandName: "help",
      userId: "stranger",
      withGuild: false,
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(router.handle).not.toHaveBeenCalled();
    expect(replies[0]).toMatchObject({
      content: expect.stringMatching(/not authorized/i),
      ephemeral: true,
    });
  });

  it("rejects bots", async () => {
    const { interaction, replies } = mockInteraction({
      commandName: "status",
      bot: true,
      withGuild: false,
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(router.handle).not.toHaveBeenCalled();
    expect(replies[0]?.ephemeral).toBe(true);
  });

  it("routes /prompt through the router in ask/agent modes", async () => {
    const { interaction, starter } = mockInteraction({
      commandName: "prompt",
      options: { text: "fix the login bug" },
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(starter.startThread).toHaveBeenCalledOnce();
    expect(router.handle).toHaveBeenCalledOnce();
    expect(router.handle.mock.calls[0]?.[0]).toBe("fix the login bug");
    expect(router.handle.mock.calls[0]?.[2]).toEqual({
      executionMode: undefined,
      skipPlanFirst: false,
    });
  });

  it("runs /ask with ask execution mode and skipPlanFirst", async () => {
    const { interaction } = mockInteraction({
      commandName: "ask",
      options: { prompt: "what does login do?" },
      channelType: ChannelType.DM,
      channelId: "dm-1",
      guildId: null,
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig({ discordAllowedChannelIds: [] }),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(router.handle).toHaveBeenCalledOnce();
    expect(router.handle.mock.calls[0]?.[0]).toBe("what does login do?");
    expect(router.handle.mock.calls[0]?.[2]).toEqual({
      executionMode: "ask",
      skipPlanFirst: true,
    });
  });

  it("maps /status to the conversational router without opening a thread", async () => {
    const { interaction, starter } = mockInteraction({
      commandName: "status",
      channelType: ChannelType.PublicThread,
      channelId: "thread-1",
      parentId: "parent-1",
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(starter.startThread).not.toHaveBeenCalled();
    expect(router.handle).toHaveBeenCalledWith(
      "status",
      expect.objectContaining({ platform: "discord", surface: "general" }),
      { executionMode: undefined, skipPlanFirst: false }
    );
  });

  it("rejects unknown slash commands", async () => {
    const { interaction, replies } = mockInteraction({
      commandName: "not_a_real_command",
      withGuild: false,
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(router.handle).not.toHaveBeenCalled();
    expect(replies[0]).toMatchObject({
      content: expect.stringMatching(/unknown or empty/i),
      ephemeral: true,
    });
  });

  it("runs /preview via PreviewService and edits the deferred reply", async () => {
    const reg = emptyRegistry();
    reg.set("g1", "cliproom", "chan-1");
    const { interaction, edits } = mockInteraction({
      commandName: "preview",
      options: { port: "5173", path: "/app" },
      channelId: "chan-1",
    });
    const router = mockRouter();
    const preview = {
      start: vi.fn(async () => ({
        ok: true,
        message: "Preview ready at https://x.trycloudflare.com",
      })),
      stop: vi.fn(),
    };

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: reg,
      preview: preview as never,
    });

    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(preview.start).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKey: "cliproom",
        projectPath: "/tmp/cliproom",
        port: 5173,
        path: "/app",
        pick: false,
      })
    );
    expect(edits.at(-1)).toContain("Preview ready");
    expect(router.handle).not.toHaveBeenCalled();
  });

  it("explains when preview service is missing", async () => {
    const { interaction, edits } = mockInteraction({
      commandName: "preview_stop",
      withGuild: false,
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(edits.at(-1)).toMatch(/aren't configured/i);
  });

  it("redirects /project from general into the project channel", async () => {
    const { interaction, edits, guild } = mockInteraction({
      commandName: "project",
      options: { name: "crm" },
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(guild?.channels.create).toHaveBeenCalled();
    expect(router.handle).not.toHaveBeenCalled();
    expect(edits.some((e) => /CRM/i.test(e) && /Continue there/i.test(e))).toBe(
      true
    );
    expect(router.projects.setCurrent).toHaveBeenCalledWith("general");
  });

  it("locks project switches when already in a project channel", async () => {
    const reg = emptyRegistry();
    reg.set("g1", "cliproom", "chan-1");
    const { interaction, edits } = mockInteraction({
      commandName: "project",
      options: { name: "crm" },
      channelId: "chan-1",
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig(),
      router: router as never,
      projectChannels: reg,
    });

    expect(router.handle).not.toHaveBeenCalled();
    expect(edits.some((e) => /CLIPROOM.*only/i.test(e))).toBe(true);
  });

  it("answers /project without a name with the current mode banner", async () => {
    const { interaction, edits } = mockInteraction({
      commandName: "project",
      channelType: ChannelType.DM,
      channelId: "dm-9",
      guildId: null,
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig({ discordAllowedChannelIds: [] }),
      router: router as never,
      projectChannels: emptyRegistry(),
    });

    expect(router.handle).not.toHaveBeenCalled();
    expect(edits.some((e) => /GENERAL/i.test(e))).toBe(true);
  });

  it("allows slash commands in auto-created project channels", async () => {
    const reg = emptyRegistry();
    reg.set("g1", "fleet", "fleet-chan");
    const { interaction } = mockInteraction({
      commandName: "help",
      channelId: "fleet-chan",
    });
    const router = mockRouter();

    await handleDiscordSlashCommand({
      interaction: interaction as never,
      config: baseConfig({ discordAllowedChannelIds: ["parent-1"] }),
      router: router as never,
      projectChannels: reg,
    });

    expect(router.projects.setCurrent).toHaveBeenCalledWith("fleet");
    expect(router.handle).toHaveBeenCalledWith(
      "help",
      expect.objectContaining({ platform: "discord", surface: "project" }),
      { executionMode: undefined, skipPlanFirst: false }
    );
  });
});
