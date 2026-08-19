import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname as osHostname } from "node:os";
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
  appName: string;
  /** Kill a Cursor run after this many minutes (default 15). */
  cursorTimeoutMin: number;
  openaiApiKey: string | null;
  /** OpenAI TTS voice name for Discord voice assistant (default alloy). */
  voiceTtsVoice: string;
  /** TTS playback speed 0.25–4.0 (default 1). Optional so test fixtures stay small. */
  voiceTtsSpeed?: number;
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
  /** Max concurrent Cursor agent processes (default 3). */
  cursorMaxConcurrent: number;
  /** Write raw prompt text to run logs/console (default false = redacted). */
  logPrompts: boolean;
  /**
   * This machine's bridge id (BRIDGE_HOST, else os.hostname()).
   * Selects the matching `devices.<host>` section in projects.json.
   */
  bridgeHost: string;
}

export function loadEnvFile(path: string, opts: { override?: boolean } = {}): void {
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
    cursorBin: resolveCursorBin(),
    appName: process.env.APP_NAME?.trim() || "CursorDiscord",
    cursorTimeoutMin: Math.max(
      1,
      Number.parseInt(process.env.CURSOR_TIMEOUT_MIN?.trim() || "15", 10) || 15,
    ),
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || null,
    voiceTtsVoice: process.env.VOICE_TTS_VOICE?.trim() || "alloy",
    voiceTtsSpeed: clampSpeed(Number.parseFloat(process.env.VOICE_TTS_SPEED?.trim() || "1")),
    voiceSttMode:
      process.env.VOICE_STT_MODE?.trim()?.toLowerCase() === "batch" ? "batch" : "realtime",
    retentionDays: Math.max(1, Number.parseInt(process.env.RETENTION_DAYS?.trim() || "7", 10) || 7),
    previewDefaultPort: clampPort(
      Number.parseInt(process.env.PREVIEW_DEFAULT_PORT?.trim() || "3000", 10) || 3000,
    ),
    previewCloudflaredBin: process.env.PREVIEW_CLOUDFLARED_BIN?.trim() || "cloudflared",
    previewPortsEnv: process.env.PREVIEW_PORTS?.trim() || null,
    cursorPlanModel: process.env.CURSOR_PLAN_MODEL?.trim() || null,
    cursorAgentModel: process.env.CURSOR_AGENT_MODEL?.trim() || null,
    cursorAskModel: process.env.CURSOR_ASK_MODEL?.trim() || null,
    cursorMaxConcurrent: Math.max(
      1,
      Number.parseInt(process.env.CURSOR_MAX_CONCURRENT?.trim() || "3", 10) || 3,
    ),
    logPrompts: /^(1|true|yes)$/i.test(process.env.LOG_PROMPTS?.trim() ?? ""),
    bridgeHost: process.env.BRIDGE_HOST?.trim() || osHostname(),
  };
}

/** OpenAI speech API accepts 0.25–4.0; anything else 400s the request. */
function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(4, Math.max(0.25, speed));
}

function clampPort(port: number): number {
  if (!Number.isFinite(port) || port < 1 || port > 65535) return 3000;
  return Math.trunc(port);
}

/**
 * Prefer CURSOR_BIN, then the standalone Agent CLI if installed, else `cursor`.
 * The IDE `cursor` shim is Electron and does not accept Agent flags.
 */
export function resolveCursorBin(
  envBin: string | undefined = process.env.CURSOR_BIN,
  opts: {
    platform?: NodeJS.Platform;
    localAppData?: string;
    homeDir?: string;
    exists?: (path: string) => boolean;
  } = {},
): string {
  const fromEnv = envBin?.trim();
  if (fromEnv) return fromEnv;

  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  const home = opts.homeDir ?? homedir();
  const localAppData = opts.localAppData ?? process.env.LOCALAPPDATA ?? "";

  const candidates: string[] = [];
  if (platform === "win32" && localAppData) {
    candidates.push(join(localAppData, "cursor-agent", "agent.cmd"));
  }
  candidates.push(join(home, ".local", "bin", "agent"));
  candidates.push(join(home, ".local", "bin", "cursor-agent"));

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return "cursor";
}

export function resolveProjectPath(rawPath: string): string {
  return expandHome(rawPath);
}
