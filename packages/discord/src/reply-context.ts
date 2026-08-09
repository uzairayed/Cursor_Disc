export interface ReferencedMessageLike {
  content?: string | null;
  author?: { username?: string | null; bot?: boolean | null } | null;
  attachments?: { size: number; values: () => Iterable<{ name: string | null; url: string }> };
}

export interface ReplySourceMessage {
  reference?: { messageId?: string | null } | null;
  referencedMessage?: ReferencedMessageLike | null;
  fetchReference?: () => Promise<ReferencedMessageLike>;
}

/** Build a Cursor-facing block from the message being replied to. */
export function formatReplyContext(ref: ReferencedMessageLike): string | null {
  const author = ref.author?.username?.trim() || "someone";
  const body = ref.content?.trim() || "";
  const attachmentNames: string[] = [];
  if (ref.attachments && ref.attachments.size > 0) {
    for (const att of ref.attachments.values()) {
      if (att.name) attachmentNames.push(att.name);
    }
  }

  if (!body && attachmentNames.length === 0) return null;

  const parts = [`(Replying to a message from ${author}:)`];
  if (body) {
    parts.push("```", body, "```");
  }
  if (attachmentNames.length > 0) {
    parts.push(`Attachments on that message: ${attachmentNames.join(", ")}`);
  }
  return parts.join("\n");
}

/**
 * If this message is a Discord reply, fetch/include the referenced message text.
 * Returns null when there is no reply context.
 */
export async function resolveReplyContext(message: ReplySourceMessage): Promise<string | null> {
  if (!message.reference?.messageId) return null;

  let ref: ReferencedMessageLike | null | undefined = message.referencedMessage;
  if (!ref && typeof message.fetchReference === "function") {
    try {
      ref = await message.fetchReference();
    } catch {
      return null;
    }
  }
  if (!ref) return null;
  return formatReplyContext(ref);
}

/** Combine reply context + user prompt for Cursor. */
export function mergeReplyIntoPrompt(
  userPrompt: string | null,
  replyContext: string | null,
): string | null {
  const prompt = userPrompt?.trim() || "";
  if (!replyContext) return prompt || null;
  if (!prompt) {
    return [replyContext, "", "Please read the quoted message above and respond helpfully."].join(
      "\n",
    );
  }
  return `${replyContext}\n\n${prompt}`;
}
