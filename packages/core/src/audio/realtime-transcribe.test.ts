import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { transcribeRealtimePcm } from "./realtime-transcribe.js";

class FakeWebSocket extends EventEmitter {
  static last: FakeWebSocket | null = null;
  sent: string[] = [];
  readyState = 1;

  constructor(
    public url: string,
    public opts?: { headers?: Record<string, string> }
  ) {
    super();
    FakeWebSocket.last = this;
    queueMicrotask(() => this.emit("open"));
  }

  send(data: string): void {
    this.sent.push(data);
    const msg = JSON.parse(data) as { type: string };
    if (msg.type === "input_audio_buffer.commit") {
      queueMicrotask(() => {
        this.emit(
          "message",
          JSON.stringify({
            type: "conversation.item.input_audio_transcription.completed",
            transcript: "what's the date today",
          })
        );
      });
    }
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

describe("transcribeRealtimePcm", () => {
  it("opens a realtime session, appends PCM, and returns the completed transcript", async () => {
    const pcm = Buffer.alloc(4800); // 100ms @ 24kHz after downsample from 48k
    // 48kHz input: 9600 bytes = 100ms
    const pcm48 = Buffer.alloc(9600);

    const text = await transcribeRealtimePcm({
      apiKey: "sk-test",
      pcm: pcm48,
      sampleRate: 48_000,
      WebSocketImpl: FakeWebSocket as unknown as typeof import("ws").default,
    });

    expect(text).toBe("what's the date today");
    const ws = FakeWebSocket.last!;
    expect(ws.url).toContain("gpt-realtime-whisper");
    expect(ws.opts?.headers?.Authorization).toBe("Bearer sk-test");
    const types = ws.sent.map((s) => JSON.parse(s).type);
    expect(types[0]).toBe("session.update");
    expect(types).toContain("input_audio_buffer.append");
    expect(types).toContain("input_audio_buffer.commit");
    void pcm;
  });

  it("rejects on server error events", async () => {
    class ErrSocket extends FakeWebSocket {
      send(data: string): void {
        this.sent.push(data);
        const msg = JSON.parse(data) as { type: string };
        if (msg.type === "input_audio_buffer.commit") {
          queueMicrotask(() => {
            this.emit(
              "message",
              JSON.stringify({
                type: "error",
                error: { message: "model not available" },
              })
            );
          });
        }
      }
    }

    await expect(
      transcribeRealtimePcm({
        apiKey: "sk-test",
        pcm: Buffer.alloc(9600),
        sampleRate: 48_000,
        WebSocketImpl: ErrSocket as unknown as typeof import("ws").default,
      })
    ).rejects.toThrow(/model not available|Realtime STT/i);
  });
});
