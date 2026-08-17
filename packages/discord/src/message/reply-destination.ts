import {
  type Message,
  type OmitPartialGroupDMChannel,
  ThreadAutoArchiveDuration,
} from "discord.js";

export function threadNameForPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Cursor";
  return cleaned.slice(0, 100);
}

export interface ReplyDestination {
  /** Stable id for this Discord conversation (thread id, or DM channel id). */
  conversationId: string;
  send: (text: string) => Promise<{ messageId?: string }>;
  reactToMessage?: (messageId: string, emoji: string) => Promise<void>;
  edit?: (messageId: string, text: string) => Promise<void>;
}

type MessageChannel = {
  messages: { fetch: (id: string) => Promise<Message> };
};

async function reactInChannel(
  channel: MessageChannel,
  messageId: string,
  emoji: string,
): Promise<void> {
  const msg = await channel.messages.fetch(messageId);
  await msg.react(emoji);
}

async function editInChannel(
  channel: MessageChannel,
  messageId: string,
  text: string,
): Promise<void> {
  const msg = await channel.messages.fetch(messageId);
  await msg.edit(text);
}

/**
 * Guild: reply inside the current thread, or start a new thread from the user message.
 * DMs: Discord has no threads — use message.reply() so replies stay nested on that chat.
 */
export async function resolveReplyDestination(opts: {
  message: OmitPartialGroupDMChannel<Message<boolean>>;
  isDm: boolean;
  isThread: boolean;
  promptPreview: string;
}): Promise<ReplyDestination> {
  const { message, isDm, isThread, promptPreview } = opts;

  const channelId = message.channelId || message.channel.id;

  if (isThread) {
    const channel = message.channel;
    return {
      conversationId: channelId,
      send: async (text) => {
        if (!channel.isSendable()) {
          throw new Error("Thread channel is not sendable");
        }
        const sent = await channel.send(text);
        return { messageId: sent.id };
      },
      reactToMessage: async (messageId, emoji) => {
        if (!channel.isTextBased()) return;
        await reactInChannel(channel, messageId, emoji);
      },
      edit: async (messageId, text) => {
        if (!channel.isTextBased()) return;
        await editInChannel(channel, messageId, text);
      },
    };
  }

  if (isDm) {
    return {
      conversationId: channelId,
      send: async (text) => {
        try {
          const sent = await message.reply(text);
          return { messageId: sent.id };
        } catch {
          const sent = await message.channel.send(text);
          return { messageId: sent.id };
        }
      },
      reactToMessage: async (messageId, emoji) => {
        if (!message.channel.isTextBased()) return;
        await reactInChannel(message.channel, messageId, emoji);
      },
      edit: async (messageId, text) => {
        if (!message.channel.isTextBased()) return;
        await editInChannel(message.channel, messageId, text);
      },
    };
  }

  // Guild parent channel — create a thread for this chat
  try {
    const thread = await message.startThread({
      name: threadNameForPrompt(promptPreview),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: "Cursor Discord bridge chat",
    });
    return {
      conversationId: thread.id,
      send: async (text) => {
        const sent = await thread.send(text);
        return { messageId: sent.id };
      },
      reactToMessage: async (messageId, emoji) => {
        await reactInChannel(thread, messageId, emoji);
      },
      edit: async (messageId, text) => {
        await editInChannel(thread, messageId, text);
      },
    };
  } catch (err) {
    console.warn("[discord] could not start thread, falling back to channel:", err);
    return {
      conversationId: message.channelId,
      send: async (text) => {
        const sent = await message.channel.send(text);
        return { messageId: sent.id };
      },
      reactToMessage: async (messageId, emoji) => {
        if (!message.channel.isTextBased()) return;
        await reactInChannel(message.channel, messageId, emoji);
      },
      edit: async (messageId, text) => {
        if (!message.channel.isTextBased()) return;
        await editInChannel(message.channel, messageId, text);
      },
    };
  }
}
