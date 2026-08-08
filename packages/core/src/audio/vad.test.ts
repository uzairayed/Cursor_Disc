import { describe, expect, it } from "vitest";
import { VadSegmenter } from "./vad.js";

/** 16-bit mono PCM helper: amplitude 0..1 */
function pcmFrame(samples: number, amplitude: number): Buffer {
  const buf = Buffer.alloc(samples * 2);
  const sample = Math.round(amplitude * 32767);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(sample, i * 2);
  return buf;
}

describe("VadSegmenter", () => {
  const sampleRate = 16_000;
  const frameMs = 20;
  const samplesPerFrame = (sampleRate * frameMs) / 1000;

  it("emits one utterance after speech followed by silence", () => {
    const vad = new VadSegmenter({
      sampleRate,
      frameMs,
      silenceMs: 80,
      minSpeechMs: 40,
      energyThreshold: 0.02,
    });

    const loud = pcmFrame(samplesPerFrame, 0.3);
    const quiet = pcmFrame(samplesPerFrame, 0);

    expect(vad.push(loud)).toBeNull();
    expect(vad.push(loud)).toBeNull();
    expect(vad.push(loud)).toBeNull(); // ~60ms speech > min
    expect(vad.push(quiet)).toBeNull();
    expect(vad.push(quiet)).toBeNull();
    expect(vad.push(quiet)).toBeNull();
    const segment = vad.push(quiet); // 80ms silence
    expect(segment).not.toBeNull();
    expect(segment!.byteLength).toBeGreaterThan(0);
  });

  it("ignores pure silence", () => {
    const vad = new VadSegmenter({
      sampleRate,
      frameMs,
      silenceMs: 80,
      minSpeechMs: 40,
      energyThreshold: 0.02,
    });
    const quiet = pcmFrame(samplesPerFrame, 0);
    for (let i = 0; i < 20; i++) {
      expect(vad.push(quiet)).toBeNull();
    }
  });

  it("ignores too-short blips", () => {
    const vad = new VadSegmenter({
      sampleRate,
      frameMs,
      silenceMs: 80,
      minSpeechMs: 100,
      energyThreshold: 0.02,
    });
    const loud = pcmFrame(samplesPerFrame, 0.3);
    const quiet = pcmFrame(samplesPerFrame, 0);

    expect(vad.push(loud)).toBeNull(); // 20ms < 100ms
    expect(vad.push(quiet)).toBeNull();
    expect(vad.push(quiet)).toBeNull();
    expect(vad.push(quiet)).toBeNull();
    expect(vad.push(quiet)).toBeNull();
  });
});
