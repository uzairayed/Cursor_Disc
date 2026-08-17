import { type AppConfig, loadCoreConfig, ROOT_DIR } from "@cursor-bridge/core";
import { assertDiscordAllowlistConfigured, parseIdList } from "./allowlist.js";
import { resolveBridgeHost } from "./bridge-lease.js";

export interface DiscordConfig extends AppConfig {
  discordBotToken: string;
  discordAllowedUserIds: string[];
  discordAllowedChannelIds: string[];
  discordAllowedGuildIds: string[];
  /** Discord channel that holds the multi-machine lease message (null = disabled). */
  bridgeLeaseChannelId: string | null;
  /** Hostname shown in the lease (default os.hostname()). */
  bridgeHost: string;
  /** No heartbeat for this long → other machines may claim (default 90s). */
  bridgeLeaseStaleMs: number;
  /** Steal a fresh lease on startup. */
  bridgeForce: boolean;
}

export function loadDiscordConfig(rootDir: string = ROOT_DIR): DiscordConfig {
  // loadCoreConfig also loads .env / .env.local; call it first for shared vars
  const core = loadCoreConfig(rootDir);

  const discordBotToken = process.env.DISCORD_BOT_TOKEN?.trim() || "";
  if (!discordBotToken) {
    throw new Error(
      "DISCORD_BOT_TOKEN is empty — refusing to start. Create a bot in the Discord Developer Portal and set the token in .env.",
    );
  }

  const discordAllowedUserIds = parseIdList(process.env.DISCORD_ALLOWED_USER_IDS);
  const discordAllowedChannelIds = parseIdList(process.env.DISCORD_ALLOWED_CHANNEL_IDS);
  const discordAllowedGuildIds = parseIdList(process.env.DISCORD_ALLOWED_GUILD_IDS);
  assertDiscordAllowlistConfigured(
    discordAllowedUserIds,
    discordAllowedChannelIds,
    discordAllowedGuildIds,
  );

  const staleRaw = Number.parseInt(process.env.BRIDGE_LEASE_STALE_MS?.trim() || "90000", 10);

  return {
    ...core,
    discordBotToken,
    discordAllowedUserIds,
    discordAllowedChannelIds,
    discordAllowedGuildIds,
    bridgeLeaseChannelId: process.env.BRIDGE_LEASE_CHANNEL_ID?.trim() || null,
    bridgeHost: resolveBridgeHost(process.env.BRIDGE_HOST),
    bridgeLeaseStaleMs: Number.isFinite(staleRaw) && staleRaw > 0 ? staleRaw : 90_000,
    bridgeForce: /^(1|true|yes)$/i.test(process.env.BRIDGE_FORCE?.trim() ?? ""),
  };
}
