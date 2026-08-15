import { describe, expect, it } from "vitest";
import {
  effectiveAllowedChannelIds,
  isDiscordAuthorized,
  isDiscordChannelAllowed,
  isDiscordIdentityAllowed,
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
