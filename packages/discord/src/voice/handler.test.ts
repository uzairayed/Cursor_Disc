import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DiscordConfig } from "../config.js";
import { handleVoiceSlashCommand } from "./handler.js";
import { resetVoiceManagerForTests } from "./manager.js";

function baseConfig(): DiscordConfig {
  return {
    rootDir: "/tmp",
    projectsFile: "/tmp/projects.json",
    historyDir: "/tmp/history",
    logsDir: "/tmp/logs",
    stateFile: "/tmp/state.json",
    generalDir: "/tmp/general",
    cursorBin: "cursor",
    defaultProject: "general",
    appName: "CursorDiscord",
    cursorTimeoutMin: 15,
    openaiApiKey: "sk-test",
    voiceTtsVoice: "alloy",
    voiceSttMode: "realtime",
    retentionDays: 7,
    previewDefaultPort: 3000,
    previewCloudflaredBin: "cloudflared",
    previewPortsEnv: null,
    cursorPlanModel: null,
    cursorAgentModel: null,
    cursorAskModel: null,
    discordBotToken: "token",
    discordAllowedUserIds: ["user-1"],
    discordAllowedChannelIds: ["chan-1"],
    discordAllowedGuildIds: [],
  };
}

describe("handleVoiceSlashCommand", () => {
  beforeEach(() => {
    resetVoiceManagerForTests();
  });

  it("returns false for non-voice commands", async () => {
    const handled = await handleVoiceSlashCommand({
      interaction: { commandName: "help" } as never,
      config: baseConfig(),
      router: {} as never,
    });
    expect(handled).toBe(false);
  });

  it("replies with status for /voice_status", async () => {
    const reply = vi.fn(async () => undefined);
    const handled = await handleVoiceSlashCommand({
      interaction: {
        commandName: "voice_status",
        client: {},
        reply,
      } as never,
      config: baseConfig(),
      router: {} as never,
    });
    expect(handled).toBe(true);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/not in a voice channel/i),
        ephemeral: true,
      })
    );
  });
});
