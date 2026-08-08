import { describe, expect, it, vi } from "vitest";
import { synthesizeSpeech } from "./tts.js";

describe("synthesizeSpeech", () => {
  it("posts text to OpenAI TTS and returns audio bytes", async () => {
    const audio = Buffer.from("fake-mp3");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
    });

    const result = await synthesizeSpeech({
      apiKey: "sk-test",
      text: "Hello there",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(audio)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      model: "tts-1",
      input: "Hello there",
      voice: "alloy",
      response_format: "mp3",
    });
  });

  it("honors a custom voice", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(2),
    });

    await synthesizeSpeech({
      apiKey: "sk-test",
      text: "Hi",
      voice: "nova",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1].body));
    expect(body.voice).toBe("nova");
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
      })
    ).rejects.toThrow(/tts|speech/i);
  });
});
