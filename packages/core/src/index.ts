export type { AppConfig } from "./config/index.js";
export { loadCoreConfig, ROOT_DIR } from "./config/index.js";

export type { DeliveryContext } from "./channels/types.js";
export { discordProfile } from "./channels/profiles.js";

export { MessageRouter } from "./commands/router.js";
export { parseProjectIntent } from "./commands/project-intent.js";
export { isPlanApprovalEmoji } from "./orchestration/plan-first.js";

export { purgeOldFiles } from "./utils/housekeeping.js";
export { formatForDiscord } from "./utils/discord-format.js";
export { buildAgentPrompt, buildVoicePrompt } from "./prompts/agent-prompt.js";
export { transcribeAudio } from "./audio/transcribe.js";
export { transcribeVoicePcm } from "./audio/voice-stt.js";
export { synthesizeSpeech } from "./audio/tts.js";
export { VoiceSession } from "./voice/session.js";
export {
  createGmailTransport,
  exchangeGmailCode,
  getGmailAuthUrl,
  loadGmailConfigFromEnv,
} from "./integrations/gmail.js";

export { PreviewService } from "./preview/index.js";
export type { PreviewCommandResult } from "./preview/index.js";
