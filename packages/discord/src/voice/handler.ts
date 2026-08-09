import type { MessageRouter } from "@cursor-bridge/core";
import type { ChatInputCommandInteraction } from "discord.js";
import type { DiscordConfig } from "../config.js";
import { getOrCreateVoiceManager } from "./manager.js";

export async function handleVoiceSlashCommand(opts: {
  interaction: ChatInputCommandInteraction;
  config: DiscordConfig;
  router: MessageRouter;
}): Promise<boolean> {
  const { interaction, config, router } = opts;
  const name = interaction.commandName;
  if (name !== "join" && name !== "leave" && name !== "voice_status") {
    return false;
  }

  const voice = getOrCreateVoiceManager(config, router, interaction.client);

  if (name === "voice_status") {
    await interaction.reply({ content: voice.statusText(), ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const msg = name === "join" ? await voice.join(interaction) : await voice.leave();
    await interaction.editReply({ content: msg });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[voice] slash failed:", err);
    await interaction.editReply({
      content: `Voice command failed: ${detail.slice(0, 400)}`,
    });
  }
  return true;
}
