import { type VadOptions, VadSegmenter } from "../audio/vad.js";
import {
  classifyVoiceIntent,
  isEchoTranscript,
  isInterruptIntent,
  isTooThinForAgent,
} from "./intent.js";
import { spokenChunksFromText } from "./reply-policy.js";

export type CaptureMode = "open" | "closed" | "interrupt";

export interface VadLike {
  push: (pcm: Buffer) => Buffer | null;
  flush: () => Buffer | null;
}

export interface VoiceSessionDeps {
  allowedUserIds: string[];
  speak: (text: string) => Promise<void>;
  /** Hard-stop current TTS playback (barge-in). */
  stopSpeaking?: () => void | Promise<void>;
  transcribe: (audio: Buffer) => Promise<string>;
  handleCommand?: (text: string) => Promise<string | null | undefined>;
  handleAgent?: (text: string, signal?: AbortSignal) => Promise<string | null | undefined>;
  /** Mirror what STT heard (Discord text channel). */
  onHeard?: (transcript: string) => Promise<void>;
  onText?: (text: string) => Promise<void>;
  createVad?: () => VadLike;
  vadOptions?: VadOptions;
  now?: () => Date;
  /** Extra ms to keep mic ignored after a full turn ends (default 600). */
  postSpeakMuteMs?: number;
  /**
   * Fixed coalesce wait. When omitted, adaptive: 0ms for date/commands,
   * ~400ms for complete agent asks, ~900ms for thin/truncated fragments.
   */
  coalesceMs?: number;
  /** Speak a short "On it." before Cursor (default false — text Heard: is enough). */
  speakAgentAck?: boolean;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export class VoiceSession {
  private readonly allowed: Set<string>;
  private readonly vads = new Map<string, VadLike>();
  private busy = false;
  private mode: CaptureMode = "open";
  private dispatching = false;
  private turnAbort: AbortController | null = null;
  private readonly queue: Array<{ userId: string; pcm: Buffer }> = [];
  private pendingParts: string[] = [];
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  constructor(private readonly deps: VoiceSessionDeps) {
    this.allowed = new Set(deps.allowedUserIds);
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  }

  getCaptureMode(): CaptureMode {
    return this.mode;
  }

  /** @deprecated use getCaptureMode — true when open (not interrupt/closed). */
  isListening(): boolean {
    return this.mode === "open";
  }

  setListening(on: boolean): void {
    this.mode = on ? "open" : "closed";
  }

  async onPcm(userId: string, pcm: Buffer): Promise<void> {
    if (!this.allowed.has(userId) || this.mode === "closed") return;
    this.queue.push({ userId, pcm });
    await this.drain();
  }

  async ingestUtterance(userId: string, pcm: Buffer): Promise<void> {
    if (!this.allowed.has(userId) || this.mode === "closed") return;
    if (pcm.byteLength < 2) return;
    await this.handleUtterance(pcm);
  }

  async flushUser(userId: string): Promise<void> {
    if (!this.allowed.has(userId) || this.mode === "closed") return;
    const vad = this.vads.get(userId);
    if (!vad) return;
    const segment = vad.flush();
    if (segment) await this.handleUtterance(segment);
  }

  async say(text: string): Promise<void> {
    await this.withTurn(
      async (signal) => {
        for (const chunk of spokenChunksFromText(text)) {
          if (signal.aborted) return;
          await this.deps.speak(chunk);
        }
      },
      { allowInterrupt: true },
    );
  }

  private vadFor(userId: string): VadLike {
    let vad = this.vads.get(userId);
    if (!vad) {
      vad =
        this.deps.createVad?.() ?? new VadSegmenter(this.deps.vadOptions ?? { sampleRate: 48_000 });
      this.vads.set(userId, vad);
    }
    return vad;
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        if (this.mode === "closed") {
          this.queue.length = 0;
          break;
        }
        const segment = this.vadFor(item.userId).push(item.pcm);
        if (segment) await this.handleUtterance(segment);
      }
    } finally {
      this.busy = false;
      if (this.queue.length > 0) await this.drain();
    }
  }

  private async withTurn(
    fn: (signal: AbortSignal) => Promise<void>,
    opts: { allowInterrupt: boolean },
  ): Promise<void> {
    this.clearCoalesceTimer();
    this.pendingParts = [];
    this.turnAbort?.abort();
    this.turnAbort = new AbortController();
    const signal = this.turnAbort.signal;
    this.mode = opts.allowInterrupt ? "interrupt" : "closed";
    try {
      await fn(signal);
    } finally {
      const muteMs = this.deps.postSpeakMuteMs ?? 600;
      await sleep(muteMs);
      this.mode = "open";
      this.turnAbort = null;
    }
  }

  private async requestInterrupt(): Promise<void> {
    console.log("[voice] interrupt");
    try {
      await this.deps.stopSpeaking?.();
    } catch {
      // ignore
    }
    this.turnAbort?.abort();
    this.clearCoalesceTimer();
    this.pendingParts = [];
  }

  private clearCoalesceTimer(): void {
    if (this.coalesceTimer) {
      this.clearTimeoutFn(this.coalesceTimer);
      this.coalesceTimer = null;
    }
  }

  private scheduleCoalesceFlush(): void {
    this.clearCoalesceTimer();
    const merged = this.pendingParts.join(" ").replace(/\s+/g, " ").trim();
    const wait = this.deps.coalesceMs ?? adaptiveCoalesceMs(merged);
    if (wait <= 0) {
      void this.flushCoalesced().catch((err) => {
        console.error("[voice] coalesce flush failed:", err);
      });
      return;
    }
    this.coalesceTimer = this.setTimeoutFn(() => {
      this.coalesceTimer = null;
      void this.flushCoalesced().catch((err) => {
        console.error("[voice] coalesce flush failed:", err);
      });
    }, wait) as ReturnType<typeof setTimeout>;
  }

  private async handleUtterance(audio: Buffer): Promise<void> {
    if (this.mode === "closed") return;

    let transcript: string;
    try {
      transcript = (await this.deps.transcribe(audio)).trim();
    } catch (err) {
      if (this.mode !== "open") return;
      console.error("[voice] transcribe failed:", err);
      await this.withTurn(
        async () => {
          await this.deps.speak("Sorry, I couldn't understand that.");
        },
        { allowInterrupt: true },
      );
      return;
    }
    if (!transcript) return;

    if (isEchoTranscript(transcript)) {
      console.log(`[voice] ignore echo transcript: ${transcript.slice(0, 80)}`);
      return;
    }

    // Soft barge-in while TTS plays (headphones / push-to-talk still work).
    if (this.mode === "interrupt") {
      if (isInterruptIntent(transcript)) {
        await this.requestInterrupt();
      }
      return;
    }

    if (this.mode !== "open" || this.dispatching) return;

    const last = this.pendingParts[this.pendingParts.length - 1];
    if (last && last.toLowerCase() === transcript.toLowerCase()) {
      this.scheduleCoalesceFlush();
      return;
    }

    this.pendingParts.push(transcript);
    console.log(`[voice] buffer="${transcript.slice(0, 120)}" parts=${this.pendingParts.length}`);
    this.scheduleCoalesceFlush();
  }

  private async flushCoalesced(): Promise<void> {
    if (this.dispatching || this.mode !== "open") {
      this.pendingParts = [];
      return;
    }
    const merged = this.pendingParts.join(" ").replace(/\s+/g, " ").trim();
    this.pendingParts = [];
    if (!merged) return;
    await this.dispatchTranscript(merged);
  }

  private async dispatchTranscript(transcript: string): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;

    const intent = classifyVoiceIntent(transcript);
    console.log(`[voice] heard="${transcript.slice(0, 160)}" intent=${intent.kind}`);
    try {
      await this.deps.onHeard?.(transcript);
    } catch {
      // ignore text ack failures
    }

    try {
      if (intent.kind === "datetime") {
        await this.withTurn(
          async (signal) => {
            if (signal.aborted) return;
            await this.deps.speak(formatDateTime(this.deps.now?.() ?? new Date()));
          },
          { allowInterrupt: true },
        );
        return;
      }
      if (intent.kind === "command") {
        // stop during open listening — cancel any lingering turn
        if (/^stop(\s+all)?$/.test(intent.text)) {
          await this.requestInterrupt();
        }
        const reply = (await this.deps.handleCommand?.(intent.text)) ?? null;
        if (reply) {
          await this.withTurn(
            async (signal) => {
              for (const chunk of spokenChunksFromText(reply)) {
                if (signal.aborted) return;
                await this.deps.speak(chunk);
              }
            },
            { allowInterrupt: true },
          );
        }
        return;
      }

      if (!intent.text) return;
      if (isTooThinForAgent(intent.text)) {
        console.log(`[voice] ignore thin agent prompt: ${intent.text.slice(0, 80)}`);
        return;
      }

      // Start Cursor immediately (don't wait on "On it." TTS — text Heard: is the ack).
      await this.withTurn(
        async (signal) => {
          if (this.deps.speakAgentAck && !signal.aborted) {
            // Fire-and-forget so Cursor isn't blocked on TTS latency.
            void this.deps.speak("On it.").catch(() => undefined);
          }
          const reply = (await this.deps.handleAgent?.(intent.text, signal)) ?? null;
          if (signal.aborted || !reply) return;
          await this.deps.onText?.(reply);
          for (const chunk of spokenChunksFromText(reply)) {
            if (signal.aborted) return;
            await this.deps.speak(chunk);
          }
        },
        { allowInterrupt: true },
      );
    } catch (err) {
      console.error("[voice] handle failed:", err);
      await this.withTurn(
        async () => {
          await this.deps.speak("Sorry, something went wrong.");
        },
        { allowInterrupt: true },
      );
    } finally {
      this.dispatching = false;
    }
  }
}

function formatDateTime(d: Date): string {
  const date = d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `It's ${date}. The time is ${time}.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shorter waits when the transcript already looks complete. */
export function adaptiveCoalesceMs(transcript: string): number {
  const intent = classifyVoiceIntent(transcript);
  if (intent.kind === "datetime") return 0;
  if (intent.kind === "command") return 0;
  if (intent.kind === "agent") {
    if (!intent.text || isTooThinForAgent(intent.text)) return 900;
    return 400;
  }
  return 400;
}
