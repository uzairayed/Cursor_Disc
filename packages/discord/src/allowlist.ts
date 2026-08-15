export function parseIdList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export interface DiscordAuthInput {
  userId: string;
  isBot: boolean;
  isDm: boolean;
  channelId: string;
  guildId?: string | null;
  parentChannelId?: string | null;
  isThread?: boolean;
  allowedUserIds: readonly string[];
  allowedChannelIds: readonly string[];
  allowedGuildIds?: readonly string[];
}

/** User + guild only — channel allowlist is checked separately. */
export function isDiscordIdentityAllowed(input: DiscordAuthInput): boolean {
  if (input.isBot) return false;
  if (!input.allowedUserIds.includes(input.userId)) return false;
  if (input.isDm) return true;

  const guildIds = input.allowedGuildIds ?? [];
  if (guildIds.length > 0) {
    if (!input.guildId || !guildIds.includes(input.guildId)) return false;
  }
  return true;
}

export function isDiscordChannelAllowed(input: DiscordAuthInput): boolean {
  if (input.isDm) return true;
  if (input.allowedChannelIds.includes(input.channelId)) return true;
  if (
    input.isThread &&
    input.parentChannelId &&
    input.allowedChannelIds.includes(input.parentChannelId)
  ) {
    return true;
  }
  return false;
}

export function isDiscordAuthorized(input: DiscordAuthInput): boolean {
  return isDiscordIdentityAllowed(input) && isDiscordChannelAllowed(input);
}

/** Merge static allowlist with auto-created project channels for a guild. */
export function effectiveAllowedChannelIds(
  configured: readonly string[],
  projectChannelIds: readonly string[],
): string[] {
  return [...new Set([...configured, ...projectChannelIds])];
}

/** Fail closed: refuse to start when nobody is allowlisted. */
export function assertDiscordAllowlistConfigured(allowedUserIds: string[]): void {
  if (allowedUserIds.length === 0) {
    throw new Error(
      "DISCORD_ALLOWED_USER_IDS is empty — refusing to start. " +
        "Set at least one owner Discord user ID so arbitrary senders cannot drive Cursor.",
    );
  }
}
