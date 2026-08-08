import type { DeliveryContext } from "../channels/types.js";

/** Default progressive schedule: 45s, then 2m, then every 5m. */
export const PROGRESS_INTERVALS_MS = [45_000, 120_000, 300_000] as const;

/** Keep each Discord message under the limit with a little headroom. */
const DEFAULT_BOARD_MAX_CHARS = 1900;

export function formatElapsed(elapsedSec: number): string {
  if (elapsedSec < 60) return `${elapsedSec}s`;
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function formatProgressHeader(elapsedSec: number, projectKey: string): string {
  return [
    `⏱ **${projectKey.toUpperCase()}** · ${formatElapsed(elapsedSec)}`,
    "Still working — reply **stop** to cancel.",
  ].join("\n");
}

export function formatProgressMessage(
  elapsedSec: number,
  projectKey: string,
  lastStep?: string | null
): string {
  const lines = [formatProgressHeader(elapsedSec, projectKey)];
  const step = lastStep?.trim();
  if (step) lines.push(`Last: ${step}`);
  return lines.join("\n");
}

/**
 * Format a live Cursor step for Discord.
 * Expects compact lines like `Read · \`App.tsx\`` or a short note.
 */
export function formatLiveStepMessage(step: string): string {
  const cleaned = step.trim();
  if (!cleaned) return "";
  // Tool lines already look like "Read · `file`"
  if (cleaned.includes(" · ")) return `▸ ${cleaned}`;
  return `💬 ${cleaned}`;
}

export function formatProgressBoard(opts: {
  projectKey: string;
  elapsedSec: number;
  steps: string[];
  maxChars?: number;
}): string {
  const maxChars = opts.maxChars ?? DEFAULT_BOARD_MAX_CHARS;
  const header = formatProgressHeader(opts.elapsedSec, opts.projectKey);
  const steps = opts.steps.map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return header.slice(0, maxChars);

  const body = `${header}\n\n${steps.join("\n")}`;
  // Only clamp a single oversized payload (e.g. one huge step line).
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars - 1)}…`;
}

function boardLength(opts: {
  projectKey: string;
  elapsedSec: number;
  steps: string[];
}): number {
  return formatProgressBoard({ ...opts, maxChars: Number.MAX_SAFE_INTEGER }).length;
}

/**
 * Progress status board: edits one Discord message as steps stack.
 * When that message is full, starts a new message so the full log is kept
 * (nothing is truncated away — Discord's per-message cap is the only limit).
 */
export function createProgressBoard(
  delivery: DeliveryContext,
  opts: { projectKey: string; maxChars?: number } = {
    projectKey: "project",
  }
): {
  attach: (messageId: string) => void;
  addStep: (stepLine: string) => Promise<void>;
  tick: (elapsedSec: number) => Promise<void>;
  /** Rendered body of the *current* open page (for tests). */
  render: () => string;
} {
  const maxChars = opts.maxChars ?? Math.min(delivery.maxChars, DEFAULT_BOARD_MAX_CHARS);
  let messageId: string | undefined;
  let elapsedSec = 0;
  const steps: string[] = [];
  let flushChain: Promise<void> = Promise.resolve();

  const render = () =>
    formatProgressBoard({
      projectKey: opts.projectKey,
      elapsedSec,
      steps,
      maxChars,
    });

  const flush = async () => {
    const text = delivery.formatOutput(render());
    if (messageId && delivery.edit) {
      await delivery.edit(messageId, text);
      return;
    }
    const sent = await delivery.reply(text);
    if (sent?.messageId) messageId = sent.messageId;
  };

  const enqueueFlush = () => {
    flushChain = flushChain.then(flush).catch((err) => {
      console.warn("[cursor] progress board update failed:", err);
    });
    return flushChain;
  };

  /** Seal the current page and open a fresh message for new steps. */
  const startNewPage = async () => {
    // Ensure the current page is written before we clear it.
    if (steps.length > 0 || messageId) {
      await enqueueFlush();
    }
    messageId = undefined;
    steps.length = 0;
  };

  return {
    attach(id: string) {
      messageId = id;
    },
    async addStep(stepLine: string) {
      const line = stepLine.trim();
      if (!line) return;
      if (steps[steps.length - 1] === line) return;

      const wouldFit =
        boardLength({
          projectKey: opts.projectKey,
          elapsedSec,
          steps: [...steps, line],
        }) <= maxChars;

      if (!wouldFit && steps.length > 0) {
        await startNewPage();
      }

      steps.push(line);
      await enqueueFlush();
    },
    async tick(nextElapsed: number) {
      elapsedSec = nextElapsed;
      await enqueueFlush();
    },
    render,
  };
}

export function createProgressHeartbeat(opts: {
  /** Fixed interval (legacy). Ignored when intervalsMs is set. */
  intervalMs?: number;
  /** Progressive schedule; last value repeats. */
  intervalsMs?: readonly number[];
  onTick: (elapsedSec: number) => void | Promise<void>;
}): { stop: () => void } {
  const started = Date.now();
  const schedule =
    opts.intervalsMs && opts.intervalsMs.length > 0
      ? [...opts.intervalsMs]
      : [opts.intervalMs ?? PROGRESS_INTERVALS_MS[0]];

  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const elapsedSec = Math.round((Date.now() - started) / 1000);
    void opts.onTick(elapsedSec);
    index += 1;
    const nextDelay = schedule[Math.min(index, schedule.length - 1)]!;
    timer = setTimeout(tick, nextDelay);
  };

  timer = setTimeout(tick, schedule[0]!);

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}

export interface ProgressEvent {
  kind: "tool" | "assistant";
  text: string;
}

type ToolCallBag = Record<string, unknown>;

function basename(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const parts = cleaned.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Collapse absolute paths so shell lines stay scannable. */
export function summarizeShellCommand(cmd: string): string {
  const compact = cmd.replace(/\s+/g, " ").trim();
  // /Users/.../foo.js → foo.js (keep the leaf)
  const noAbs = compact.replace(/(?:\/[\w.@+-]+)+\/([\w.@+-]+)/g, "$1");
  const first = noAbs.split(/\s*&&\s*|\s*\|\s*/)[0]?.trim() || noAbs;
  return truncate(first, 52);
}

function argsOf(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== "object") return {};
  const args = (node as { args?: unknown }).args;
  if (!args || typeof args !== "object") return {};
  return args as Record<string, unknown>;
}

function humanizeToolName(tool: string): string {
  const key = tool.toLowerCase();
  if (key.includes("todo")) return "Todos";
  if (key.includes("task")) return "Task";
  if (key.includes("browser") || key.includes("screenshot")) return "Browser";
  if (key.includes("mcp")) return "MCP";
  // updateTodos → Update Todos
  const spaced = tool
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced ? spaced.replace(/\b\w/g, (c) => c.toUpperCase()) : "Tool";
}

/** Turn a Cursor stream-json tool_call payload into a short Discord status line. */
export function formatToolCallProgress(toolCall: ToolCallBag): string | null {
  for (const [key, value] of Object.entries(toolCall)) {
    if (!key.endsWith("ToolCall")) continue;
    const args = argsOf(value);
    const tool = key.slice(0, -"ToolCall".length);
    const toolKey = tool.toLowerCase();

    if (toolKey.includes("read") || toolKey === "readfile") {
      const path = typeof args.path === "string" ? args.path : null;
      return path ? `Read · \`${basename(path)}\`` : "Read · file";
    }
    if (
      toolKey.includes("edit") ||
      toolKey.includes("write") ||
      toolKey.includes("searchreplace") ||
      toolKey.includes("apply")
    ) {
      const path =
        typeof args.path === "string"
          ? args.path
          : typeof args.file_path === "string"
            ? args.file_path
            : null;
      return path ? `Edit · \`${basename(path)}\`` : "Edit · file";
    }
    if (toolKey.includes("shell") || toolKey.includes("bash") || toolKey.includes("terminal")) {
      const cmd =
        typeof args.command === "string"
          ? args.command
          : typeof args.cmd === "string"
            ? args.cmd
            : null;
      return cmd ? `Run · \`${summarizeShellCommand(cmd)}\`` : "Run · command";
    }
    if (toolKey.includes("grep") || toolKey.includes("rg") || toolKey === "search") {
      const pattern = typeof args.pattern === "string" ? args.pattern : null;
      return pattern
        ? `Search · \`${truncate(pattern, 36)}\``
        : "Search · codebase";
    }
    if (toolKey.includes("glob")) {
      const glob =
        typeof args.glob_pattern === "string"
          ? args.glob_pattern
          : typeof args.pattern === "string"
            ? args.pattern
            : null;
      return glob ? `Find · \`${truncate(glob, 36)}\`` : "Find · files";
    }
    if (toolKey.includes("delete")) {
      const path = typeof args.path === "string" ? args.path : null;
      return path ? `Delete · \`${basename(path)}\`` : "Delete · file";
    }
    if (toolKey.includes("todo")) {
      return "Todos · updating";
    }

    return `${humanizeToolName(tool)} · working`;
  }
  return null;
}

function assistantTextFromEvent(event: {
  message?: { content?: Array<{ type?: string; text?: string }> };
}): string {
  const parts = event.message?.content ?? [];
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("")
    .trim();
}

/** Keep only a short status sentence — skip briefs / markdown dumps. */
function formatAssistantProgress(text: string): string | null {
  if (!text || text.length < 12) return null;
  // Long plans / briefs belong in the final reply, not the live feed.
  if (text.includes("###") || text.includes("\n\n") || text.length > 180) {
    return null;
  }
  const first = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text;
  if (first.length < 12) return null;
  return truncate(first, 120);
}

/** Parse one NDJSON stream-json line into a user-facing progress event. */
export function progressEventFromStreamLine(line: string): ProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;

  let event: {
    type?: string;
    subtype?: string;
    tool_call?: ToolCallBag;
    message?: { content?: Array<{ type?: string; text?: string }> };
    model_call_id?: string;
  };
  try {
    event = JSON.parse(trimmed) as typeof event;
  } catch {
    return null;
  }

  if (event.type === "tool_call" && event.subtype === "started" && event.tool_call) {
    const text = formatToolCallProgress(event.tool_call);
    return text ? { kind: "tool", text } : null;
  }

  if (event.type === "assistant") {
    const text = formatAssistantProgress(assistantTextFromEvent(event));
    return text ? { kind: "assistant", text } : null;
  }

  return null;
}

/**
 * Coalesce rapid Cursor stream events into Discord-safe updates.
 * Sends the first event immediately; later ones wait for minIntervalMs and
 * only the latest pending line is flushed.
 */
export function createLiveProgressReporter(opts: {
  minIntervalMs: number;
  onSend: (message: string) => void | Promise<void>;
}): {
  report: (text: string) => void;
  lastText: () => string | null;
  stop: () => void;
} {
  let lastSentAt = 0;
  let pending: string | null = null;
  let lastText: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const flush = () => {
    if (stopped || !pending) return;
    const msg = pending;
    pending = null;
    lastSentAt = Date.now();
    lastText = msg;
    void opts.onSend(msg);
  };

  const schedule = () => {
    if (timer !== null || stopped) return;
    const wait = Math.max(0, opts.minIntervalMs - (Date.now() - lastSentAt));
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, wait);
  };

  return {
    report(text: string) {
      if (stopped) return;
      const cleaned = text.trim();
      if (!cleaned) return;
      // Skip duplicate consecutive steps.
      if (cleaned === lastText && !pending) return;
      lastText = cleaned;
      pending = cleaned;
      if (lastSentAt === 0) {
        flush();
        return;
      }
      if (Date.now() - lastSentAt >= opts.minIntervalMs) {
        flush();
        return;
      }
      schedule();
    },
    lastText: () => lastText,
    stop() {
      stopped = true;
      pending = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

