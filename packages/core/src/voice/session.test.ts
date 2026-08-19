import { describe, expect, it, vi } from "vitest";
import { VoiceSession } from "./session.js";

function pcmLoud(bytes = 640): Buffer {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 2) buf.writeInt16LE(10_000, i);
  return buf;
}

async function flushCoalesce(): Promise<void> {
  await new Promise((r) => setTimeout(r, 15));
}

const base = {
  postSpeakMuteMs: 0,
  coalesceMs: 0,
};

describe("VoiceSession", () => {
  it("ignores audio from non-allowlisted users", async () => {
    const speak = vi.fn(async () => undefined);
    const transcribe = vi.fn(async () => "what time is it");
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe,
      now: () => new Date("2026-07-29T12:00:00Z"),
      ...base,
    });

    await session.onPcm("stranger", pcmLoud());
    await session.flushUser("stranger");
    await flushCoalesce();
    expect(transcribe).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("speaks the date for datetime intent", async () => {
    const speak = vi.fn(async (_text: string) => undefined);
    const transcribe = vi.fn(async () => "what time is it");
    const vadPush = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(Buffer.from("utterance"));

    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe,
      createVad: () => ({ push: vadPush, flush: () => null }),
      now: () => new Date("2026-07-29T12:00:00Z"),
      ...base,
    });

    await session.onPcm("owner", pcmLoud());
    await session.onPcm("owner", pcmLoud());
    await flushCoalesce();

    expect(transcribe).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0]![0]).toMatch(/2026|July|Wednesday|time/i);
  });

  it("ignores echo transcripts instead of calling the agent", async () => {
    const speak = vi.fn(async () => undefined);
    const handleAgent = vi.fn(async () => "should not run");
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe: vi.fn(async () => "listening, casting the"),
      handleAgent,
      createVad: () => ({
        push: () => Buffer.from("utt"),
        flush: () => null,
      }),
      ...base,
    });

    await session.onPcm("owner", pcmLoud());
    await flushCoalesce();
    expect(handleAgent).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("drops utterances while capture is closed", async () => {
    const transcribe = vi.fn(async () => "what's the date");
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak: vi.fn(async () => undefined),
      transcribe,
      ...base,
    });
    session.setListening(false);
    await session.ingestUtterance("owner", pcmLoud());
    await flushCoalesce();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("honors stop as barge-in during TTS", async () => {
    const stopSpeaking = vi.fn();
    // Starts as a no-op rather than null so it stays callable: TS can't see the
    // assignment inside the executor and would narrow a null default to never.
    let releaseSpeak = () => {};
    const speak = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSpeak = resolve;
        }),
    );
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      stopSpeaking,
      transcribe: vi
        .fn()
        .mockResolvedValueOnce("what's the date today")
        .mockResolvedValueOnce("stop"),
      ...base,
      coalesceMs: 5,
      postSpeakMuteMs: 0,
    });

    const turn = session.ingestUtterance("owner", pcmLoud()).then(() => flushCoalesce());
    await new Promise((r) => setTimeout(r, 30));
    expect(session.getCaptureMode()).toBe("interrupt");
    await session.ingestUtterance("owner", pcmLoud());
    expect(stopSpeaking).toHaveBeenCalled();
    releaseSpeak();
    await turn;
  });

  it("honors a buried stop word during TTS via streamed transcripts", async () => {
    const stopSpeaking = vi.fn();
    let releaseSpeak = () => {};
    const speak = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSpeak = resolve;
        }),
    );
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      stopSpeaking,
      transcribe: vi.fn().mockResolvedValue("what's the date today"),
      ...base,
      coalesceMs: 5,
    });

    const turn = session.ingestUtterance("owner", pcmLoud()).then(() => flushCoalesce());
    await new Promise((r) => setTimeout(r, 30));
    expect(session.getCaptureMode()).toBe("interrupt");
    // Not a clean "stop" — natural phrasing, as streaming STT delivers it.
    await session.ingestTranscript("owner", "okay, please stop talking now");
    expect(stopSpeaking).toHaveBeenCalled();
    releaseSpeak();
    await turn;
  });

  it("supports external bargeIn() while speaking", async () => {
    const stopSpeaking = vi.fn();
    let releaseSpeak = () => {};
    const speak = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSpeak = resolve;
        }),
    );
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      stopSpeaking,
      transcribe: vi.fn().mockResolvedValue("what's the date today"),
      ...base,
      coalesceMs: 5,
    });

    const turn = session.ingestUtterance("owner", pcmLoud()).then(() => flushCoalesce());
    await new Promise((r) => setTimeout(r, 30));
    await session.bargeIn();
    expect(stopSpeaking).toHaveBeenCalled();
    releaseSpeak();
    await turn;
  });

  it("drops open-mode transcripts that echo the bot's own reply", async () => {
    const handleAgent = vi.fn(async () => "should not run");
    const handleCommand = vi.fn(
      async () => "I've updated the config and restarted the dev server for you.",
    );
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => "status"),
      handleCommand,
      handleAgent,
      ...base,
    });

    await session.ingestUtterance("owner", pcmLoud());
    await flushCoalesce();
    expect(handleCommand).toHaveBeenCalled();

    // Speaker echo of that reply drifts back in once capture reopens.
    await session.ingestTranscript("owner", "updated the config and restarted the dev server");
    await flushCoalesce();
    expect(handleAgent).not.toHaveBeenCalled();

    // A genuinely new prompt still gets through.
    await session.ingestTranscript("owner", "fix the login bug in cliproom");
    await flushCoalesce();
    expect(handleAgent).toHaveBeenCalledOnce();
  });

  it("merges consecutive STT fragments before calling the agent", async () => {
    const handleAgent = vi.fn(async (_text: string) => "ok");
    const speak = vi.fn(async () => undefined);
    let n = 0;
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe: vi.fn(async () => {
        n += 1;
        return n === 1 ? "I was asking what is the latest news for" : "Kashmir";
      }),
      handleAgent,
      ...base,
      coalesceMs: 30,
    });

    await session.ingestUtterance("owner", pcmLoud());
    await session.ingestUtterance("owner", pcmLoud());
    await new Promise((r) => setTimeout(r, 60));

    expect(handleAgent).toHaveBeenCalledOnce();
    expect(handleAgent.mock.calls[0]![0]).toMatch(/Kashmir/i);
  });

  it("ignores thin agent prompts like a lone you", async () => {
    const handleAgent = vi.fn(async () => "nope");
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => "you"),
      handleAgent,
      ...base,
    });
    await session.ingestUtterance("owner", pcmLoud());
    await flushCoalesce();
    expect(handleAgent).not.toHaveBeenCalled();
  });

  it("routes commands through handleCommand and speaks the reply", async () => {
    const speak = vi.fn(async () => undefined);
    const handleCommand = vi.fn(async () => "Idle — no runs.");
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe: vi.fn(async () => "status"),
      handleCommand,
      createVad: () => ({
        push: () => Buffer.from("utt"),
        flush: () => null,
      }),
      ...base,
    });

    await session.onPcm("owner", pcmLoud());
    await flushCoalesce();
    expect(handleCommand).toHaveBeenCalledWith("status");
    expect(speak).toHaveBeenCalledWith("Idle — no runs.");
  });

  it("routes agent prompts and starts Cursor without waiting on On it TTS", async () => {
    const speak = vi.fn(async (_text: string) => undefined);
    const handleAgent = vi.fn(async () => "A".repeat(400));
    const onHeard = vi.fn(async () => undefined);
    const onText = vi.fn(async () => undefined);
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe: vi.fn(async () => "fix the login bug please"),
      handleAgent,
      onHeard,
      onText,
      createVad: () => ({
        push: () => Buffer.from("utt"),
        flush: () => null,
      }),
      ...base,
    });

    await session.onPcm("owner", pcmLoud());
    await flushCoalesce();
    expect(onHeard).toHaveBeenCalledWith("fix the login bug please");
    expect(handleAgent).toHaveBeenCalledWith("fix the login bug please", expect.any(AbortSignal));
    expect(onText).toHaveBeenCalled();
    // Default: no spoken "On it." — first speak is the reply chunk.
    expect(speak.mock.calls[0]![0]).not.toBe("On it.");
    expect(speak.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("dispatches date questions immediately (no coalesce delay)", async () => {
    const speak = vi.fn(async () => undefined);
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe: vi.fn(async () => "what's the date today"),
      now: () => new Date("2026-07-29T12:00:00Z"),
      postSpeakMuteMs: 0,
      // omit coalesceMs → adaptive 0 for datetime
    });

    await session.ingestUtterance("owner", pcmLoud());
    // Should already have spoken without needing a long flush wait
    await new Promise((r) => setTimeout(r, 5));
    expect(speak).toHaveBeenCalledOnce();
  });

  it("ignores empty transcripts", async () => {
    const speak = vi.fn(async () => undefined);
    const session = new VoiceSession({
      allowedUserIds: ["owner"],
      speak,
      transcribe: vi.fn(async () => "   "),
      createVad: () => ({
        push: () => Buffer.from("utt"),
        flush: () => null,
      }),
      ...base,
    });

    await session.onPcm("owner", pcmLoud());
    await flushCoalesce();
    expect(speak).not.toHaveBeenCalled();
  });
});
