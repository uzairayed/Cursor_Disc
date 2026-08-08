import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ensureProjectChannel,
  ProjectChannelRegistry,
  sanitizeDiscordChannelName,
} from "./project-channels.js";

describe("sanitizeDiscordChannelName", () => {
  it("lowercases and replaces invalid characters", () => {
    expect(sanitizeDiscordChannelName("Tagiser Beta")).toBe("tagiser-beta");
    expect(sanitizeDiscordChannelName("CRM_App!")).toBe("crm-app");
  });

  it("falls back when empty after sanitize", () => {
    expect(sanitizeDiscordChannelName("!!!")).toBe("project");
  });
});

describe("ProjectChannelRegistry", () => {
  it("persists guild/project → channel mappings", () => {
    const dir = mkdtempSync(join(tmpdir(), "cdc-ch-"));
    const file = join(dir, "discord-project-channels.json");
    const reg = new ProjectChannelRegistry(file);
    expect(reg.get("guild-1", "crm")).toBeNull();
    reg.set("guild-1", "crm", "chan-9");
    expect(reg.get("guild-1", "crm")).toBe("chan-9");
    expect(reg.channelIdsForGuild("guild-1")).toEqual(["chan-9"]);
    expect(reg.findProjectByChannelId("guild-1", "chan-9")).toBe("crm");
    expect(reg.findProjectByChannelId("guild-1", "thread", "chan-9")).toBe("crm");

    const reloaded = new ProjectChannelRegistry(file);
    expect(reloaded.get("guild-1", "crm")).toBe("chan-9");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      "guild-1": { crm: "chan-9" },
    });
  });
});

describe("ensureProjectChannel", () => {
  it("returns existing registry mapping without creating", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cdc-ch-"));
    const reg = new ProjectChannelRegistry(join(dir, "map.json"));
    reg.set("g1", "crm", "existing-chan");

    const create = vi.fn();
    const result = await ensureProjectChannel({
      guildId: "g1",
      projectKey: "crm",
      registry: reg,
      findChannelByName: async () => null,
      createChannel: create,
      channelExists: async () => true,
    });

    expect(result).toEqual({
      channelId: "existing-chan",
      created: false,
      name: "crm",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("adopts an existing guild channel with the same name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cdc-ch-"));
    const reg = new ProjectChannelRegistry(join(dir, "map.json"));
    const create = vi.fn();

    const result = await ensureProjectChannel({
      guildId: "g1",
      projectKey: "fleet",
      registry: reg,
      findChannelByName: async (name) =>
        name === "fleet" ? { id: "found-1", name: "fleet" } : null,
      createChannel: create,
      channelExists: async () => true,
    });

    expect(result.created).toBe(false);
    expect(result.channelId).toBe("found-1");
    expect(reg.get("g1", "fleet")).toBe("found-1");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a channel on first selection and records it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cdc-ch-"));
    const reg = new ProjectChannelRegistry(join(dir, "map.json"));

    const result = await ensureProjectChannel({
      guildId: "g1",
      projectKey: "cliproom",
      registry: reg,
      findChannelByName: async () => null,
      createChannel: async (name) => ({ id: "new-42", name }),
      channelExists: async () => true,
    });

    expect(result).toEqual({
      channelId: "new-42",
      created: true,
      name: "cliproom",
    });
    expect(reg.get("g1", "cliproom")).toBe("new-42");
  });

  it("recreates when the registered channel was deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cdc-ch-"));
    const reg = new ProjectChannelRegistry(join(dir, "map.json"));
    reg.set("g1", "crm", "deleted-chan");

    const result = await ensureProjectChannel({
      guildId: "g1",
      projectKey: "crm",
      registry: reg,
      findChannelByName: async () => null,
      createChannel: async (name) => ({ id: "recreated", name }),
      channelExists: async (id) => id !== "deleted-chan",
    });

    expect(result.created).toBe(true);
    expect(result.channelId).toBe("recreated");
    expect(reg.get("g1", "crm")).toBe("recreated");
  });

  it("does not adopt a channel already registered to another project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cdc-ch-"));
    const reg = new ProjectChannelRegistry(join(dir, "map.json"));
    reg.set("g1", "foo_bar", "chan-shared");

    const created = vi.fn(async (name: string) => ({
      id: `new-${name}`,
      name,
    }));

    const result = await ensureProjectChannel({
      guildId: "g1",
      projectKey: "foo-bar",
      registry: reg,
      channelExists: async () => true,
      findChannelByName: async (name) =>
        name === "foo-bar" ? { id: "chan-shared", name: "foo-bar" } : null,
      createChannel: created,
    });

    expect(result.channelId).not.toBe("chan-shared");
    expect(result.created).toBe(true);
    expect(reg.get("g1", "foo_bar")).toBe("chan-shared");
    expect(reg.get("g1", "foo-bar")).toBe(result.channelId);
    expect(reg.findProjectByChannelId("g1", "chan-shared")).toBe("foo_bar");
    expect(created).toHaveBeenCalled();
  });
});
