import {
  buildVoicePrompt,
  type DeliveryContext,
  formatForDiscord,
  type MessageRouter,
} from "@cursor-bridge/core";
import type { TextBasedChannel } from "discord.js";

const PROGRESS_HINT = /^(working|queued|still working|checking localhost|live|heartbeat|\.\.\.|…)/i;

export function pickFinalReply(replies: string[]): string | null {
  const cleaned = replies.map((r) => r.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const line = cleaned[i]!;
    if (PROGRESS_HINT.test(line) && line.length < 80) continue;
    return line;
  }
  return cleaned[cleaned.length - 1] ?? null;
}

/** Run a prompt through MessageRouter; optionally mirror replies to a text channel. */
export async function captureRouterReply(opts: {
  router: MessageRouter;
  text: string;
  conversationKey: string;
  asVoiceNote?: boolean;
  textChannel?: TextBasedChannel | null;
  /** Voice-session project; defaults to general. */
  projectKey?: string;
}): Promise<string | null> {
  const replies: string[] = [];
  // Voice has no channel to derive a project from, so it stays pinned to the
  // general workspace unless the speaker explicitly said "switch to <project>".
  // Implicit inheritance from other channels would risk `--force` edits against
  // a repo the speaker never named.
  const projectKey = opts.projectKey ?? "general";

  const delivery: DeliveryContext = {
    platform: "discord",
    projectKey,
    conversationKey: opts.conversationKey,
    surface: projectKey === "general" ? "general" : "project",
    maxChars: 1900,
    formatOutput: formatForDiscord,
    reply: async (text) => {
      replies.push(text);
      const channel = opts.textChannel;
      if (!channel?.isSendable()) return;
      const msg = await channel.send({ content: text.slice(0, 2000) });
      return { messageId: msg.id };
    },
    edit: async (messageId, text) => {
      const channel = opts.textChannel;
      if (!channel || !("messages" in channel)) return;
      try {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ content: text.slice(0, 2000) });
      } catch {
        // ignore edit failures
      }
    },
  };

  const prompt = opts.asVoiceNote ? buildVoicePrompt(opts.text) : opts.text;
  await opts.router.handle(prompt, delivery);
  return pickFinalReply(replies);
}
