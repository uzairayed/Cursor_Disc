import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  ensureGuildProjectChannel,
  foreignDeviceFromCategory,
  sanitizeDiscordCategoryName,
} from "./ensure-project-channel-discord.js";
import { ProjectChannelRegistry } from "./project-channels.js";

function registry(): ProjectChannelRegistry {
  const dir = mkdtempSync(join(tmpdir(), "cdc-ens-"));
  return new ProjectChannelRegistry(join(dir, "discord-project-channels.json"));
}

describe("sanitizeDiscordCategoryName", () => {
  it("matches channel-name rules", () => {
    expect(sanitizeDiscordCategoryName("windows-pc")).toBe("windows-pc");
    expect(sanitizeDiscordCategoryName("Mac Book")).toBe("mac-book");
  });
});

describe("foreignDeviceFromCategory", () => {
  const devices = ["windows-pc", "macbook"];

  it("returns the other device when the category matches", () => {
    expect(foreignDeviceFromCategory("macbook", devices, "windows-pc")).toBe("macbook");
  });

  it("ignores this machine's own category and unknown names", () => {
    expect(foreignDeviceFromCategory("windows-pc", devices, "windows-pc")).toBeNull();
    expect(foreignDeviceFromCategory("random", devices, "windows-pc")).toBeNull();
    expect(foreignDeviceFromCategory(null, devices, "windows-pc")).toBeNull();
  });
});

describe("ensureGuildProjectChannel", () => {
  it("returns an existing registry mapping when the channel still exists", async () => {
    const reg = registry();
    reg.set("g1", "crm", "chan-crm");

    const guild = {
      id: "g1",
      channels: {
        fetch: vi.fn(async (id?: string) => {
          if (id === "chan-crm") {
            return {
              id: "chan-crm",
              name: "crm",
              type: ChannelType.GuildText,
              parentId: null,
            };
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
      ["chan-old", { id: "chan-old", name: "fleet", type: ChannelType.GuildText, parentId: null }],
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
          parentId: null,
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
      }),
    );
    expect(reg.get("g1", "cliproom")).toBe("chan-new");
  });

  it("creates under a device category named after BRIDGE_HOST", async () => {
    const reg = registry();
    const created: Array<Record<string, unknown>> = [];
    const guild = {
      id: "g1",
      channels: {
        fetch: vi.fn(async (id?: string) => {
          if (typeof id === "string") {
            if (id === "cat-win") {
              return { id: "cat-win", name: "windows-pc", type: ChannelType.GuildCategory };
            }
            if (id === "chan-moto") {
              return {
                id: "chan-moto",
                name: "motocards",
                type: ChannelType.GuildText,
                parentId: "cat-win",
                setParent: vi.fn(),
              };
            }
            throw new Error("gone");
          }
          return new Map();
        }),
        create: vi.fn(async (opts: Record<string, unknown>) => {
          created.push(opts);
          if (opts.type === ChannelType.GuildCategory) {
            return { id: "cat-win", name: opts.name, type: ChannelType.GuildCategory };
          }
          return {
            id: "chan-moto",
            name: opts.name,
            type: ChannelType.GuildText,
            parentId: opts.parent,
            setParent: vi.fn(),
          };
        }),
      },
    };

    const result = await ensureGuildProjectChannel({
      guild: guild as never,
      projectKey: "motocards",
      registry: reg,
      categoryName: "windows-pc",
    });

    expect(result.channelId).toBe("chan-moto");
    expect(created[0]).toEqual(
      expect.objectContaining({
        name: "windows-pc",
        type: ChannelType.GuildCategory,
      }),
    );
    expect(created[1]).toEqual(
      expect.objectContaining({
        name: "motocards",
        type: ChannelType.GuildText,
        parent: "cat-win",
      }),
    );
  });

  it("does not adopt a channel that already lives under another device category", async () => {
    const reg = registry();
    const channels = new Map([
      [
        "chan-mac",
        {
          id: "chan-mac",
          name: "motocards",
          type: ChannelType.GuildText,
          parentId: "cat-mac",
        },
      ],
      ["cat-mac", { id: "cat-mac", name: "macbook", type: ChannelType.GuildCategory }],
      ["cat-win", { id: "cat-win", name: "windows-pc", type: ChannelType.GuildCategory }],
    ]);

    const guild = {
      id: "g1",
      channels: {
        fetch: vi.fn(async (id?: string) => {
          if (typeof id === "string") {
            return channels.get(id) ?? null;
          }
          return channels;
        }),
        create: vi.fn(async (opts: { name: string; type: ChannelType; parent?: string }) => ({
          id: opts.type === ChannelType.GuildCategory ? "cat-new" : "chan-win-moto",
          name: opts.name,
          type: opts.type,
          parentId: opts.parent ?? null,
          setParent: vi.fn(),
        })),
      },
    };

    const result = await ensureGuildProjectChannel({
      guild: guild as never,
      projectKey: "motocards",
      registry: reg,
      categoryName: "windows-pc",
    });

    expect(result.channelId).toBe("chan-win-moto");
    expect(result.created).toBe(true);
    expect(guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "motocards",
        parent: "cat-win",
      }),
    );
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
          parentId: null,
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
