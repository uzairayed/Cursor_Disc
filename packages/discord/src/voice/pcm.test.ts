import { describe, expect, it } from "vitest";
import { stereoToMono } from "./pcm.js";

describe("stereoToMono", () => {
  it("averages left and right samples", () => {
    const stereo = Buffer.alloc(8);
    stereo.writeInt16LE(1000, 0);
    stereo.writeInt16LE(3000, 2);
    stereo.writeInt16LE(-1000, 4);
    stereo.writeInt16LE(-3000, 6);
    const mono = stereoToMono(stereo);
    expect(mono.byteLength).toBe(4);
    expect(mono.readInt16LE(0)).toBe(2000);
    expect(mono.readInt16LE(2)).toBe(-2000);
  });
});
