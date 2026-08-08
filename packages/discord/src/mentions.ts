/** True when the bot was directly @mentioned (not via @everyone / reply alone). */
export function isBotDirectlyMentioned(opts: {
  isDm: boolean;
  /** Threads are Cursor chats — no @mention required (same as DMs). */
  isThread?: boolean;
  botUserId: string | null | undefined;
  mentionedUserIds?: Iterable<string> | null;
  /** Raw content fallback when mentions collection is unavailable in tests. */
  content?: string | null;
}): boolean {
  // DMs and threads are dedicated Cursor surfaces — no tag required.
  if (opts.isDm || opts.isThread) return true;
  if (!opts.botUserId) return false;

  if (opts.mentionedUserIds) {
    for (const id of opts.mentionedUserIds) {
      if (id === opts.botUserId) return true;
    }
  }

  const content = opts.content ?? "";
  const re = new RegExp(`<@!?${opts.botUserId}>`);
  return re.test(content);
}

/** Strip bot @mentions so they don't pollute the Cursor prompt. */
export function stripBotMentions(content: string, botUserId: string): string {
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}
