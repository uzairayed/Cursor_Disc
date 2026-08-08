import { describe, expect, it } from "vitest";
import { splitMessage } from "./split.js";

describe("splitMessage", () => {
  it("returns a single chunk when under the limit", () => {
    expect(splitMessage("hello", 4000)).toEqual(["hello"]);
  });

  it("splits text longer than maxChars into multiple chunks", () => {
    const text = "a".repeat(5000);
    const chunks = splitMessage(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });
});
