export async function synthesizeSpeech(opts: {
  apiKey: string;
  text: string;
  voice?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "tts-1",
      input: opts.text,
      voice: opts.voice ?? "alloy",
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `TTS speech synthesis failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
