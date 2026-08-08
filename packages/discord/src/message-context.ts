import {
  ChannelType,
  type Message,
  type OmitPartialGroupDMChannel,
} from "discord.js";

export interface DiscordMessageContext {
  userId: string;
  isBot: boolean;
  isDm: boolean;
  isThread: boolean;
  channelId: string;
  parentChannelId: string | null;
  guildId: string | null;
}

export function resolveMessageContext(
  message: Pick<
    OmitPartialGroupDMChannel<Message<boolean>>,
    "author" | "channel" | "channelId" | "guildId"
  >
): DiscordMessageContext {
  const channel = message.channel;
  const isDm =
    typeof channel.isDMBased === "function"
      ? channel.isDMBased()
      : channel.type === ChannelType.DM;
  const isThread =
    typeof channel.isThread === "function"
      ? channel.isThread()
      : channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread ||
        channel.type === ChannelType.AnnouncementThread;

  let parentChannelId: string | null = null;
  if (isThread && "parentId" in channel) {
    parentChannelId = (channel as { parentId?: string | null }).parentId ?? null;
  }

  return {
    userId: message.author.id,
    isBot: Boolean(message.author.bot),
    isDm,
    isThread,
    channelId: message.channelId,
    parentChannelId,
    guildId: message.guildId,
  };
}
