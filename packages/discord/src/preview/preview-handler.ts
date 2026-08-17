import { type PreviewCommandResult, PreviewService } from "@cursor-bridge/core";
import type { ChatInputCommandInteraction } from "discord.js";
import type { DiscordConfig } from "../config.js";

export function createPreviewService(config: DiscordConfig): PreviewService {
  return new PreviewService({
    projectsFile: config.projectsFile,
    defaultPort: config.previewDefaultPort,
    cloudflaredBin: config.previewCloudflaredBin,
    portsEnv: config.previewPortsEnv,
    bridgeHost: config.bridgeHost,
  });
}

export function parsePreviewTextCommand(raw: string): {
  action: "start" | "stop";
  port?: number;
  path?: string;
  pick?: boolean;
} | null {
  const text = raw.trim().replace(/^\/+/, "");
  if (/^preview[_\s-]?stop\b/i.test(text)) return { action: "stop" };

  const pickMatch = text.match(/^preview[_\s-]?pick(?:\s+(\d{2,5}))?(?:\s+(\/\S*))?$/i);
  if (pickMatch) {
    const portRaw = pickMatch[1];
    const path = pickMatch[2];
    const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;
    return {
      action: "start",
      pick: true,
      port: port && Number.isFinite(port) ? port : undefined,
      path: path || undefined,
    };
  }

  const start = text.match(/^preview(?:\s+(\d{2,5}))?(?:\s+(\/\S*))?$/i);
  if (!start) return null;
  const portRaw = start[1];
  const path = start[2];
  const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;
  return {
    action: "start",
    pick: false,
    port: port && Number.isFinite(port) ? port : undefined,
    path: path || undefined,
  };
}

export async function runPreviewSlashCommand(opts: {
  interaction: ChatInputCommandInteraction;
  projectKey: string;
  projectPath: string | null;
  preview: PreviewService;
}): Promise<PreviewCommandResult> {
  const { interaction, projectKey, projectPath, preview } = opts;
  if (interaction.commandName === "preview_stop") {
    return preview.stop(projectKey);
  }

  const port = interaction.options.getInteger("port");
  const path = interaction.options.getString("path");
  return preview.start({
    projectKey,
    projectPath,
    port,
    path,
    pick: interaction.commandName === "preview_pick",
  });
}
