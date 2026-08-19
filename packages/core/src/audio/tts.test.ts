import type { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { synthesizeSpeech } from "./tts.js";

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Minimal stand-in for a streaming fetch Response body. */
function webStream(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function okResponse(bytes: Buffer) {
  return { ok: true, body: webStream(bytes) };
}

describe("synthesizeSpeech", () => {
  it("posts text to OpenAI TTS and streams back the audio", async () => {
    const audio = Buffer.from("fake-mp3");
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(audio));

    const result = await synthesizeSpeech({
      apiKey: "sk-test",
      text: "Hello there stream",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await collect(result)).toEqual(audio);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      model: "tts-1",
      input: "Hello there stream",
      voice: "alloy",
      response_format: "mp3",
    });
  });

  it("replays short repeated phrases from cache instead of refetching", async () => {
    const audio = Buffer.from("ready-clip");
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(audio));
    const args = {
      apiKey: "sk-test",
      text: "Ready.",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };

    expect(await collect(await synthesizeSpeech(args))).toEqual(audio);
    // Second call must not hit the network, and must still yield the same bytes.
    expect(await collect(await synthesizeSpeech(args))).toEqual(audio);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not cache long replies", async () => {
    const long = `x${"y".repeat(400)}`;
    const fetchImpl = vi.fn().mockImplementation(async () => okResponse(Buffer.from("clip")));
    const args = { apiKey: "sk-test", text: long, fetchImpl: fetchImpl as unknown as typeof fetch };

    await collect(await synthesizeSpeech(args));
    await collect(await synthesizeSpeech(args));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends playback speed and caches per speed", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => okResponse(Buffer.from("clip")));
    const args = {
      apiKey: "sk-test",
      text: "Speedy.",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };

    await collect(await synthesizeSpeech({ ...args, speed: 1.25 }));
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1].body)).speed).toBe(1.25);

    // Same text at a different speed is different audio — must not share a cache slot.
    await collect(await synthesizeSpeech({ ...args, speed: 1 }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await collect(await synthesizeSpeech({ ...args, speed: 1.25 }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors a custom voice", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(Buffer.from("hi")));

    await synthesizeSpeech({
      apiKey: "sk-test",
      text: "Hi there voice",
      voice: "nova",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1].body)).voice).toBe("nova");
  });

  it("throws a clear error when the API rejects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });

    await expect(
      synthesizeSpeech({
        apiKey: "sk-test",
        text: "Hi",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/tts|speech/i);
  });
});
