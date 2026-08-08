import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome } from "../utils/path.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (Cursor_Disc/), two levels above packages/core/src/config */
export const ROOT_DIR = resolve(__dirname, "../../../..");

export interface AppConfig {
  rootDir: string;
  projectsFile: string;
  historyDir: string;
  logsDir: string;
  stateFile: string;
  /** Scratch workspace for general (non-project) prompts. */
  generalDir: string;
  cursorBin: string;
  defaultProject: string | null;
  appName: string;
  /** Kill a Cursor run after this many minutes (default 15). */
  cursorTimeoutMin: number;
  openaiApiKey: string | null;
  /** OpenAI TTS voice name for Discord voice assistant (default alloy). */
  voiceTtsVoice: string;
  /**
   * Voice STT backend: `realtime` = gpt-realtime-whisper (faster),
   * `batch` = gpt-4o-mini-transcribe. Default realtime.
   */
  voiceSttMode: "realtime" | "batch";
  /** Delete inbox/log files older than this many days on startup (default 7). */
  retentionDays: number;
  /** Default local port for `/preview` when project has no mapping (default 3000). */
  previewDefaultPort: number;
  /** Cloudflare Tunnel binary (default `cloudflared`). */
  previewCloudflaredBin: string;
  /** Optional `project:port` pairs from PREVIEW_PORTS env. */
  previewPortsEnv: string | null;
  /** Cursor CLI --model for plan mode (null = Auto). */
  cursorPlanModel: string | null;
  /** Cursor CLI --model for agent/implement mode (null = Auto). */
  cursorAgentModel: string | null;
  /** Cursor CLI --model for ask mode; falls back to agent model (null = Auto). */
  cursorAskModel: string | null;
}

export function loadEnvFile(
  path: string,
  opts: { override?: boolean } = {}
): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (opts.override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadCoreConfig(rootDir: string = ROOT_DIR): AppConfig {
  // .env first, then .env.local overrides
  loadEnvFile(join(rootDir, ".env"));
  loadEnvFile(join(rootDir, ".env.local"), { override: true });

  return {
    rootDir,
    projectsFile: join(rootDir, "projects.json"),
    historyDir: join(rootDir, "history"),
    logsDir: join(rootDir, "logs"),
    stateFile: join(rootDir, "state.json"),
    generalDir: join(rootDir, "general"),
    cursorBin: process.env.CURSOR_BIN?.trim() || "cursor",
    defaultProject: process.env.DEFAULT_PROJECT?.trim() || "general",
    appName: process.env.APP_NAME?.trim() || "CursorDiscord",
    cursorTimeoutMin: Math.max(
      1,
      Number.parseInt(process.env.CURSOR_TIMEOUT_MIN?.trim() || "15", 10) || 15
    ),
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || null,
    voiceTtsVoice: process.env.VOICE_TTS_VOICE?.trim() || "alloy",
    voiceSttMode:
      process.env.VOICE_STT_MODE?.trim()?.toLowerCase() === "batch"
        ? "batch"
        : "realtime",
    retentionDays: Math.max(
      1,
      Number.parseInt(process.env.RETENTION_DAYS?.trim() || "7", 10) || 7
    ),
    previewDefaultPort: clampPort(
      Number.parseInt(process.env.PREVIEW_DEFAULT_PORT?.trim() || "3000", 10) || 3000
    ),
    previewCloudflaredBin: process.env.PREVIEW_CLOUDFLARED_BIN?.trim() || "cloudflared",
    previewPortsEnv: process.env.PREVIEW_PORTS?.trim() || null,
    cursorPlanModel: process.env.CURSOR_PLAN_MODEL?.trim() || null,
    cursorAgentModel: process.env.CURSOR_AGENT_MODEL?.trim() || null,
    cursorAskModel: process.env.CURSOR_ASK_MODEL?.trim() || null,
  };
}

function clampPort(port: number): number {
  if (!Number.isFinite(port) || port < 1 || port > 65535) return 3000;
  return Math.trunc(port);
}

export function resolveProjectPath(rawPath: string): string {
  return expandHome(rawPath);
}
