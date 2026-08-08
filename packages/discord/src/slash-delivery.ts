import { discordProfile, type DeliveryContext } from "@cursor-bridge/core";
import type { Message } from "discord.js";

/**
 * DeliveryContext backed by a deferred Discord slash interaction.
 * First reply → editReply; later replies → followUp.
 */
export function createSlashDelivery(opts: {
  userId: string;
  conversationId: string;
  surface: "general" | "project";
  editReply: (text: string) => Promise<unknown>;
  followUp: (text: string) => Promise<unknown>;
  react?: (emoji: string) => Promise<void>;
  reactToMessage?: (messageId: string, emoji: string) => Promise<void>;
  edit?: (messageId: string, text: string) => Promise<void>;
}): DeliveryContext {
  let usedEdit = false;

  return {
    platform: "discord",
    sourceId: `${opts.userId}:${opts.conversationId}`,
    conversationKey: `discord:${opts.conversationId}`,
    surface: opts.surface,
    maxChars: discordProfile.maxChars,
    formatOutput: discordProfile.formatOutput,
    reply: async (text) => {
      if (!usedEdit) {
        usedEdit = true;
        const sent = await opts.editReply(text);
        return { messageId: messageIdFrom(sent) };
      }
      const sent = await opts.followUp(text);
      return { messageId: messageIdFrom(sent) };
    },
    react: opts.react,
    reactToMessage: opts.reactToMessage,
    edit: opts.edit,
  };
}

function messageIdFrom(sent: unknown): string | undefined {
  if (sent && typeof sent === "object" && "id" in sent && typeof (sent as Message).id === "string") {
    return (sent as Message).id;
  }
  return undefined;
}
