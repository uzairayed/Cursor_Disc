import { describe, expect, it } from "vitest";
import { downsamplePcmMonoS16le } from "./resample.js";

describe("downsamplePcmMonoS16le", () => {
  it("keeps every Nth sample", () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(100, 0);
    pcm.writeInt16LE(200, 2);
    pcm.writeInt16LE(300, 4);
    pcm.writeInt16LE(400, 6);
    const out = downsamplePcmMonoS16le(pcm, 2);
    expect(out.byteLength).toBe(4);
    expect(out.readInt16LE(0)).toBe(100);
    expect(out.readInt16LE(2)).toBe(300);
  });
});
