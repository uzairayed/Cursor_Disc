import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectChannelRegistry } from "./project-channels.js";
import {
  buildProjectLockedMessage,
  buildProjectRedirectMessage,
  resolveWorkspaceContext,
} from "./workspace-context.js";

function registry(): ProjectChannelRegistry {
  const dir = mkdtempSync(join(tmpdir(), "cdc-ws-"));
  return new ProjectChannelRegistry(join(dir, "map.json"));
}

describe("resolveWorkspaceContext", () => {
  it("treats DMs as general", () => {
    const ctx = resolveWorkspaceContext({
      isDm: true,
      guildId: null,
      channelId: "dm-1",
      projectChannels: registry(),
    });
    expect(ctx).toEqual({ mode: "general", projectKey: "general", locked: false });
  });

  it("locks registered project channels and their threads", () => {
    const reg = registry();
    reg.set("g1", "crm", "chan-crm");
    expect(
      resolveWorkspaceContext({
        isDm: false,
        guildId: "g1",
        channelId: "chan-crm",
        projectChannels: reg,
      }),
    ).toEqual({ mode: "project", projectKey: "crm", locked: true });

    expect(
      resolveWorkspaceContext({
        isDm: false,
        guildId: "g1",
        channelId: "thread-1",
        parentChannelId: "chan-crm",
        projectChannels: reg,
      }).projectKey,
    ).toBe("crm");
  });

  it("treats #general and unknown guild channels as general", () => {
    const reg = registry();
    reg.set("g1", "general", "chan-general");
    expect(
      resolveWorkspaceContext({
        isDm: false,
        guildId: "g1",
        channelId: "chan-general",
        projectChannels: reg,
      }).mode,
    ).toBe("general");
    expect(
      resolveWorkspaceContext({
        isDm: false,
        guildId: "g1",
        channelId: "lobby",
        projectChannels: reg,
      }).mode,
    ).toBe("general");
  });
});

describe("UX copy", () => {
  it("builds redirect and lock messages", () => {
    expect(
      buildProjectRedirectMessage({
        projectKey: "crm",
        channelId: "111",
        created: true,
      }),
    ).toMatch(/<#111>/);
    expect(
      buildProjectLockedMessage({
        channelProjectKey: "crm",
        requestedKey: "fleet",
        requestedChannelId: "222",
      }),
    ).toMatch(/<#222>/);
  });
});
