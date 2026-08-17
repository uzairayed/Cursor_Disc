import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { resolveReplyDestination, threadNameForPrompt } from "./reply-destination.js";

describe("threadNameForPrompt", () => {
  it("truncates long prompts and strips newlines", () => {
    const name = threadNameForPrompt(`fix auth\nand more ${"x".repeat(120)}`);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).not.toContain("\n");
    expect(name.startsWith("fix auth")).toBe(true);
  });

  it("falls back when empty", () => {
    expect(threadNameForPrompt("")).toBe("Cursor");
    expect(threadNameForPrompt("   ")).toBe("Cursor");
  });
});

describe("resolveReplyDestination", () => {
  it("reuses an existing thread channel", async () => {
    const sends: string[] = [];
    const message = {
      id: "msg-1",
      channelId: "thread-1",
      content: "continue",
      channel: {
        type: ChannelType.PublicThread,
        id: "thread-1",
        isThread: () => true,
        isDMBased: () => false,
        isSendable: () => true,
        send: vi.fn(async (t: string) => {
          sends.push(t);
          return {};
        }),
      },
      startThread: vi.fn(),
      reply: vi.fn(),
    };

    const dest = await resolveReplyDestination({
      message: message as never,
      isDm: false,
      isThread: true,
      promptPreview: "continue",
    });

    expect(message.startThread).not.toHaveBeenCalled();
    expect(dest.conversationId).toBe("thread-1");
    await dest.send("hello");
    expect(sends).toEqual(["hello"]);
  });

  it("creates a guild thread from a parent-channel message and sends there", async () => {
    const threadSends: string[] = [];
    const thread = {
      id: "thread-new",
      send: vi.fn(async (t: string) => {
        threadSends.push(t);
        return {};
      }),
    };
    const message = {
      id: "msg-2",
      content: "refactor auth",
      channel: {
        type: ChannelType.GuildText,
        id: "chan-1",
        isThread: () => false,
        isDMBased: () => false,
        send: vi.fn(),
      },
      startThread: vi.fn(async (_opts: { name: string }) => thread),
      reply: vi.fn(),
    };

    const dest = await resolveReplyDestination({
      message: message as never,
      isDm: false,
      isThread: false,
      promptPreview: "refactor auth middleware please",
    });

    expect(message.startThread).toHaveBeenCalledOnce();
    expect(message.startThread.mock.calls[0]?.[0]?.name).toMatch(/refactor auth/i);
    expect(dest.conversationId).toBe("thread-new");
    await dest.send("working");
    expect(threadSends).toEqual(["working"]);
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it("falls back to message.reply in DMs (no native threads)", async () => {
    const replies: string[] = [];
    const message = {
      id: "msg-dm",
      channelId: "dm-1",
      content: "help",
      channel: {
        type: ChannelType.DM,
        id: "dm-1",
        isThread: () => false,
        isDMBased: () => true,
        send: vi.fn(async (t: string) => {
          replies.push(`send:${t}`);
          return {};
        }),
      },
      startThread: vi.fn(),
      reply: vi.fn(async (t: string) => {
        replies.push(`reply:${t}`);
        return {};
      }),
    };

    const dest = await resolveReplyDestination({
      message: message as never,
      isDm: true,
      isThread: false,
      promptPreview: "help",
    });

    expect(message.startThread).not.toHaveBeenCalled();
    expect(dest.conversationId).toBe("dm-1");
    await dest.send("Hey there");
    expect(replies).toEqual(["reply:Hey there"]);
  });

  it("falls back to channel.send if guild thread creation fails", async () => {
    const sends: string[] = [];
    const message = {
      id: "msg-3",
      content: "hi",
      channel: {
        type: ChannelType.GuildText,
        id: "chan-1",
        isThread: () => false,
        isDMBased: () => false,
        send: vi.fn(async (t: string) => {
          sends.push(t);
          return {};
        }),
      },
      startThread: vi.fn(async () => {
        throw new Error("Missing Permissions");
      }),
      reply: vi.fn(),
    };

    const dest = await resolveReplyDestination({
      message: message as never,
      isDm: false,
      isThread: false,
      promptPreview: "hi",
    });

    await dest.send("ok");
    expect(sends).toEqual(["ok"]);
  });
});
