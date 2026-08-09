import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { transcribeAudio } from "./transcribe.js";

describe("transcribeAudio", () => {
  it("posts the file to OpenAI Whisper and returns the text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-whisper-"));
    const filePath = join(dir, "note.ogg");
    writeFileSync(filePath, Buffer.from("fake-audio"));

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "fix the login bug" }),
    });

    const text = await transcribeAudio({
      apiKey: "sk-test",
      filePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(text).toBe("fix the login bug");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
  });

  it("throws a clear error when the API rejects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-whisper-"));
    const filePath = join(dir, "note.ogg");
    writeFileSync(filePath, Buffer.from("fake-audio"));

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    await expect(
      transcribeAudio({
        apiKey: "bad",
        filePath,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/whisper|transcri/i);
  });

  it("accepts in-memory bytes and uses gpt-4o-mini-transcribe by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "check my email" }),
    });

    const text = await transcribeAudio({
      apiKey: "sk-test",
      bytes: Buffer.from("pcm-or-wav"),
      filename: "utterance.wav",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(text).toBe("check my email");
    const [, init] = fetchImpl.mock.calls[0]!;
    const form = (init as RequestInit).body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    const file = form.get("file");
    expect(file).toBeTruthy();
  });

  it("allows overriding the model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "hi" }),
    });

    await transcribeAudio({
      apiKey: "sk-test",
      bytes: Buffer.from("x"),
      filename: "u.wav",
      model: "whisper-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const form = fetchImpl.mock.calls[0]![1].body as FormData;
    expect(form.get("model")).toBe("whisper-1");
  });

  it("forwards an optional prompt for vocabulary biasing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "status" }),
    });

    await transcribeAudio({
      apiKey: "sk-test",
      bytes: Buffer.from("x"),
      filename: "u.wav",
      prompt: "status stop help",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const form = fetchImpl.mock.calls[0]![1].body as FormData;
    expect(form.get("prompt")).toBe("status stop help");
  });
});
