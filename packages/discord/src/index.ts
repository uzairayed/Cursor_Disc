import { join } from "node:path";
import { MessageRouter, purgeOldFiles } from "@cursor-bridge/core";
import { startDiscordBridge } from "./client.js";
import { loadDiscordConfig } from "./config.js";
import { createPreviewService } from "./preview-handler.js";

async function main(): Promise<void> {
  const config = loadDiscordConfig();
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
  console.log(`Owner allowlist: ${config.discordAllowedUserIds.join(", ")}`);
  if (config.discordAllowedGuildIds.length > 0) {
    console.log(`Guild allowlist: ${config.discordAllowedGuildIds.join(", ")}`);
  }
  if (config.discordAllowedChannelIds.length > 0) {
    console.log(`Channel allowlist: ${config.discordAllowedChannelIds.join(", ")}`);
  } else {
    console.log("Channel allowlist: (empty — DMs only)");
  }
  console.log("Starting Discord…");

  const router = new MessageRouter(config);
  const preview = createPreviewService(config);
  const shutdownPreviews = () => {
    void preview.stopAll();
  };
  process.once("SIGINT", shutdownPreviews);
  process.once("SIGTERM", shutdownPreviews);
  await startDiscordBridge(config, router, undefined, preview);
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (bridge staying up):", reason);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
