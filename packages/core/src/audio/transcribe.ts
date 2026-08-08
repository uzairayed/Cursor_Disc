import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Bias STT toward assistant vocabulary (Whisper / gpt-4o-transcribe prompt). */
export const VOICE_STT_PROMPT =
  "Personal Discord assistant. Phrases: what's the date, what time is it, check my email, status, stop, stop all, help, switch to project, Cursor coding tasks.";

export type TranscribeAudioOpts = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Prefer gpt-4o-mini-transcribe. */
  model?: string;
  /** Optional vocabulary / context hint for the transcription model. */
  prompt?: string;
  filePath?: string;
  bytes?: Buffer;
  filename?: string;
};

export async function transcribeAudio(opts: TranscribeAudioOpts): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = opts.model ?? "gpt-4o-mini-transcribe";

  let bytes: Buffer;
  let filename: string;
  if (opts.filePath) {
    bytes = readFileSync(opts.filePath);
    filename = basename(opts.filePath);
  } else if (opts.bytes && opts.filename) {
    bytes = opts.bytes;
    filename = opts.filename;
  } else {
    throw new Error("transcribeAudio requires filePath or bytes+filename");
  }

  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([new Uint8Array(bytes)]), filename);
  if (opts.prompt) form.append("prompt", opts.prompt);

  const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Whisper transcription failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  const data = (await res.json()) as { text?: string };
  const text = data.text?.trim();
  if (!text) throw new Error("Whisper transcription returned empty text");
  return text;
}
