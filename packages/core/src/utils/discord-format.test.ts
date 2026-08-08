import { describe, expect, it } from "vitest";
import { formatForDiscord } from "./discord-format.js";

describe("formatForDiscord", () => {
  it("converts WhatsApp-style bold to Discord bold", () => {
    expect(formatForDiscord("Working in *CRM* now.")).toBe("Working in **CRM** now.");
  });

  it("leaves fenced code alone", () => {
    const input = "code:\n```\n*not bold*\n```\nout";
    expect(formatForDiscord(input)).toContain("```\n*not bold*\n```");
  });
});
