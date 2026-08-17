import { describe, expect, it } from "vitest";
import {
  assertDiscordAllowlistConfigured,
  effectiveAllowedChannelIds,
  isAllowedDiscordUser,
  isDiscordAuthorized,
  isDiscordChannelAllowed,
  isDiscordIdentityAllowed,
  isPublicUserAllowlist,
  parseIdList,
} from "./allowlist.js";

describe("parseIdList", () => {
  it("parses comma-separated snowflakes", () => {
    expect(parseIdList("111, 222 ,333")).toEqual(["111", "222", "333"]);
  });

  it("returns empty for blank input", () => {
    expect(parseIdList(undefined)).toEqual([]);
    expect(parseIdList("")).toEqual([]);
  });
});

describe("isDiscordAuthorized", () => {
  const users = ["user-1", "user-2"];
  const channels = ["chan-1", "chan-parent"];

  it("allows allowlisted users in DMs", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: true,
        channelId: "dm-1",
        allowedUserIds: users,
        allowedChannelIds: channels,
      }),
    ).toBe(true);
  });

  it("denies non-allowlisted users in DMs", () => {
    expect(
      isDiscordAuthorized({
        userId: "stranger",
        isBot: false,
        isDm: true,
        channelId: "dm-1",
        allowedUserIds: users,
        allowedChannelIds: channels,
      }),
    ).toBe(false);
  });

  it("allows guild messages when user and channel are allowlisted", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: false,
        channelId: "chan-1",
        allowedUserIds: users,
        allowedChannelIds: channels,
      }),
    ).toBe(true);
  });

  it("denies guild messages in non-allowlisted channels", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: false,
        channelId: "other-chan",
        allowedUserIds: users,
        allowedChannelIds: channels,
      }),
    ).toBe(false);
  });

  it("allows threads when the thread id is allowlisted", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: false,
        channelId: "thread-99",
        parentChannelId: "somewhere-else",
        isThread: true,
        allowedUserIds: users,
        allowedChannelIds: ["thread-99"],
      }),
    ).toBe(true);
  });

  it("allows threads when the parent channel is allowlisted", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-2",
        isBot: false,
        isDm: false,
        channelId: "thread-1",
        parentChannelId: "chan-parent",
        isThread: true,
        allowedUserIds: users,
        allowedChannelIds: channels,
      }),
    ).toBe(true);
  });

  it("denies threads when neither thread nor parent is allowlisted", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: false,
        channelId: "thread-1",
        parentChannelId: "not-listed",
        isThread: true,
        allowedUserIds: users,
        allowedChannelIds: channels,
      }),
    ).toBe(false);
  });

  it("always ignores bots", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: true,
        isDm: true,
        channelId: "dm-1",
        allowedUserIds: users,
        allowedChannelIds: channels,
      }),
    ).toBe(false);
  });

  it("allows guild messages when guild is allowlisted", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: false,
        channelId: "chan-1",
        guildId: "guild-1",
        allowedUserIds: users,
        allowedChannelIds: channels,
        allowedGuildIds: ["guild-1"],
      }),
    ).toBe(true);
  });

  it("denies guild messages from a non-allowlisted guild", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: false,
        channelId: "chan-1",
        guildId: "other-guild",
        allowedUserIds: users,
        allowedChannelIds: channels,
        allowedGuildIds: ["guild-1"],
      }),
    ).toBe(false);
  });

  it("allows any guild user when * and the channel is listed", () => {
    expect(
      isDiscordAuthorized({
        userId: "stranger",
        isBot: false,
        isDm: false,
        channelId: "chan-1",
        guildId: "guild-1",
        allowedUserIds: ["*"],
        allowedChannelIds: channels,
        allowedGuildIds: ["guild-1"],
      }),
    ).toBe(true);
  });

  it("allows any channel in an allowlisted guild when * and channels are empty", () => {
    expect(
      isDiscordAuthorized({
        userId: "stranger",
        isBot: false,
        isDm: false,
        channelId: "random-chan",
        guildId: "guild-1",
        allowedUserIds: ["*"],
        allowedChannelIds: [],
        allowedGuildIds: ["guild-1"],
      }),
    ).toBe(true);
  });

  it("denies DMs for * — public does not open direct messages", () => {
    expect(
      isDiscordAuthorized({
        userId: "stranger",
        isBot: false,
        isDm: true,
        channelId: "dm-1",
        allowedUserIds: ["*"],
        allowedChannelIds: channels,
        allowedGuildIds: ["guild-1"],
      }),
    ).toBe(false);
  });

  it("still allows listed users to DM when * is also set", () => {
    expect(
      isDiscordAuthorized({
        userId: "user-1",
        isBot: false,
        isDm: true,
        channelId: "dm-1",
        allowedUserIds: ["*", "user-1"],
        allowedChannelIds: channels,
      }),
    ).toBe(true);
  });

  it("denies public users from a guild that is not listed", () => {
    expect(
      isDiscordAuthorized({
        userId: "stranger",
        isBot: false,
        isDm: false,
        channelId: "chan-1",
        guildId: "other-guild",
        allowedUserIds: ["*"],
        allowedChannelIds: channels,
        allowedGuildIds: ["guild-1"],
      }),
    ).toBe(false);
  });
});

describe("isDiscordIdentityAllowed", () => {
  const users = ["user-1"];
  const base = {
    userId: "user-1",
    isBot: false,
    isDm: false,
    channelId: "other-chan",
    allowedUserIds: users,
    allowedChannelIds: ["chan-1"],
  };

  it("allows an allowlisted user even in an unknown channel", () => {
    expect(isDiscordIdentityAllowed(base)).toBe(true);
    expect(isDiscordChannelAllowed(base)).toBe(false);
    expect(isDiscordAuthorized(base)).toBe(false);
  });

  it("denies strangers regardless of channel", () => {
    expect(isDiscordIdentityAllowed({ ...base, userId: "stranger" })).toBe(false);
  });
});

describe("effectiveAllowedChannelIds", () => {
  it("merges and dedupes configured + project channels", () => {
    expect(effectiveAllowedChannelIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("public user allowlist", () => {
  it("treats * as public", () => {
    expect(isPublicUserAllowlist(["*"])).toBe(true);
    expect(isPublicUserAllowlist(["user-1", "*"])).toBe(true);
    expect(isPublicUserAllowlist(["user-1"])).toBe(false);
    expect(isAllowedDiscordUser("anyone", ["*"])).toBe(true);
    expect(isAllowedDiscordUser("stranger", ["user-1"])).toBe(false);
  });

  it("refuses * without a guild or channel venue", () => {
    expect(() => assertDiscordAllowlistConfigured(["*"])).toThrow(/DISCORD_ALLOWED_USER_IDS=\*/);
    expect(() => assertDiscordAllowlistConfigured(["*"], [], ["guild-1"])).not.toThrow();
    expect(() => assertDiscordAllowlistConfigured(["*"], ["chan-1"], [])).not.toThrow();
  });
});
