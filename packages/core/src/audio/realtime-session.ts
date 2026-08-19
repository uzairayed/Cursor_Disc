import WebSocket from "ws";
import { downsamplePcmMonoS16le } from "./resample.js";
import { VOICE_STT_PROMPT } from "./transcribe.js";

const REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const TARGET_RATE = 24_000;
const TICK_MS = 100;
/** Bytes of 24kHz mono s16le per tick. */
const TICK_BYTES = (TARGET_RATE * 2 * TICK_MS) / 1000;
const SILENCE = Buffer.alloc(TICK_BYTES);

export interface RealtimeSttSessionOpts {
  apiKey: string;
  /**
   * Default gpt-4o-mini-transcribe. gpt-live-transcribe is marginally faster to
   * transcribe but rejects turn_detection, which would force a client-side
   * silence timer back into the response path and cost more than it saves.
   */
  model?: string;
  prompt?: string;
  /** Trailing silence that ends a turn, server-side (default 500). */
  silenceMs?: number;
  /**
   * Stop pumping this long after the last real audio. Server VAD needs a
   * continuous stream, but streaming silence while nobody talks bills for
   * every idle minute in the channel, so the pump sleeps between turns.
   */
  idleMs?: number;
  /**
   * Drop turns with less speech than this (default 350, mirroring the old
   * buffered path). Noise blips otherwise get transcribed, and the model
   * hallucinates its vocabulary prompt — "What's the date?" — from them.
   */
  minSpeechMs?: number;
  onTranscript: (text: string) => void;
  onError?: (err: Error) => void;
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Long-lived OpenAI realtime transcription socket. Audio is streamed while the
 * user speaks and the server decides where turns end, so the transcript lands
 * ~1s after speech instead of ~3.3s (cold connect + bulk upload afterwards).
 */
export class RealtimeSttSession {
  private ws: WebSocket | null = null;
  private queue: Buffer[] = [];
  private pump: ReturnType<typeof setInterval> | null = null;
  private lastAudioAt = 0;
  private closed = false;
  private partial = "";
  private speechStartMs: number | null = null;
  private lastSpeechMs: number | null = null;

  constructor(private readonly opts: RealtimeSttSessionOpts) {}

  async connect(): Promise<void> {
    if (this.closed) throw new Error("RealtimeSttSession is closed");
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    const ws = new WS(REALTIME_URL, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.send(JSON.stringify(this.sessionUpdate()));
        resolve();
      };
      ws.once("open", onOpen);
      ws.once("error", reject);
    });

    ws.on("message", (raw) => this.onMessage(raw));
    ws.on("close", () => {
      if (this.closed || this.ws !== ws) return;
      // Drop queued audio: it belongs to a turn the server will never finish.
      this.queue = [];
      this.reconnect();
    });
    ws.on("error", (err) => {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }

  private sessionUpdate() {
    return {
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: TARGET_RATE },
            // No `delay` hint here: gpt-4o-mini-transcribe rejects it, and with
            // server VAD the turn boundary already sets the response timing.
            transcription: {
              model: this.opts.model ?? "gpt-4o-mini-transcribe",
              prompt: this.opts.prompt ?? VOICE_STT_PROMPT,
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: this.opts.silenceMs ?? 500,
            },
          },
        },
      },
    };
  }

  private onMessage(raw: unknown): void {
    let event: {
      type?: string;
      transcript?: string;
      delta?: string;
      audio_start_ms?: number;
      audio_end_ms?: number;
      error?: { message?: string };
    };
    try {
      event = JSON.parse(String(raw)) as typeof event;
    } catch {
      return;
    }

    if (event.type === "error") {
      this.opts.onError?.(new Error(event.error?.message ?? "realtime error"));
      return;
    }
    // ponytail: started/stopped are paired sequentially — fine for the single
    // active speaker this bot supports; multi-user needs item_id matching.
    if (event.type === "input_audio_buffer.speech_started") {
      this.speechStartMs = event.audio_start_ms ?? null;
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      this.lastSpeechMs =
        event.audio_end_ms != null && this.speechStartMs != null
          ? event.audio_end_ms - this.speechStartMs
          : null;
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
      this.partial += event.delta;
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = (event.transcript ?? this.partial).trim();
      this.partial = "";
      if (!text) return;
      if (this.lastSpeechMs != null && this.lastSpeechMs < (this.opts.minSpeechMs ?? 350)) {
        console.log(`[voice] drop ${this.lastSpeechMs}ms blip: ${text.slice(0, 60)}`);
        return;
      }
      this.opts.onTranscript(text);
    }
  }

  private reconnect(): void {
    setTimeout(() => {
      if (this.closed) return;
      this.connect().catch((err) => {
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, 500);
  }

  /** Feed mono s16le PCM captured from the user. */
  pushPcm(pcm: Buffer, sampleRate: number): void {
    if (this.closed || pcm.byteLength < 2) return;
    if (sampleRate !== TARGET_RATE) {
      if (sampleRate % TARGET_RATE !== 0) {
        throw new Error(`Unsupported sample rate ${sampleRate}; need multiple of ${TARGET_RATE}`);
      }
      pcm = downsamplePcmMonoS16le(pcm, sampleRate / TARGET_RATE);
    }
    this.queue.push(pcm);
    this.lastAudioAt = Date.now();
    this.startPump();
  }

  private startPump(): void {
    if (this.pump) return;
    this.pump = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const idleFor = Date.now() - this.lastAudioAt;
    const queued = this.queue.reduce((n, b) => n + b.byteLength, 0);
    if (queued === 0 && idleFor > (this.opts.idleMs ?? 1500)) {
      this.stopPump();
      return;
    }

    // Server VAD needs an unbroken stream, so gaps between Discord packets are
    // padded with silence rather than simply not sent.
    let frame: Buffer;
    if (queued === 0) {
      frame = SILENCE;
    } else {
      const merged = Buffer.concat(this.queue);
      this.queue = merged.byteLength > TICK_BYTES ? [merged.subarray(TICK_BYTES)] : [];
      const take = merged.subarray(0, TICK_BYTES);
      frame =
        take.byteLength === TICK_BYTES
          ? take
          : Buffer.concat([take, SILENCE.subarray(take.byteLength)]);
    }

    const ws = this.ws;
    if (ws?.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: frame.toString("base64") }));
  }

  private stopPump(): void {
    if (!this.pump) return;
    clearInterval(this.pump);
    this.pump = null;
  }

  close(): void {
    this.closed = true;
    this.stopPump();
    this.queue = [];
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }
}
