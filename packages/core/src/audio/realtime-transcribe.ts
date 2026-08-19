import WebSocket from "ws";
import { downsamplePcmMonoS16le } from "./resample.js";
import { VOICE_STT_PROMPT } from "./transcribe.js";

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const TARGET_RATE = 24_000;
/** ~100ms of 24kHz mono s16le */
const CHUNK_BYTES = TARGET_RATE * 2 * 0.1;

export type RealtimeTranscribeOpts = {
  apiKey: string;
  /** Mono PCM s16le at `sampleRate`. */
  pcm: Buffer;
  sampleRate: number;
  /** Default gpt-live-transcribe */
  model?: string;
  prompt?: string;
  timeoutMs?: number;
  WebSocketImpl?: typeof WebSocket;
};

/**
 * One-shot utterance transcription via OpenAI Realtime Whisper (STT only).
 * Uses the same OPENAI_API_KEY as batch Whisper / TTS.
 */
export async function transcribeRealtimePcm(opts: RealtimeTranscribeOpts): Promise<string> {
  // gpt-realtime-whisper rejects `prompt`, which we rely on for command vocabulary.
  const model = opts.model ?? "gpt-live-transcribe";
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const WS = opts.WebSocketImpl ?? WebSocket;

  let pcm = opts.pcm;
  if (opts.sampleRate !== TARGET_RATE) {
    if (opts.sampleRate % TARGET_RATE !== 0) {
      throw new Error(
        `Unsupported sample rate ${opts.sampleRate}; need multiple of ${TARGET_RATE}`,
      );
    }
    pcm = downsamplePcmMonoS16le(pcm, opts.sampleRate / TARGET_RATE);
  }
  if (pcm.byteLength < 2) throw new Error("Realtime STT received empty audio");

  // A `?model=` param opens a *conversation* session, which then rejects the
  // transcription-mode session.update below. The model goes in that frame instead.
  const url = `${REALTIME_URL}?intent=transcription`;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let transcript = "";
    const ws = new WS(url, {
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
      },
    });

    const finish = (err?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve((text ?? "").trim());
    };

    const timer = setTimeout(() => {
      finish(new Error(`Realtime STT timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: TARGET_RATE },
                transcription: {
                  model,
                  prompt: opts.prompt ?? VOICE_STT_PROMPT,
                  delay: "low",
                },
                turn_detection: null,
              },
            },
          },
        }),
      );

      for (let i = 0; i < pcm.byteLength; i += CHUNK_BYTES) {
        const slice = pcm.subarray(i, Math.min(i + CHUNK_BYTES, pcm.byteLength));
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: slice.toString("base64"),
          }),
        );
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    });

    ws.on("message", (raw) => {
      let event: {
        type?: string;
        transcript?: string;
        delta?: string;
        error?: { message?: string };
      };
      try {
        event = JSON.parse(String(raw)) as typeof event;
      } catch {
        return;
      }

      if (event.type === "error" || event.type === "invalid_request_error") {
        finish(new Error(`Realtime STT error: ${event.error?.message ?? JSON.stringify(event)}`));
        return;
      }

      if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
        transcript += event.delta;
        return;
      }

      if (event.type === "conversation.item.input_audio_transcription.completed") {
        const finalText = (event.transcript ?? transcript).trim();
        if (!finalText) {
          finish(new Error("Realtime STT returned empty transcript"));
          return;
        }
        finish(undefined, finalText);
      }
    });

    ws.on("error", (err) => {
      finish(err instanceof Error ? err : new Error(String(err)));
    });

    ws.on("close", () => {
      if (!settled) {
        if (transcript.trim()) finish(undefined, transcript);
        else finish(new Error("Realtime STT connection closed early"));
      }
    });
  });
}
