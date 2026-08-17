/** `DISCORD_ALLOWED_USER_IDS=*` — any non-bot user in an allowlisted guild/channel. */
export const PUBLIC_USER_SENTINEL = "*";

export function parseIdList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isPublicUserAllowlist(allowedUserIds: readonly string[]): boolean {
  return allowedUserIds.includes(PUBLIC_USER_SENTINEL);
}

export function explicitAllowedUserIds(allowedUserIds: readonly string[]): string[] {
  return allowedUserIds.filter((id) => id !== PUBLIC_USER_SENTINEL);
}

/** Voice / per-user checks: `*` means any speaker. */
export function isAllowedDiscordUser(userId: string, allowedUserIds: readonly string[]): boolean {
  return isPublicUserAllowlist(allowedUserIds) || allowedUserIds.includes(userId);
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

  const explicit = explicitAllowedUserIds(input.allowedUserIds);
  const isListed = explicit.includes(input.userId);
  const isPublic = isPublicUserAllowlist(input.allowedUserIds);
  // `*` opens guild/channel traffic, not DMs — strangers messaging the bot
  // must not be able to drive Cursor on the host machine.
  if (input.isDm) return isListed;
  if (!isListed && !isPublic) return false;

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
  // Public + guild-scoped with no channel list: any channel in those guilds.
  if (
    input.allowedChannelIds.length === 0 &&
    isPublicUserAllowlist(input.allowedUserIds) &&
    (input.allowedGuildIds?.length ?? 0) > 0
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
export function assertDiscordAllowlistConfigured(
  allowedUserIds: string[],
  allowedChannelIds: string[] = [],
  allowedGuildIds: string[] = [],
): void {
  if (allowedUserIds.length === 0) {
    throw new Error(
      "DISCORD_ALLOWED_USER_IDS is empty — refusing to start. " +
        "Set at least one owner Discord user ID, or * plus a guild/channel list.",
    );
  }
  if (
    isPublicUserAllowlist(allowedUserIds) &&
    allowedChannelIds.length === 0 &&
    allowedGuildIds.length === 0
  ) {
    throw new Error(
      "DISCORD_ALLOWED_USER_IDS=* is public — also set DISCORD_ALLOWED_GUILD_IDS " +
        "or DISCORD_ALLOWED_CHANNEL_IDS so random DMs cannot drive Cursor.",
    );
  }
}
