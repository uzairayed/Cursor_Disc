import { describe, expect, it } from "vitest";
import { buildAgentPrompt, buildVoicePrompt } from "./agent-prompt.js";

describe("buildVoicePrompt", () => {
  it("prefixes the transcript", () => {
    expect(buildVoicePrompt("fix login")).toBe("(voice note)\nfix login");
  });

  it("appends an optional caption", () => {
    expect(buildVoicePrompt("fix login", "urgent")).toBe(
      "(voice note)\nfix login\nurgent"
    );
  });
});

describe("buildAgentPrompt", () => {
  it("builds a text-only prompt", () => {
    expect(buildAgentPrompt({ text: "refactor auth", imagePath: null })).toBe("refactor auth");
  });

  it("includes image path and default analyze instruction", () => {
    const out = buildAgentPrompt({
      text: null,
      imagePath: "/tmp/shot.png",
    });
    expect(out).toContain("/tmp/shot.png");
    expect(out).toMatch(/analyze this image/i);
  });

  it("notes forwarded messages with a source label", () => {
    const out = buildAgentPrompt({
      text: "see this",
      imagePath: null,
      isForwarded: true,
      sourceLabel: "Discord",
    });
    expect(out).toMatch(/forwarded from Discord/i);
    expect(out).toContain("see this");
  });

  it("includes voice text and multiple image paths together", () => {
    const out = buildAgentPrompt({
      text: "(voice note)\nfix login",
      imagePath: "/tmp/a.png",
      extraImagePaths: ["/tmp/b.png"],
    });
    expect(out).toContain("/tmp/a.png");
    expect(out).toContain("/tmp/b.png");
    expect(out).toContain("fix login");
  });
});
