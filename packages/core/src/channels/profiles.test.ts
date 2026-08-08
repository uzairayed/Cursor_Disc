import { describe, expect, it } from "vitest";
import { discordProfile, profileFor } from "./profiles.js";
import { splitMessage } from "../utils/split.js";

describe("channel profiles", () => {
  it("exposes Discord 2000 char limit", () => {
    expect(discordProfile.maxChars).toBe(2000);
    expect(profileFor("discord")).toBe(discordProfile);
  });

  it("formats Discord output as Discord markdown bold", () => {
    const out = discordProfile.formatOutput("Working in *CRM* now.");
    expect(out).toContain("**CRM**");
    expect(out).not.toMatch(/(?<!\*)\*CRM\*(?!\*)/);
  });

  it("keeps Discord code fences intact", () => {
    const input = "See:\n```\nconst x = 1;\n```\n*done*";
    const out = discordProfile.formatOutput(input);
    expect(out).toContain("```\nconst x = 1;\n```");
    expect(out).toContain("**done**");
  });

  it("splits at the Discord limit", () => {
    const long = "x".repeat(4500);
    expect(splitMessage(long, discordProfile.maxChars).every((c) => c.length <= 2000)).toBe(
      true
    );
    expect(splitMessage(long, discordProfile.maxChars).length).toBeGreaterThan(1);
  });
});
