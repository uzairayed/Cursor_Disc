import { ChannelType, type Guild, type GuildBasedChannel } from "discord.js";
import {
  ensureProjectChannel,
  type EnsureProjectChannelResult,
  type ProjectChannelRegistry,
} from "./project-channels.js";

function isTextChannel(ch: GuildBasedChannel): boolean {
  return (
    ch.type === ChannelType.GuildText ||
    ch.type === ChannelType.GuildAnnouncement
  );
}

/** Discord.js-backed ensure: create or adopt a #project channel in the guild. */
export async function ensureGuildProjectChannel(opts: {
  guild: Guild;
  projectKey: string;
  registry: ProjectChannelRegistry;
}): Promise<EnsureProjectChannelResult> {
  const { guild, projectKey, registry } = opts;

  return ensureProjectChannel({
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
      for (const ch of channels.values()) {
        if (ch && isTextChannel(ch) && ch.name === name) {
          return { id: ch.id, name: ch.name };
        }
      }
      return null;
    },
    createChannel: async (name) => {
      const created = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        topic: `Cursor project: ${projectKey}`,
        reason: `First-time selection of project ${projectKey}`,
      });
      return { id: created.id, name: created.name };
    },
  });
}
