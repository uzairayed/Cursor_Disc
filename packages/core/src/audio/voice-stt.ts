import { pcmToWav } from "./pcm-wav.js";
import { transcribeRealtimePcm } from "./realtime-transcribe.js";
import { VOICE_STT_PROMPT, transcribeAudio } from "./transcribe.js";

export type VoiceSttMode = "realtime" | "batch";

/**
 * Transcribe Discord voice PCM: prefer Realtime Whisper, fall back to batch STT.
 */
export async function transcribeVoicePcm(opts: {
  apiKey: string;
  pcm: Buffer;
  sampleRate: number;
  mode?: VoiceSttMode;
}): Promise<{ text: string; via: "realtime" | "batch" }> {
  const mode = opts.mode ?? "realtime";

  if (mode === "realtime") {
    try {
      const text = await transcribeRealtimePcm({
        apiKey: opts.apiKey,
        pcm: opts.pcm,
        sampleRate: opts.sampleRate,
        prompt: VOICE_STT_PROMPT,
      });
      return { text, via: "realtime" };
    } catch (err) {
      console.warn(
        "[voice] realtime STT failed, falling back to batch:",
        err instanceof Error ? err.message : err
      );
    }
  }

  const wav = pcmToWav(opts.pcm, { sampleRate: opts.sampleRate });
  const text = await transcribeAudio({
    apiKey: opts.apiKey,
    bytes: wav,
    filename: "utterance.wav",
    model: "gpt-4o-mini-transcribe",
    prompt: VOICE_STT_PROMPT,
  });
  return { text, via: "batch" };
}
