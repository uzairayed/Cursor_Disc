import {
  exchangeGmailCode,
  getGmailAuthUrl,
  loadGmailConfigFromEnv,
} from "@cursor-bridge/core";
import type { ChatInputCommandInteraction } from "discord.js";
import type { DiscordConfig } from "../config.js";

export async function handleGmailAuthSlash(opts: {
  interaction: ChatInputCommandInteraction;
  config: DiscordConfig;
}): Promise<void> {
  const { interaction, config } = opts;
  const gmailCfg = loadGmailConfigFromEnv(process.env, config.rootDir);
  if (!gmailCfg) {
    await interaction.reply({
      content:
        "Gmail isn't configured. Set `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` in `.env`, then restart.",
      ephemeral: true,
    });
    return;
  }
  const url = getGmailAuthUrl(gmailCfg);
  await interaction.reply({
    content: [
      "Open this link, approve **read-only** Gmail access, then run `/gmail_code` with the code:",
      "",
      url,
    ].join("\n"),
    ephemeral: true,
  });
}

export async function handleGmailCodeSlash(opts: {
  interaction: ChatInputCommandInteraction;
  config: DiscordConfig;
}): Promise<void> {
  const { interaction, config } = opts;
  const code = interaction.options.getString("code", true).trim();
  const gmailCfg = loadGmailConfigFromEnv(process.env, config.rootDir);
  if (!gmailCfg) {
    await interaction.reply({
      content: "Gmail isn't configured in `.env`.",
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await exchangeGmailCode(gmailCfg, code);
    await interaction.editReply({
      content: `Gmail connected. Tokens saved to \`${gmailCfg.tokenPath}\`. Ask me in voice to check your email.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      content: `Couldn't exchange that code: ${msg.slice(0, 300)}`,
    });
  }
}
