import { loadCoreConfig, ROOT_DIR, type AppConfig } from "@cursor-bridge/core";
import { assertDiscordAllowlistConfigured, parseIdList } from "./allowlist.js";

export interface DiscordConfig extends AppConfig {
  discordBotToken: string;
  discordAllowedUserIds: string[];
  discordAllowedChannelIds: string[];
  discordAllowedGuildIds: string[];
}

export function loadDiscordConfig(rootDir: string = ROOT_DIR): DiscordConfig {
  // loadCoreConfig also loads .env / .env.local; call it first for shared vars
  const core = loadCoreConfig(rootDir);

  const discordBotToken = process.env.DISCORD_BOT_TOKEN?.trim() || "";
  if (!discordBotToken) {
    throw new Error(
      "DISCORD_BOT_TOKEN is empty — refusing to start. Create a bot in the Discord Developer Portal and set the token in .env."
    );
  }

  const discordAllowedUserIds = parseIdList(process.env.DISCORD_ALLOWED_USER_IDS);
  assertDiscordAllowlistConfigured(discordAllowedUserIds);

  return {
    ...core,
    discordBotToken,
    discordAllowedUserIds,
    discordAllowedChannelIds: parseIdList(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
    discordAllowedGuildIds: parseIdList(process.env.DISCORD_ALLOWED_GUILD_IDS),
  };
}
