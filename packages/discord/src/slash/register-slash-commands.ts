import type { Client } from "discord.js";
import { buildSlashCommandBodies } from "./slash-commands.js";

/**
 * Register (replace) slash commands. Guild registration is instant; global
 * can take up to ~1 hour. Prefer guild IDs from DISCORD_ALLOWED_GUILD_IDS.
 */
export async function registerSlashCommands(
  client: Client,
  guildIds: readonly string[],
): Promise<void> {
  const body = buildSlashCommandBodies();
  if (!client.application) {
    throw new Error("Discord client.application is missing — cannot register slash commands");
  }

  if (guildIds.length > 0) {
    for (const guildId of guildIds) {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(body);
      console.log(`Slash commands: registered ${body.length} in guild ${guild.name ?? guildId}`);
    }
    return;
  }

  await client.application.commands.set(body);
  console.log(`Slash commands: registered ${body.length} globally (may take up to ~1h to appear)`);
}
