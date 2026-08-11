import {
  type DeliveryContext,
  type MessageRouter,
  type PreviewService,
  parseProjectIntent,
} from "@cursor-bridge/core";
import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Message,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { effectiveAllowedChannelIds, isDiscordAuthorized } from "./allowlist.js";
import type { BridgeLeaseManager } from "./bridge-lease.js";
import type { DiscordConfig } from "./config.js";
import { ensureGuildProjectChannel } from "./ensure-project-channel-discord.js";
import { runPreviewSlashCommand } from "./preview-handler.js";
import type { ProjectChannelRegistry } from "./project-channels.js";
import { threadNameForPrompt } from "./reply-destination.js";
import { promptFromSlashCommand } from "./slash-commands.js";
import { createSlashDelivery } from "./slash-delivery.js";
import { handleVoiceSlashCommand } from "./voice/handler.js";
import {
  buildGeneralModeBanner,
  buildProjectLockedMessage,
  buildProjectModeBanner,
  buildProjectRedirectMessage,
  resolveWorkspaceContext,
} from "./workspace-context.js";

async function resolveInteractionContext(interaction: ChatInputCommandInteraction): Promise<{
  userId: string;
  isBot: boolean;
  isDm: boolean;
  isThread: boolean;
  channelId: string;
  parentChannelId: string | null;
  guildId: string | null;
}> {
  let channel = interaction.channel;
  if (!channel && interaction.channelId) {
    try {
      const fetched = await interaction.client.channels.fetch(interaction.channelId);
      if (fetched) channel = fetched as typeof interaction.channel;
    } catch {
      // leave channel null — auth will fail closed
    }
  }
  const isDm = !interaction.guildId;
  const isThread = Boolean(channel && "isThread" in channel && channel.isThread());
  let parentChannelId: string | null = null;
  if (isThread && channel && "parentId" in channel) {
    parentChannelId = channel.parentId ?? null;
  }

  return {
    userId: interaction.user.id,
    isBot: interaction.user.bot,
    isDm,
    isThread,
    channelId: interaction.channelId,
    parentChannelId,
    guildId: interaction.guildId,
  };
}

async function unauthorizedReply(interaction: ChatInputCommandInteraction): Promise<void> {
  const content = "You're not authorized to use this bot here.";
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }
  await interaction.reply({ content, ephemeral: true });
}

export async function handleDiscordSlashCommand(opts: {
  interaction: ChatInputCommandInteraction;
  config: DiscordConfig;
  router: MessageRouter;
  projectChannels: ProjectChannelRegistry;
  preview?: PreviewService;
  lease?: BridgeLeaseManager;
}): Promise<void> {
  const { interaction, config, router, projectChannels, preview, lease } = opts;
  const ctx = await resolveInteractionContext(interaction);

  const allowedChannelIds = effectiveAllowedChannelIds(
    config.discordAllowedChannelIds,
    projectChannels.channelIdsForGuild(ctx.guildId),
  );

  if (
    !isDiscordAuthorized({
      userId: ctx.userId,
      isBot: ctx.isBot,
      isDm: ctx.isDm,
      channelId: ctx.channelId,
      guildId: ctx.guildId,
      parentChannelId: ctx.parentChannelId,
      isThread: ctx.isThread,
      allowedUserIds: config.discordAllowedUserIds,
      allowedChannelIds,
      allowedGuildIds: config.discordAllowedGuildIds,
    })
  ) {
    console.log(`[discord] skip unauthorized slash /${interaction.commandName} user=${ctx.userId}`);
    await unauthorizedReply(interaction);
    return;
  }

  if (interaction.commandName === "bridge") {
    await handleBridgeSlashCommand({ interaction, lease });
    return;
  }

  if (lease && !lease.isOwner()) {
    const owner = lease.currentPayload()?.host ?? "another machine";
    const content =
      `This bridge is on standby (**${lease.host}**). Active owner: **${owner}**.\n` +
      `Use \`/bridge take\` here to switch, or talk to the active machine.`;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
    return;
  }

  const workspace = resolveWorkspaceContext({
    isDm: ctx.isDm,
    guildId: ctx.guildId,
    channelId: ctx.channelId,
    parentChannelId: ctx.parentChannelId,
    projectChannels,
  });

  if (
    await handleVoiceSlashCommand({
      interaction,
      config,
      router,
    })
  ) {
    return;
  }

  if (
    interaction.commandName === "preview" ||
    interaction.commandName === "preview_pick" ||
    interaction.commandName === "preview_stop"
  ) {
    await interaction.deferReply();
    if (!preview) {
      await interaction.editReply({
        content: "Preview tunnels aren't configured on this bridge.",
      });
      return;
    }
    const project = router.projects.resolve(workspace.projectKey);
    console.log(
      `← discord slash /${interaction.commandName} mode=${workspace.mode} project=${workspace.projectKey}`,
    );
    if (interaction.commandName === "preview" || interaction.commandName === "preview_pick") {
      const pickNote = interaction.commandName === "preview_pick" ? " — element picker on" : "";
      await interaction.editReply({
        content: `Checking localhost for **${workspace.projectKey.toUpperCase()}**${pickNote} (starting \`npm run dev\` if needed)…`,
      });
    }
    const result = await runPreviewSlashCommand({
      interaction,
      projectKey: workspace.projectKey,
      projectPath: project?.path ?? null,
      preview,
    });
    await interaction.editReply({ content: result.message.slice(0, 2000) });
    return;
  }

  const prompt = promptFromSlashCommand({
    commandName: interaction.commandName,
    getString: (name) => interaction.options.getString(name),
  });

  if (!prompt) {
    await interaction.reply({
      content: "Unknown or empty slash command.",
      ephemeral: true,
    });
    return;
  }

  // Must ack within 3s — Cursor runs can take minutes.
  await interaction.deferReply();

  let conversationId = ctx.channelId;
  let editReply: (text: string) => Promise<unknown> = async (text) =>
    interaction.editReply({ content: text });
  let followUp: (text: string) => Promise<unknown> = async (text) =>
    interaction.followUp({ content: text });
  let react: ((emoji: string) => Promise<void>) | undefined = async (emoji) => {
    try {
      const msg = await interaction.fetchReply();
      if ("react" in msg) await (msg as Message).react(emoji);
    } catch {
      // ignore react failures on slash replies
    }
  };
  let reactToMessage: ((messageId: string, emoji: string) => Promise<void>) | undefined = async (
    messageId,
    emoji,
  ) => {
    try {
      const channel = interaction.channel;
      if (!channel?.isTextBased()) return;
      const msg = await channel.messages.fetch(messageId);
      await msg.react(emoji);
    } catch {
      // ignore
    }
  };
  let editMessage: ((messageId: string, text: string) => Promise<void>) | undefined = async (
    messageId,
    text,
  ) => {
    try {
      const channel = interaction.channel;
      if (!channel?.isTextBased()) return;
      const msg = await channel.messages.fetch(messageId);
      await msg.edit(text);
    } catch {
      // ignore
    }
  };

  // Guild parent channel + /prompt|/ask → open a thread so the chat stays tidy.
  const isPromptCommand = interaction.commandName === "prompt" || interaction.commandName === "ask";
  if (
    !ctx.isDm &&
    !ctx.isThread &&
    isPromptCommand &&
    interaction.channel &&
    interaction.channel.type === ChannelType.GuildText
  ) {
    try {
      const starter = await interaction.fetchReply();
      const thread = await (starter as Message).startThread({
        name: threadNameForPrompt(prompt),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: "Cursor Discord bridge slash prompt",
      });
      conversationId = thread.id;
      await interaction.editReply({
        content: `On it — continuing in <#${thread.id}> (no @mention needed in the thread)`,
      });
      // Router output goes into the new thread.
      editReply = async (text: string) => thread.send(text);
      followUp = async (text: string) => thread.send(text);
      react = async (emoji: string) => {
        try {
          await starter.react(emoji);
        } catch {
          // ignore
        }
      };
      reactToMessage = async (messageId, emoji) => {
        try {
          const msg = await thread.messages.fetch(messageId);
          await msg.react(emoji);
        } catch {
          // ignore
        }
      };
      editMessage = async (messageId, text) => {
        try {
          const msg = await thread.messages.fetch(messageId);
          await msg.edit(text);
        } catch {
          // ignore
        }
      };
    } catch (err) {
      console.warn("[discord] slash prompt could not start thread:", err);
    }
  }

  const delivery: DeliveryContext = createSlashDelivery({
    userId: ctx.userId,
    conversationId,
    surface: workspace.mode,
    projectKey: workspace.projectKey,
    editReply,
    followUp,
    react,
    reactToMessage,
    edit: editMessage,
  });

  if (!ctx.isDm && interaction.guild && workspace.mode === "general") {
    try {
      await ensureGuildProjectChannel({
        guild: interaction.guild,
        projectKey: "general",
        registry: projectChannels,
        categoryName: config.bridgeHost,
      });
    } catch (err) {
      console.warn("[discord] could not ensure #general:", err);
    }
  }

  console.log(
    `← discord slash /${interaction.commandName} mode=${workspace.mode} project=${workspace.projectKey} conversation=${delivery.conversationKey}: ${prompt.slice(0, 100)}`,
  );

  const intent = parseProjectIntent(prompt, router.projects, {
    allowNumber: workspace.mode === "general",
  });

  if (intent?.action === "select") {
    const intentKey = intent.key;
    const guild = interaction.guild;

    if (workspace.mode === "project") {
      if (intentKey === workspace.projectKey) {
        await delivery.reply(
          delivery.formatOutput(`You're already in **${workspace.projectKey.toUpperCase()}**.`),
        );
        return;
      }

      let requestedChannelId: string | null = null;
      if (guild) {
        const ensured = await ensureGuildProjectChannel({
          guild,
          projectKey: intentKey === "general" ? "general" : intentKey,
          registry: projectChannels,
          categoryName: config.bridgeHost,
        });
        requestedChannelId = ensured.channelId;
      }
      await delivery.reply(
        delivery.formatOutput(
          buildProjectLockedMessage({
            channelProjectKey: workspace.projectKey,
            requestedKey: intentKey,
            requestedChannelId,
          }),
        ),
      );
      return;
    }

    // General surface → redirect into the project channel.
    if (intentKey === "general") {
      if (guild) {
        const ensured = await ensureGuildProjectChannel({
          guild,
          projectKey: "general",
          registry: projectChannels,
          categoryName: config.bridgeHost,
        });
        await delivery.reply(
          delivery.formatOutput(
            [buildGeneralModeBanner(), "", `Home channel: <#${ensured.channelId}>`].join("\n"),
          ),
        );
      } else {
        await delivery.reply(delivery.formatOutput(buildGeneralModeBanner()));
      }
      return;
    }

    if (!guild) {
      await delivery.reply(
        delivery.formatOutput(
          `**${intentKey.toUpperCase()}** needs its server channel. Use \`/project name:${intentKey}\` in your server.`,
        ),
      );
      return;
    }

    const ensured = await ensureGuildProjectChannel({
      guild,
      projectKey: intentKey,
      registry: projectChannels,
      categoryName: config.bridgeHost,
    });
    await delivery.reply(
      delivery.formatOutput(
        buildProjectRedirectMessage({
          projectKey: intentKey,
          channelId: ensured.channelId,
          created: ensured.created,
        }),
      ),
    );
    return;
  }

  if (intent?.action === "current") {
    const banner =
      workspace.mode === "general"
        ? buildGeneralModeBanner()
        : buildProjectModeBanner(workspace.projectKey);
    await delivery.reply(delivery.formatOutput(banner));
    return;
  }

  await router.handle(prompt, delivery, {
    executionMode: interaction.commandName === "ask" ? "ask" : undefined,
    skipPlanFirst: interaction.commandName === "ask",
  });
}

async function handleBridgeSlashCommand(opts: {
  interaction: ChatInputCommandInteraction;
  lease?: BridgeLeaseManager;
}): Promise<void> {
  const { interaction, lease } = opts;
  const sub = interaction.options.getSubcommand(false);
  if (!lease) {
    await interaction.reply({
      content: "Bridge lease isn't available on this process.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "take") {
    await interaction.deferReply({ ephemeral: true });
    const result = await lease.take();
    await interaction.editReply({ content: result.message.slice(0, 2000) });
    return;
  }

  // status (default)
  await interaction.deferReply({ ephemeral: true });
  const status = await lease.status();
  await interaction.editReply({ content: status.slice(0, 2000) });
}
