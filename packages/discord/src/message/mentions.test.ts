import { describe, expect, it } from "vitest";
import { isBotDirectlyMentioned, stripBotMentions } from "./mentions.js";

describe("isBotDirectlyMentioned", () => {
  it("always allows DMs without a tag", () => {
    expect(
      isBotDirectlyMentioned({
        isDm: true,
        botUserId: "bot-1",
        content: "help",
      }),
    ).toBe(true);
  });

  it("requires a direct mention in guild parent channels", () => {
    expect(
      isBotDirectlyMentioned({
        isDm: false,
        isThread: false,
        botUserId: "bot-1",
        content: "help me refactor",
      }),
    ).toBe(false);
    expect(
      isBotDirectlyMentioned({
        isDm: false,
        isThread: false,
        botUserId: "bot-1",
        content: "<@bot-1> help me refactor",
      }),
    ).toBe(true);
    expect(
      isBotDirectlyMentioned({
        isDm: false,
        isThread: false,
        botUserId: "bot-1",
        mentionedUserIds: ["bot-1"],
        content: "help",
      }),
    ).toBe(true);
  });

  it("allows threads without a tag", () => {
    expect(
      isBotDirectlyMentioned({
        isDm: false,
        isThread: true,
        botUserId: "bot-1",
        content: "continue polishing",
      }),
    ).toBe(true);
  });
});

describe("stripBotMentions", () => {
  it("removes nickname and normal mention forms", () => {
    expect(stripBotMentions("<@bot-1> switch to crm", "bot-1")).toBe("switch to crm");
    expect(stripBotMentions("<@!bot-1>  status", "bot-1")).toBe("status");
  });
});
