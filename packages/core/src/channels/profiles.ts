import type { Platform } from "./types.js";
import { formatForDiscord } from "../utils/discord-format.js";

export interface ChannelProfile {
  platform: Platform;
  maxChars: number;
  formatOutput: (text: string) => string;
}

export const discordProfile: ChannelProfile = {
  platform: "discord",
  maxChars: 2000,
  formatOutput: formatForDiscord,
};

export function profileFor(_platform: Platform): ChannelProfile {
  return discordProfile;
}
