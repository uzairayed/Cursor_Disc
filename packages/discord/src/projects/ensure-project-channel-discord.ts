import { ChannelType, type Guild, type GuildBasedChannel } from "discord.js";
import {
  type EnsureProjectChannelResult,
  ensureProjectChannel,
  type ProjectChannelRegistry,
  sanitizeDiscordChannelName,
} from "./project-channels.js";

function isTextChannel(ch: GuildBasedChannel): boolean {
  return ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement;
}

/** Discord category label from BRIDGE_HOST (same sanitize rules as channel names). */
export function sanitizeDiscordCategoryName(host: string): string {
  return sanitizeDiscordChannelName(host);
}

/** Other device whose category this channel sits under, or null. */
export function foreignDeviceFromCategory(
  categoryName: string | null | undefined,
  deviceNames: readonly string[],
  localHost: string,
): string | null {
  if (!categoryName) return null;
  const cat = sanitizeDiscordCategoryName(categoryName);
  const local = sanitizeDiscordCategoryName(localHost);
  if (!cat || cat === local) return null;
  return deviceNames.find((name) => sanitizeDiscordCategoryName(name) === cat) ?? null;
}

export function categoryNameOfChannel(
  channel: {
    isThread?: () => boolean;
    name?: string | null;
    parent?: { name?: string | null; parent?: { name?: string | null } | null } | null;
  } | null,
): { categoryName: string | null; channelName: string | null } {
  if (!channel) return { categoryName: null, channelName: null };
  if (channel.isThread?.()) {
    return {
      categoryName: channel.parent?.parent?.name ?? null,
      channelName: channel.parent?.name ?? null,
    };
  }
  return { categoryName: channel.parent?.name ?? null, channelName: channel.name ?? null };
}

/** Find or create a guild category for this bridge host's project channels. */
export async function ensureGuildCategory(guild: Guild, categoryName: string): Promise<string> {
  const name = sanitizeDiscordCategoryName(categoryName);
  const channels = await guild.channels.fetch();
  for (const ch of channels.values()) {
    if (ch && ch.type === ChannelType.GuildCategory && ch.name === name) {
      return ch.id;
    }
  }
  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: `Cursor bridge device category: ${name}`,
  });
  return created.id;
}

async function moveChannelIntoCategory(
  guild: Guild,
  channelId: string,
  categoryId: string,
  projectKey: string,
): Promise<void> {
  try {
    const ch = await guild.channels.fetch(channelId);
    if (!ch || !isTextChannel(ch)) return;
    if (ch.parentId === categoryId) return;
    if (!("setParent" in ch) || typeof ch.setParent !== "function") return;
    await ch.setParent(categoryId, {
      reason: `Place project ${projectKey} under device category`,
    });
  } catch (err) {
    console.warn(`[discord] could not move #${projectKey} into category:`, err);
  }
}

/**
 * Discord.js-backed ensure: create or adopt a #project channel in the guild,
 * nested under a per-device category when `categoryName` (BRIDGE_HOST) is set.
 */
export async function ensureGuildProjectChannel(opts: {
  guild: Guild;
  projectKey: string;
  registry: ProjectChannelRegistry;
  /** BRIDGE_HOST — Discord category that holds this machine's project channels. */
  categoryName?: string | null;
}): Promise<EnsureProjectChannelResult> {
  const { guild, projectKey, registry } = opts;
  const categoryId = opts.categoryName?.trim()
    ? await ensureGuildCategory(guild, opts.categoryName)
    : null;

  const result = await ensureProjectChannel({
    guildId: guild.id,
    projectKey,
    registry,
    channelExists: async (channelId) => {
      try {
        const ch = await guild.channels.fetch(channelId);
        return Boolean(ch && isTextChannel(ch));
      } catch {
        return false;
      }
    },
    findChannelByName: async (name) => {
      const channels = await guild.channels.fetch();
      let uncategorized: { id: string; name: string } | null = null;
      for (const ch of channels.values()) {
        if (!ch || !isTextChannel(ch) || ch.name !== name) continue;
        if (!categoryId) {
          return { id: ch.id, name: ch.name };
        }
        // Prefer a channel already in this device category.
        if (ch.parentId === categoryId) {
          return { id: ch.id, name: ch.name };
        }
        // Adopt root-level leftovers (pre-category installs); never steal from
        // another device's category.
        if (ch.parentId == null && !uncategorized) {
          uncategorized = { id: ch.id, name: ch.name };
        }
      }
      return uncategorized;
    },
    createChannel: async (name) => {
      const created = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: categoryId ?? undefined,
        topic: `Cursor project: ${projectKey}`,
        reason: `First-time selection of project ${projectKey}`,
      });
      return { id: created.id, name: created.name };
    },
  });

  if (categoryId) {
    await moveChannelIntoCategory(guild, result.channelId, categoryId, projectKey);
  }

  return result;
}
