import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { ensureGuildProjectChannel } from "./ensure-project-channel-discord.js";
import { ProjectChannelRegistry } from "./project-channels.js";

function registry(): ProjectChannelRegistry {
  const dir = mkdtempSync(join(tmpdir(), "cdc-ens-"));
  return new ProjectChannelRegistry(join(dir, "discord-project-channels.json"));
}

describe("ensureGuildProjectChannel", () => {
  it("returns an existing registry mapping when the channel still exists", async () => {
    const reg = registry();
    reg.set("g1", "crm", "chan-crm");

    const guild = {
      id: "g1",
      channels: {
        fetch: vi.fn(async (id?: string) => {
          if (id === "chan-crm") {
            return { id: "chan-crm", name: "crm", type: ChannelType.GuildText };
          }
          return new Map();
        }),
        create: vi.fn(),
      },
    };

    const result = await ensureGuildProjectChannel({
      guild: guild as never,
      projectKey: "crm",
      registry: reg,
    });

    expect(result).toEqual({
      channelId: "chan-crm",
      created: false,
      name: "crm",
    });
    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  it("adopts an existing guild channel with the same name", async () => {
    const reg = registry();
    const channels = new Map([
      [
        "chan-old",
        { id: "chan-old", name: "fleet", type: ChannelType.GuildText },
      ],
    ]);

    const guild = {
      id: "g1",
      channels: {
        fetch: vi.fn(async (id?: string) => {
          if (typeof id === "string") throw new Error("missing");
          return channels;
        }),
        create: vi.fn(),
      },
    };

    const result = await ensureGuildProjectChannel({
      guild: guild as never,
      projectKey: "fleet",
      registry: reg,
    });

    expect(result).toEqual({
      channelId: "chan-old",
      created: false,
      name: "fleet",
    });
    expect(reg.get("g1", "fleet")).toBe("chan-old");
    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  it("creates a text channel when none exists", async () => {
    const reg = registry();
    const guild = {
      id: "g1",
      channels: {
        fetch: vi.fn(async (id?: string) => {
          if (typeof id === "string") throw new Error("gone");
          return new Map();
        }),
        create: vi.fn(async (opts: { name: string; type: ChannelType }) => ({
          id: "chan-new",
          name: opts.name,
          type: opts.type,
        })),
      },
    };

    const result = await ensureGuildProjectChannel({
      guild: guild as never,
      projectKey: "cliproom",
      registry: reg,
    });

    expect(result).toEqual({
      channelId: "chan-new",
      created: true,
      name: "cliproom",
    });
    expect(guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "cliproom",
        type: ChannelType.GuildText,
      })
    );
    expect(reg.get("g1", "cliproom")).toBe("chan-new");
  });

  it("treats a missing registered channel as gone and recreates", async () => {
    const reg = registry();
    reg.set("g1", "crm", "deleted-chan");

    const guild = {
      id: "g1",
      channels: {
        fetch: vi.fn(async (id?: string) => {
          if (typeof id === "string") throw new Error("Unknown Channel");
          return new Map();
        }),
        create: vi.fn(async (opts: { name: string }) => ({
          id: "chan-recreated",
          name: opts.name,
          type: ChannelType.GuildText,
        })),
      },
    };

    const result = await ensureGuildProjectChannel({
      guild: guild as never,
      projectKey: "crm",
      registry: reg,
    });

    expect(result.channelId).toBe("chan-recreated");
    expect(result.created).toBe(true);
    expect(reg.get("g1", "crm")).toBe("chan-recreated");
  });
});
