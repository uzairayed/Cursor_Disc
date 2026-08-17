import { isPlanApprovalEmoji, type MessageRouter } from "@cursor-bridge/core";
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";

/**
 * Returns true when this reaction should trigger plan approval (`go`).
 */
export function shouldApprovePlanFromReaction(opts: {
  emojiName: string | null | undefined;
  reactorIsBot: boolean;
  messageId: string;
  pendingApprovalMessageId: string | undefined;
}): boolean {
  if (opts.reactorIsBot) return false;
  if (!isPlanApprovalEmoji(opts.emojiName)) return false;
  if (!opts.pendingApprovalMessageId) return false;
  return opts.messageId === opts.pendingApprovalMessageId;
}

export async function resolvePlanApprovalReaction(opts: {
  reaction: MessageReaction | PartialMessageReaction;
  user: User | PartialUser;
  router: MessageRouter;
}): Promise<{
  messageId: string;
  conversationKey?: string;
  projectKey?: string;
} | null> {
  const { reaction, user, router } = opts;

  if (user.bot) return null;

  const fullReaction = reaction.partial ? await reaction.fetch() : reaction;
  const emojiName = fullReaction.emoji.name;
  const message = fullReaction.message.partial
    ? await fullReaction.message.fetch()
    : fullReaction.message;

  const pending = router.projects.findPendingPlanByApprovalMessageId(message.id);
  if (
    !shouldApprovePlanFromReaction({
      emojiName,
      reactorIsBot: Boolean(user.bot),
      messageId: message.id,
      pendingApprovalMessageId: pending?.approvalMessageId,
    })
  ) {
    return null;
  }

  return {
    messageId: message.id,
    conversationKey: pending?.conversationKey,
    projectKey: pending?.projectKey,
  };
}
