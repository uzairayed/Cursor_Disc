import { PassThrough, Readable } from "node:stream";

/**
 * Fixed lines ("Ready.", "On it.", the error strings) repeat constantly, and a
 * cache hit plays in ~50ms versus a ~2s round trip. Only short texts are cached
 * so dynamic replies can't grow this unbounded.
 */
const CACHE_MAX_ENTRIES = 32;
const CACHE_MAX_CHARS = 120;
const cache = new Map<string, Buffer>();

export async function synthesizeSpeech(opts: {
  apiKey: string;
  text: string;
  voice?: string;
  model?: string;
  /** Playback speed 0.25–4.0 (default 1). */
  speed?: number;
  fetchImpl?: typeof fetch;
}): Promise<Readable> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = opts.model ?? "tts-1";
  const voice = opts.voice ?? "alloy";
  const speed = opts.speed ?? 1;
  const key = `${model}:${voice}:${speed}:${opts.text}`;

  const hit = cache.get(key);
  if (hit) return Readable.from(hit);

  const res = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: opts.text,
      voice,
      speed,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `TTS speech synthesis failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  // Playback starts on the first chunk instead of waiting for the whole clip.
  if (!res.body) return Readable.from(Buffer.from(await res.arrayBuffer()));
  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  if (opts.text.length > CACHE_MAX_CHARS) return source;

  const out = new PassThrough();
  const chunks: Buffer[] = [];
  source.on("data", (c: Buffer) => chunks.push(c));
  source.once("end", () => {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, Buffer.concat(chunks));
  });
  source.pipe(out);
  return out;
}
