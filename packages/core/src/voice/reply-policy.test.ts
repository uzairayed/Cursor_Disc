import { describe, expect, it } from "vitest";
import { spokenChunksFromText, spokenReplyFromText } from "./reply-policy.js";

describe("spokenReplyFromText", () => {
  it("preserves short answers", () => {
    expect(spokenReplyFromText("It's Tuesday.")).toBe("It's Tuesday.");
  });

  it("truncates long Cursor replies to about 280 characters by default", () => {
    const long = "A".repeat(400);
    const spoken = spokenReplyFromText(long);
    expect(spoken.length).toBeLessThanOrEqual(280);
    expect(spoken.endsWith("…") || spoken.endsWith("...")).toBe(true);
  });

  it("strips markdown fences and collapses whitespace", () => {
    const text = "```ts\nconst x = 1;\n```\n\nDone with the fix.";
    const spoken = spokenReplyFromText(text);
    expect(spoken).not.toMatch(/```/);
    expect(spoken).toMatch(/Done with the fix/);
  });

  it("returns a fallback for empty text", () => {
    expect(spokenReplyFromText("   ")).toBe("Done.");
  });
});

describe("spokenChunksFromText", () => {
  it("returns a single chunk for short text", () => {
    expect(spokenChunksFromText("Hello there.")).toEqual(["Hello there."]);
  });

  it("splits long answers into multiple speakable chunks", () => {
    const sentences = Array.from(
      { length: 20 },
      (_, i) => `Sentence number ${i + 1} is here.`,
    ).join(" ");
    const chunks = spokenChunksFromText(sentences, { chunkChars: 80, maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ").length).toBeLessThanOrEqual(420);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
  });
});
