import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeSttSession } from "./realtime-session.js";

class FakeWebSocket extends EventEmitter {
  static last: FakeWebSocket | null = null;
  sent: string[] = [];
  readyState = 1;

  constructor(
    public url: string,
    public opts?: { headers?: Record<string, string> },
  ) {
    super();
    FakeWebSocket.last = this;
    queueMicrotask(() => this.emit("open"));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

const WS = FakeWebSocket as unknown as typeof import("ws").default;
/** 100ms of 48kHz mono s16le — one tick's worth after the 2x downsample. */
const frame48 = () => Buffer.alloc(48_000 * 2 * 0.1, 7);
const appends = (ws: FakeWebSocket) =>
  ws.sent.map((s) => JSON.parse(s)).filter((e) => e.type === "input_audio_buffer.append");

function makeSession(onTranscript = vi.fn()) {
  return {
    onTranscript,
    session: new RealtimeSttSession({ apiKey: "sk-test", onTranscript, WebSocketImpl: WS }),
  };
}

describe("RealtimeSttSession", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens a transcription session configured for server VAD", async () => {
    const { session } = makeSession();
    await session.connect();

    const ws = FakeWebSocket.last!;
    expect(ws.url).toContain("intent=transcription");
    expect(ws.opts?.headers?.Authorization).toBe("Bearer sk-test");
    const input = JSON.parse(ws.sent[0]!).session.audio.input;
    expect(input.transcription.model).toBe("gpt-4o-mini-transcribe");
    expect(input.transcription.prompt).toBeTruthy();
    // Server-side endpointing is the whole point: a null turn_detection would
    // put the fixed client-side silence timer back in the response path.
    expect(input.turn_detection.type).toBe("server_vad");
    session.close();
  });

  it("streams audio while the user speaks and pads gaps with silence", async () => {
    const { session } = makeSession();
    await session.connect();
    const ws = FakeWebSocket.last!;

    session.pushPcm(frame48(), 48_000);
    await vi.advanceTimersByTimeAsync(100);
    expect(appends(ws)).toHaveLength(1);

    // No new audio, but the stream must stay unbroken for server VAD.
    await vi.advanceTimersByTimeAsync(300);
    const sent = appends(ws);
    expect(sent.length).toBeGreaterThanOrEqual(3);

    // Every frame is exactly one tick of 24kHz mono s16le (4800 bytes).
    for (const e of sent) expect(Buffer.from(e.audio, "base64").byteLength).toBe(4800);
    // The padding frames are actual silence, not repeated speech.
    expect(Buffer.from(sent.at(-1)!.audio, "base64").every((b) => b === 0)).toBe(true);
    session.close();
  });

  it("stops streaming once the turn goes idle so silence isn't billed", async () => {
    const { session } = makeSession();
    await session.connect();
    const ws = FakeWebSocket.last!;

    session.pushPcm(frame48(), 48_000);
    await vi.advanceTimersByTimeAsync(2000);
    const afterIdle = appends(ws).length;

    await vi.advanceTimersByTimeAsync(5000);
    expect(appends(ws).length).toBe(afterIdle);
    session.close();
  });

  it("drops transcripts from sub-350ms noise blips (prompt hallucination guard)", async () => {
    const onTranscript = vi.fn();
    const { session } = makeSession(onTranscript);
    await session.connect();
    const ws = FakeWebSocket.last!;

    const turn = (startMs: number, endMs: number, transcript: string) => {
      ws.emit(
        "message",
        JSON.stringify({ type: "input_audio_buffer.speech_started", audio_start_ms: startMs }),
      );
      ws.emit(
        "message",
        JSON.stringify({ type: "input_audio_buffer.speech_stopped", audio_end_ms: endMs }),
      );
      ws.emit(
        "message",
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          transcript,
        }),
      );
    };

    turn(0, 200, "What's the date?"); // noise blip -> hallucinated question
    expect(onTranscript).not.toHaveBeenCalled();

    turn(1000, 2200, "what's the date today");
    expect(onTranscript).toHaveBeenCalledOnce();
    session.close();
  });

  it("emits completed transcripts", async () => {
    const onTranscript = vi.fn();
    const { session } = makeSession(onTranscript);
    await session.connect();

    FakeWebSocket.last!.emit(
      "message",
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "  what's the date today  ",
      }),
    );

    expect(onTranscript).toHaveBeenCalledWith("what's the date today");
    session.close();
  });

  it("reconnects when the socket drops mid-session", async () => {
    const { session } = makeSession();
    await session.connect();
    const first = FakeWebSocket.last!;

    first.close();
    await vi.advanceTimersByTimeAsync(600);

    expect(FakeWebSocket.last).not.toBe(first);
    expect(JSON.parse(FakeWebSocket.last!.sent[0]!).type).toBe("session.update");
    session.close();
  });

  it("stops reconnecting after close()", async () => {
    const { session } = makeSession();
    await session.connect();
    const ws = FakeWebSocket.last!;

    session.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeWebSocket.last).toBe(ws);
  });
});
