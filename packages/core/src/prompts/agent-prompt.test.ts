import { describe, expect, it } from "vitest";
import {
  buildAgentPrompt,
  buildVoicePrompt,
  DISCORD_AGENT_PREFIX,
  withDiscordPrefix,
} from "./agent-prompt.js";

describe("withDiscordPrefix", () => {
  it("puts the user task first so style lines are not treated as the prompt", () => {
    const out = withDiscordPrefix("Do we have the latest changes from GitHub");
    expect(out.startsWith("Do we have the latest changes from GitHub")).toBe(true);
    expect(out.endsWith(DISCORD_AGENT_PREFIX)).toBe(true);
    expect(withDiscordPrefix(out)).toBe(out);
  });

  it("leaves blank prompts alone", () => {
    expect(withDiscordPrefix("")).toBe("");
    expect(withDiscordPrefix("   ")).toBe("");
  });
});

describe("buildVoicePrompt", () => {
  it("prefixes the transcript", () => {
    expect(buildVoicePrompt("fix login")).toBe("(voice note)\nfix login");
  });

  it("appends an optional caption", () => {
    expect(buildVoicePrompt("fix login", "urgent")).toBe("(voice note)\nfix login\nurgent");
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

  it("includes document paths with a read instruction", () => {
    const out = buildAgentPrompt({
      text: "summarize this",
      imagePath: null,
      documentPaths: ["/tmp/spec.pdf", "/tmp/notes.txt"],
    });
    expect(out).toContain("/tmp/spec.pdf");
    expect(out).toContain("/tmp/notes.txt");
    expect(out).toMatch(/open and read this file/i);
    expect(out).toContain("summarize this");
  });

  it("falls back to a read request when only documents are attached", () => {
    const out = buildAgentPrompt({
      text: null,
      imagePath: null,
      documentPaths: ["/tmp/spec.pdf"],
    });
    expect(out).toMatch(/read this document/i);
  });
});
