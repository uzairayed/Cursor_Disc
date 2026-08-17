import { join } from "node:path";
import { acquireProcessLock, MessageRouter, purgeOldFiles } from "@cursor-bridge/core";
import { isPublicUserAllowlist } from "./allowlist.js";
import { startDiscordBridge } from "./client.js";
import { loadDiscordConfig } from "./config.js";
import { createPreviewService } from "./preview/preview-handler.js";

async function main(): Promise<void> {
  const config = loadDiscordConfig();
  const lock = acquireProcessLock(join(config.rootDir, ".bridge.lock"));
  const purged = purgeOldFiles({
    dirs: [join(config.historyDir, "inbox"), config.logsDir],
    retentionDays: config.retentionDays,
  });
  if (purged > 0) {
    console.log(`Housekeeping: removed ${purged} file(s) older than ${config.retentionDays}d`);
  }

  console.log("Cursor Discord Bridge v1.0");
  console.log(`Projects file: ${config.projectsFile}`);
  console.log(`Cursor binary: ${config.cursorBin}`);
  console.log(
    isPublicUserAllowlist(config.discordAllowedUserIds)
      ? "Owner allowlist: * (public — any user in allowlisted guilds/channels; DMs still need an explicit user ID)"
      : `Owner allowlist: ${config.discordAllowedUserIds.join(", ")}`,
  );
  if (config.discordAllowedGuildIds.length > 0) {
    console.log(`Guild allowlist: ${config.discordAllowedGuildIds.join(", ")}`);
  }
  if (config.discordAllowedChannelIds.length > 0) {
    console.log(`Channel allowlist: ${config.discordAllowedChannelIds.join(", ")}`);
  } else {
    console.log("Channel allowlist: (empty — DMs only)");
  }
  if (config.bridgeLeaseChannelId) {
    console.log(
      `Bridge lease channel: ${config.bridgeLeaseChannelId} (host ${config.bridgeHost}${config.bridgeForce ? ", FORCE" : ""})`,
    );
  } else {
    console.log("Bridge lease: disabled (set BRIDGE_LEASE_CHANNEL_ID for Mac/PC switching)");
  }
  console.log("Starting Discord…");

  const router = new MessageRouter(config);
  const preview = createPreviewService(config);
  // Installing a signal listener removes Node's default terminate, so this has
  // to exit explicitly — otherwise Ctrl+C just runs cleanup and the bridge
  // keeps serving. Agents are stopped too: a `--force` run that outlives the
  // bridge would keep editing files with nobody watching.
  let leaseRelease: (() => Promise<void>) | null = null;
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — stopping agents and preview tunnels…`);
    router.runners.stopAll();
    lock.release();
    void Promise.resolve(leaseRelease?.())
      .catch((err) => console.error("Bridge lease release failed:", err))
      .then(() => preview.stopAll())
      .catch((err) => console.error("Preview cleanup failed:", err))
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  const { lease } = await startDiscordBridge(config, router, undefined, preview);
  leaseRelease = () => lease.release();
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (bridge staying up):", reason);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
