import { describe, expect, it } from "vitest";
import { pcmToWav } from "./pcm-wav.js";

describe("pcmToWav", () => {
  it("writes a valid RIFF/WAVE header around PCM bytes", () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(1000, 0);
    const wav = pcmToWav(pcm, { sampleRate: 48_000 });
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });
});
