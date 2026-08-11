import { join } from "node:path";
import {
  buildAgentPrompt,
  buildVoicePrompt,
  type DeliveryContext,
  discordProfile,
  MessageRouter,
  type PreviewService,
  parseProjectIntent,
  transcribeAudio,
} from "@cursor-bridge/core";
import {
  Client,
  GatewayIntentBits,
  type Message,
  type OmitPartialGroupDMChannel,
  Partials,
} from "discord.js";
import { effectiveAllowedChannelIds, isDiscordAuthorized } from "./allowlist.js";
import { BridgeLeaseManager } from "./bridge-lease.js";
import type { DiscordConfig } from "./config.js";
import { ensureGuildProjectChannel } from "./ensure-project-channel-discord.js";
import { isBotDirectlyMentioned, stripBotMentions } from "./mentions.js";
import { resolveMessageContext } from "./message-context.js";
import { resolvePlanApprovalReaction } from "./plan-reaction.js";
import { createPreviewService, parsePreviewTextCommand } from "./preview-handler.js";
import { ProjectChannelRegistry } from "./project-channels.js";
import { registerSlashCommands } from "./register-slash-commands.js";
import { mergeReplyIntoPrompt, resolveReplyContext } from "./reply-context.js";
import { resolveReplyDestination } from "./reply-destination.js";
import { isAllowedAttachment, saveDiscordAttachment } from "./save-attachment.js";
import { handleDiscordSlashCommand } from "./slash-handler.js";
import {
  buildGeneralModeBanner,
  buildProjectLockedMessage,
  buildProjectModeBanner,
  buildProjectRedirectMessage,
  resolveWorkspaceContext,
} from "./workspace-context.js";

function extensionFor(
  name: string | null,
  contentType: string | null,
  kind: "image" | "audio" | "document",
): string {
  const fromName = name?.match(/(\.[a-z0-9]+)$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (kind === "document") {
    return contentType?.includes("pdf") ? ".pdf" : ".txt";
  }
  if (kind === "image") {
    if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return ".jpg";
    if (contentType?.includes("gif")) return ".gif";
    if (contentType?.includes("webp")) return ".webp";
    return ".png";
  }
  if (contentType?.includes("mpeg") || contentType?.includes("mp3")) return ".mp3";
  if (contentType?.includes("wav")) return ".wav";
  if (contentType?.includes("webm")) return ".webm";
  return ".ogg";
}

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
  });
}

export async function buildDiscordDelivery(
  message: OmitPartialGroupDMChannel<Message<boolean>>,
  opts: {
    isDm: boolean;
    isThread: boolean;
    promptPreview: string;
    surface: "general" | "project";
    projectKey: string;
  },
): Promise<DeliveryContext> {
  const dest = await resolveReplyDestination({
    message,
    isDm: opts.isDm,
    isThread: opts.isThread,
    promptPreview: opts.promptPreview,
  });

  return {
    platform: "discord",
    projectKey: opts.projectKey,
    sourceId: `${message.author.id}:${dest.conversationId}`,
    conversationKey: `discord:${dest.conversationId}`,
    surface: opts.surface,
    maxChars: discordProfile.maxChars,
    formatOutput: discordProfile.formatOutput,
    reply: dest.send,
    react: async (emoji: string) => {
      await message.react(emoji);
    },
    reactToMessage: dest.reactToMessage,
    edit: dest.edit,
  };
}

async function handleProjectNavigation(opts: {
  message: OmitPartialGroupDMChannel<Message<boolean>>;
  delivery: DeliveryContext;
  projectChannels: ProjectChannelRegistry;
  workspace: ReturnType<typeof resolveWorkspaceContext>;
  intentKey: string;
  categoryName: string;
}): Promise<void> {
  const { message, delivery, projectChannels, workspace, intentKey, categoryName } = opts;
  const guild = message.guild;

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
        projectKey: intentKey,
        registry: projectChannels,
        categoryName,
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

  // General surface
  if (intentKey === "general") {
    if (guild) {
      const ensured = await ensureGuildProjectChannel({
        guild,
        projectKey: "general",
        registry: projectChannels,
        categoryName,
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
        `**${intentKey.toUpperCase()}** needs its server channel. Use the bot in your server and say \`switch to ${intentKey}\`.`,
      ),
    );
    return;
  }

  const ensured = await ensureGuildProjectChannel({
    guild,
    projectKey: intentKey,
    registry: projectChannels,
    categoryName,
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
}

export async function handleDiscordMessage(opts: {
  message: OmitPartialGroupDMChannel<Message<boolean>>;
  config: DiscordConfig;
  router: MessageRouter;
  projectChannels: ProjectChannelRegistry;
  preview?: PreviewService;
  lease?: BridgeLeaseManager;
}): Promise<void> {
  const { message, config, router, projectChannels, preview, lease } = opts;
  const ctx = resolveMessageContext(message);

  const allowedChannelIds = effectiveAllowedChannelIds(
    config.discordAllowedChannelIds,
    projectChannels.channelIdsForGuild(ctx.guildId),
  );

  // Bot/self messages — ignore quietly (no log spam).
  if (ctx.isBot) return;

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
    console.log(`[discord] skip unauthorized user=${ctx.userId} channel=${ctx.channelId}`);
    return;
  }

  if (lease && !lease.isOwner()) {
    console.log(
      `[discord] skip standby host=${lease.host} owner=${lease.currentPayload()?.host ?? "?"} user=${ctx.userId}`,
    );
    return;
  }

  const botUserId = message.client?.user?.id ?? null;
  const mentionedUserIds = message.mentions?.users ? [...message.mentions.users.keys()] : null;
  if (
    !isBotDirectlyMentioned({
      isDm: ctx.isDm,
      isThread: ctx.isThread,
      botUserId,
      mentionedUserIds,
      content: message.content,
    })
  ) {
    console.log(`[discord] skip untagged user=${ctx.userId} channel=${ctx.channelId}`);
    return;
  }

  const rawContent = message.content?.trim() || "";
  // Strip in DMs too — users often @mention out of habit; leaving it breaks
  // local command matchers that expect a clean "list projects" / "help".
  const text = botUserId ? stripBotMentions(rawContent, botUserId) || null : rawContent || null;
  const inbox = join(config.historyDir, "inbox");

  const workspace = resolveWorkspaceContext({
    isDm: ctx.isDm,
    guildId: ctx.guildId,
    channelId: ctx.channelId,
    parentChannelId: ctx.parentChannelId,
    projectChannels,
  });

  const delivery = await buildDiscordDelivery(message, {
    isDm: ctx.isDm,
    isThread: ctx.isThread,
    promptPreview: text || "Cursor",
    surface: workspace.mode,
    projectKey: workspace.projectKey,
  });

  const previewCmd = text ? parsePreviewTextCommand(text) : null;
  if (previewCmd) {
    if (!preview) {
      await delivery.reply(
        delivery.formatOutput("Preview tunnels aren't configured on this bridge."),
      );
      return;
    }
    const project = router.projects.resolve(workspace.projectKey);
    console.log(
      `← discord preview ${previewCmd.action} mode=${workspace.mode} project=${workspace.projectKey}`,
    );
    if (previewCmd.action === "start") {
      await delivery.reply(
        delivery.formatOutput(
          `Checking localhost for **${workspace.projectKey.toUpperCase()}** (starting \`npm run dev\` if needed)…`,
        ),
      );
    }
    const result =
      previewCmd.action === "stop"
        ? await preview.stop(workspace.projectKey)
        : await preview.start({
            projectKey: workspace.projectKey,
            projectPath: project?.path ?? null,
            port: previewCmd.port,
            path: previewCmd.path,
            pick: previewCmd.pick,
          });
    await delivery.reply(delivery.formatOutput(result.message));
    return;
  }

  // Ensure #general exists so users have a visible home in the server.
  if (!ctx.isDm && message.guild && workspace.mode === "general") {
    try {
      await ensureGuildProjectChannel({
        guild: message.guild,
        projectKey: "general",
        registry: projectChannels,
        categoryName: config.bridgeHost,
      });
    } catch (err) {
      console.warn("[discord] could not ensure #general:", err);
    }
  }

  const imagePaths: string[] = [];
  const documentPaths: string[] = [];
  let voicePrompt: string | null = null;

  if (!text?.startsWith("/")) {
    for (const attachment of message.attachments.values()) {
      const check = isAllowedAttachment({
        contentType: attachment.contentType,
        name: attachment.name,
        size: attachment.size,
      });
      if (!check.ok) {
        if (check.reason === "too_large") {
          await delivery.reply(
            delivery.formatOutput("That attachment is too large (max 25MB). Send a smaller file."),
          );
          return;
        }
        continue;
      }

      try {
        const ext = extensionFor(attachment.name, attachment.contentType, check.kind);
        const fileName = `${Date.now()}-${attachment.id}${ext}`;
        const saved = await saveDiscordAttachment({
          url: attachment.url,
          fileName,
          destDir: inbox,
        });
        console.log(`Saved Discord ${check.kind} → ${saved}`);

        if (check.kind === "image") {
          imagePaths.push(saved);
        } else if (check.kind === "document") {
          documentPaths.push(saved);
        } else if (check.kind === "audio" && !voicePrompt) {
          if (!config.openaiApiKey) {
            await delivery.reply(
              delivery.formatOutput(
                "Got an audio file, but OPENAI_API_KEY isn't set — can't transcribe it.",
              ),
            );
            return;
          }
          const transcript = await transcribeAudio({
            apiKey: config.openaiApiKey,
            filePath: saved,
          });
          voicePrompt = buildVoicePrompt(transcript, text);
          console.log(`Voice transcript: ${transcript.slice(0, 100)}`);
        }
      } catch (err) {
        console.error("Failed to process Discord attachment:", err);
        await delivery.reply(
          delivery.formatOutput(
            check.kind === "audio"
              ? "Couldn't transcribe that audio. Try again or send it as text."
              : "Couldn't download that attachment. Try sending it again.",
          ),
        );
        return;
      }
    }
  }

  // Include the message being replied to (Discord "Reply") in the Cursor prompt.
  const replyContext = text?.startsWith("/") ? null : await resolveReplyContext(message);
  const textWithReply = mergeReplyIntoPrompt(text, replyContext);
  const baseText = voicePrompt ? mergeReplyIntoPrompt(voicePrompt, replyContext) : textWithReply;

  const prompt = text?.startsWith("/")
    ? text
    : buildAgentPrompt({
        text: baseText,
        imagePath: imagePaths[0] ?? null,
        extraImagePaths: imagePaths.slice(1),
        documentPaths,
        sourceLabel: "Discord",
      });
  if (!prompt) {
    console.log("Ignored: empty Discord prompt");
    return;
  }

  const surface = ctx.isDm ? "dm" : ctx.isThread ? "thread" : "channel→thread";
  console.log(
    `← discord ${surface} mode=${workspace.mode} project=${workspace.projectKey} conversation=${delivery.conversationKey}: ${prompt.slice(0, 100)}`,
  );

  // Bare numbers are a project pick only on the general surface; in a project
  // channel they're far more likely to be part of the prompt.
  const intent = parseProjectIntent(prompt, router.projects, {
    allowNumber: workspace.mode === "general",
  });

  if (intent?.action === "select") {
    await handleProjectNavigation({
      message,
      delivery,
      projectChannels,
      workspace,
      intentKey: intent.key,
      categoryName: config.bridgeHost,
    });
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

  await router.handle(prompt, delivery);
}

export async function startDiscordBridge(
  config: DiscordConfig,
  router: MessageRouter = new MessageRouter(config),
  projectChannels: ProjectChannelRegistry = new ProjectChannelRegistry(
    join(config.rootDir, "discord-project-channels.json"),
  ),
  preview: PreviewService = createPreviewService(config),
): Promise<{ client: Client; lease: BridgeLeaseManager }> {
  const client = createDiscordClient();
  const lease = new BridgeLeaseManager(
    {
      channelId: config.bridgeLeaseChannelId,
      host: config.bridgeHost,
      staleMs: config.bridgeLeaseStaleMs,
      force: config.bridgeForce,
    },
    client,
  );

  const ready = new Promise<void>((resolve) => {
    client.once("clientReady", () => resolve());
  });

  client.on("messageCreate", (message) => {
    void handleDiscordMessage({
      message,
      config,
      router,
      projectChannels,
      preview,
      lease,
    }).catch((err) => {
      console.error("Failed to handle Discord message:", err);
    });
  });

  client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void handleDiscordSlashCommand({
      interaction,
      config,
      router,
      projectChannels,
      preview,
      lease,
    }).catch(async (err) => {
      console.error("Failed to handle Discord slash command:", err);
      try {
        const content = "Something went wrong handling that slash command.";
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content, ephemeral: true });
        } else {
          await interaction.reply({ content, ephemeral: true });
        }
      } catch {
        // ignore secondary failures
      }
    });
  });

  client.on("messageReactionAdd", (reaction, user) => {
    void handlePlanApprovalReaction({
      reaction,
      user,
      config,
      router,
      projectChannels,
      lease,
    }).catch((err) => {
      console.error("Failed to handle plan approval reaction:", err);
    });
  });

  await client.login(config.discordBotToken);
  await ready;

  console.log(`Discord connected as ${client.user?.tag ?? "unknown"}.`);
  console.log("Workspace: GENERAL for DMs/#general; project channels are locked per project.");
  console.log(
    `Preview tunnels: ${config.previewCloudflaredBin} (default port ${config.previewDefaultPort})`,
  );

  try {
    await registerSlashCommands(client, config.discordAllowedGuildIds);
  } catch (err) {
    console.error(
      "Failed to register slash commands (invite the bot with applications.commands scope):",
      err,
    );
  }

  await lease.start();
  return { client, lease };
}

async function handlePlanApprovalReaction(opts: {
  reaction: import("discord.js").MessageReaction | import("discord.js").PartialMessageReaction;
  user: import("discord.js").User | import("discord.js").PartialUser;
  config: DiscordConfig;
  router: MessageRouter;
  projectChannels: ProjectChannelRegistry;
  lease?: BridgeLeaseManager;
}): Promise<void> {
  const { reaction, user, config, router, projectChannels, lease } = opts;

  if (lease && !lease.isOwner()) return;

  const matched = await resolvePlanApprovalReaction({ reaction, user, router });
  if (!matched) return;

  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;

  const channel = message.channel;
  const isDm = !message.guildId;
  const isThread = "isThread" in channel && channel.isThread();
  let parentChannelId: string | null = null;
  if (isThread && "parentId" in channel) {
    parentChannelId = channel.parentId ?? null;
  }

  const allowedChannelIds = effectiveAllowedChannelIds(
    config.discordAllowedChannelIds,
    projectChannels.channelIdsForGuild(message.guildId),
  );

  if (
    !isDiscordAuthorized({
      userId: user.id,
      isBot: Boolean(user.bot),
      isDm,
      channelId: message.channelId,
      guildId: message.guildId,
      parentChannelId,
      isThread,
      allowedUserIds: config.discordAllowedUserIds,
      allowedChannelIds,
      allowedGuildIds: config.discordAllowedGuildIds,
    })
  ) {
    console.log(`[discord] skip unauthorized plan ✅ user=${user.id}`);
    return;
  }

  const pending = matched.projectKey
    ? router.projects.getPendingPlan(matched.projectKey)
    : router.projects.findPendingPlanByApprovalMessageId(matched.messageId);
  if (!pending) return;

  const workspace = resolveWorkspaceContext({
    isDm,
    guildId: message.guildId,
    channelId: message.channelId,
    parentChannelId,
    projectChannels,
  });
  const conversationId = message.channelId;
  const delivery: DeliveryContext = {
    platform: "discord",
    // The plan's own project, not the channel's: a ✅ approves the plan it is
    // attached to even if that message is read from somewhere else.
    projectKey: pending.projectKey,
    sourceId: `${user.id}:${conversationId}`,
    conversationKey: matched.conversationKey ?? `discord:${conversationId}`,
    surface: workspace.mode,
    maxChars: discordProfile.maxChars,
    formatOutput: discordProfile.formatOutput,
    reply: async (text) => {
      if (!channel.isSendable()) throw new Error("Channel is not sendable");
      const sent = await channel.send(text);
      return { messageId: sent.id };
    },
    reactToMessage: async (messageId, emoji) => {
      if (!channel.isTextBased()) return;
      const msg = await channel.messages.fetch(messageId);
      await msg.react(emoji);
    },
    edit: async (messageId, text) => {
      if (!channel.isTextBased()) return;
      const msg = await channel.messages.fetch(messageId);
      await msg.edit(text);
    },
  };

  console.log(
    `← discord plan ✅ user=${user.id} project=${pending.projectKey} message=${matched.messageId}`,
  );
  await router.handle("go", delivery);
}
