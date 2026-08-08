import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { ConversationManager } from "../conversation/index.js";
import { extractCursorText } from "./extract-text.js";
import { progressEventFromStreamLine } from "./stream-progress.js";
import type { TokenUsage } from "./types.js";

export type { TokenUsage } from "./types.js";

export interface CursorRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationSec: number;
  chatId: string | null;
  cancelled: boolean;
  timedOut: boolean;
  usage: TokenUsage | null;
}

export type CursorExecutionMode = "agent" | "plan" | "ask";

export interface CursorRunOptions {
  cursorBin: string;
  workspace: string;
  prompt: string;
  projectKey: string;
  conversations: ConversationManager;
  force?: boolean;
  /** Cursor CLI --mode. Plan/ask are read-only; force is omitted for those. */
  executionMode?: CursorExecutionMode;
  /** Kill the run after this many ms. 0 / undefined = no timeout. */
  timeoutMs?: number;
  /**
   * History / resume key. Defaults to projectKey. Use a namespaced key to
   * isolate chats (e.g. per Discord thread).
   */
  sessionKey?: string;
  /**
   * When false, never pass --resume even if a chatId is stored.
   * Defaults to true.
   */
  resume?: boolean;
  /** Cursor CLI --model (omit for Auto). */
  model?: string;
  /** Fired for stream-json tool/assistant progress lines (may be frequent). */
  onProgress?: (text: string) => void;
}

export class CursorBusyError extends Error {
  constructor() {
    super("Cursor is currently working.\n\nReply with /stop to cancel.");
    this.name = "CursorBusyError";
  }
}

export class CursorNotFoundError extends Error {
  constructor(bin: string) {
    super(`Cursor CLI not found (${bin}).`);
    this.name = "CursorNotFoundError";
  }
}

interface CursorJsonResult {
  type?: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  is_error?: boolean;
  usage?: TokenUsage;
}

export class CursorRunner {
  private child: ChildProcess | null = null;
  private cancelled = false;
  private timedOut = false;
  /** Set by stop() before spawn — run() must not start Cursor. */
  private stopRequested = false;

  get isBusy(): boolean {
    return this.child !== null;
  }

  /** True after stop() until the next run() begins (or wasStopRequested consumes it). */
  wasStopRequested(): boolean {
    return this.stopRequested;
  }

  stop(): boolean {
    this.stopRequested = true;
    this.cancelled = true;
    if (!this.child) {
      // Idle at process level — pool.stop() still returns true when the slot is acquired.
      return false;
    }
    this.child.kill("SIGTERM");
    const proc = this.child;
    setTimeout(() => {
      // proc.killed is true as soon as SIGTERM is *sent*, not when it exits.
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
    }, 3000);
    return true;
  }

  async run(options: CursorRunOptions): Promise<CursorRunResult> {
    if (this.isBusy) throw new CursorBusyError();

    if (this.stopRequested) {
      this.stopRequested = false;
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        durationSec: 0,
        chatId: null,
        cancelled: true,
        timedOut: false,
        usage: null,
      };
    }

    const {
      cursorBin,
      workspace,
      prompt,
      projectKey,
      conversations,
      force = true,
      executionMode = "agent",
      timeoutMs,
      sessionKey = projectKey,
      resume = true,
      model,
      onProgress,
    } = options;

    if (!existsSync(workspace)) {
      throw new Error(`Project path does not exist:\n${workspace}`);
    }

    const chatId = conversations.getChatId(sessionKey);
    const isReadOnlyMode = executionMode === "plan" || executionMode === "ask";

    // stream-json emits tool_call / assistant events so Discord can show live steps.
    const args = [
      "agent",
      "-p",
      "--trust",
      "--output-format",
      "stream-json",
      "--workspace",
      workspace,
    ];

    if (executionMode !== "agent") {
      args.push("--mode", executionMode);
    }
    if (force && !isReadOnlyMode) args.push("--force");
    if (model) args.push("--model", model);
    if (resume && chatId) args.push("--resume", chatId);
    args.push(prompt);

    this.cancelled = false;
    this.timedOut = false;
    this.stopRequested = false;
    const started = Date.now();

    return new Promise<CursorRunResult>((resolvePromise, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(cursorBin, args, {
          cwd: workspace,
          env: { ...process.env, FORCE_COLOR: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT")) {
          reject(new CursorNotFoundError(cursorBin));
          return;
        }
        reject(err);
        return;
      }

      this.child = child;
      if (this.stopRequested) {
        this.stop();
      }
      let stdout = "";
      let stderr = "";
      let lineBuf = "";
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          this.timedOut = true;
          this.stop();
        }, timeoutMs);
      }

      const clearRunTimeout = () => {
        if (timeoutId !== null) clearTimeout(timeoutId);
      };

      const consumeStdout = (chunk: string) => {
        stdout += chunk;
        if (!onProgress) return;
        lineBuf += chunk;
        let nl = lineBuf.indexOf("\n");
        while (nl !== -1) {
          const line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          const event = progressEventFromStreamLine(line);
          if (event) onProgress(event.text);
          nl = lineBuf.indexOf("\n");
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        consumeStdout(chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        clearRunTimeout();
        this.child = null;
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new CursorNotFoundError(cursorBin));
          return;
        }
        reject(err);
      });

      child.on("close", (code) => {
        clearRunTimeout();
        this.child = null;
        if (onProgress && lineBuf.trim()) {
          const event = progressEventFromStreamLine(lineBuf);
          if (event) onProgress(event.text);
        }
        const durationSec = Math.round((Date.now() - started) / 1000);
        const extracted = extractCursorText(stdout);
        const parsed = parseCursorJson(stdout);
        const sessionId = extracted.sessionId ?? parsed?.session_id ?? chatId;
        const text =
          extracted.text.trim() ||
          parsed?.result?.trim() ||
          (stdout.trim() && !stdout.trim().startsWith("{") ? stdout.trim() : "") ||
          stderr.trim();

        if (sessionId && sessionId !== chatId) {
          conversations.setChatId(sessionKey, sessionId);
        }

        resolvePromise({
          stdout: text,
          stderr: stderr.trim(),
          exitCode: code,
          durationSec,
          chatId: sessionId,
          cancelled: this.cancelled,
          timedOut: this.timedOut,
          usage: extracted.usage ?? parsed?.usage ?? null,
        });
      });
    });
  }
}

function parseCursorJson(stdout: string): CursorJsonResult | null {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]!) as CursorJsonResult;
      if (obj.type === "result" || obj.result !== undefined || obj.session_id) {
        return obj;
      }
    } catch {
      // keep scanning
    }
  }

  try {
    return JSON.parse(stdout.trim()) as CursorJsonResult;
  } catch {
    return null;
  }
}

export { parseCursorJson };
