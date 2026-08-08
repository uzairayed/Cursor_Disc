import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";
import { resolveMessageContext } from "./message-context.js";

describe("resolveMessageContext", () => {
  it("marks DMs", () => {
    const ctx = resolveMessageContext({
      author: { id: "u1", bot: false },
      channelId: "dm-1",
      guildId: null,
      channel: { type: ChannelType.DM },
    } as never);
    expect(ctx.isDm).toBe(true);
    expect(ctx.isThread).toBe(false);
    expect(ctx.parentChannelId).toBeNull();
  });

  it("captures thread parent id", () => {
    const ctx = resolveMessageContext({
      author: { id: "u1", bot: false },
      channelId: "thread-1",
      guildId: "g1",
      channel: {
        type: ChannelType.PublicThread,
        parentId: "parent-9",
      },
    } as never);
    expect(ctx.isThread).toBe(true);
    expect(ctx.isDm).toBe(false);
    expect(ctx.parentChannelId).toBe("parent-9");
    expect(ctx.channelId).toBe("thread-1");
  });

  it("marks bots", () => {
    const ctx = resolveMessageContext({
      author: { id: "bot", bot: true },
      channelId: "c1",
      guildId: "g1",
      channel: { type: ChannelType.GuildText },
    } as never);
    expect(ctx.isBot).toBe(true);
  });
});
