import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDiscordConfig } from "./config.js";

const prev = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in prev)) delete process.env[key];
  }
  Object.assign(process.env, prev);
});

describe("loadDiscordConfig", () => {
  it("fails closed without a bot token", () => {
    const root = mkdtempSync(join(tmpdir(), "cdc-cfg-"));
    writeFileSync(join(root, ".env"), "DISCORD_ALLOWED_USER_IDS=111\n");
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_ALLOWED_USER_IDS;
    expect(() => loadDiscordConfig(root)).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("fails closed without user allowlist", () => {
    const root = mkdtempSync(join(tmpdir(), "cdc-cfg-"));
    writeFileSync(
      join(root, ".env"),
      "DISCORD_BOT_TOKEN=secret-token\nDISCORD_ALLOWED_USER_IDS=\n",
    );
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_ALLOWED_USER_IDS;
    expect(() => loadDiscordConfig(root)).toThrow(/DISCORD_ALLOWED_USER_IDS/);
  });

  it("fails closed when * has no guild or channel list", () => {
    const root = mkdtempSync(join(tmpdir(), "cdc-cfg-"));
    writeFileSync(
      join(root, ".env"),
      "DISCORD_BOT_TOKEN=secret-token\nDISCORD_ALLOWED_USER_IDS=*\n",
    );
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_ALLOWED_USER_IDS;
    delete process.env.DISCORD_ALLOWED_GUILD_IDS;
    delete process.env.DISCORD_ALLOWED_CHANNEL_IDS;
    expect(() => loadDiscordConfig(root)).toThrow(/DISCORD_ALLOWED_USER_IDS=\*/);
  });

  it("loads public * with a guild allowlist", () => {
    const root = mkdtempSync(join(tmpdir(), "cdc-cfg-"));
    writeFileSync(
      join(root, ".env"),
      [
        "DISCORD_BOT_TOKEN=secret-token",
        "DISCORD_ALLOWED_USER_IDS=*",
        "DISCORD_ALLOWED_GUILD_IDS=444",
      ].join("\n"),
    );
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_ALLOWED_USER_IDS;
    delete process.env.DISCORD_ALLOWED_GUILD_IDS;
    const cfg = loadDiscordConfig(root);
    expect(cfg.discordAllowedUserIds).toEqual(["*"]);
    expect(cfg.discordAllowedGuildIds).toEqual(["444"]);
  });

  it("loads token and allowlists from env file", () => {
    const root = mkdtempSync(join(tmpdir(), "cdc-cfg-"));
    writeFileSync(
      join(root, ".env"),
      [
        "DISCORD_BOT_TOKEN=secret-token",
        "DISCORD_ALLOWED_USER_IDS=111,222",
        "DISCORD_ALLOWED_CHANNEL_IDS=333",
        "DISCORD_ALLOWED_GUILD_IDS=444",
        "APP_NAME=CursorDiscord",
      ].join("\n"),
    );
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_ALLOWED_USER_IDS;
    delete process.env.DISCORD_ALLOWED_CHANNEL_IDS;
    delete process.env.DISCORD_ALLOWED_GUILD_IDS;
    delete process.env.APP_NAME;

    const cfg = loadDiscordConfig(root);
    expect(cfg.discordBotToken).toBe("secret-token");
    expect(cfg.discordAllowedUserIds).toEqual(["111", "222"]);
    expect(cfg.discordAllowedChannelIds).toEqual(["333"]);
    expect(cfg.discordAllowedGuildIds).toEqual(["444"]);
    expect(cfg.appName).toBe("CursorDiscord");
    expect(cfg.bridgeLeaseChannelId).toBeNull();
    expect(cfg.bridgeForce).toBe(false);
    expect(cfg.bridgeLeaseStaleMs).toBe(90_000);
    expect(cfg.bridgeHost.length).toBeGreaterThan(0);
  });

  it("reads bridge lease env overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "cdc-cfg-"));
    writeFileSync(
      join(root, ".env"),
      [
        "DISCORD_BOT_TOKEN=secret-token",
        "DISCORD_ALLOWED_USER_IDS=111",
        "BRIDGE_LEASE_CHANNEL_ID=999",
        "BRIDGE_HOST=studio-pc",
        "BRIDGE_LEASE_STALE_MS=120000",
        "BRIDGE_FORCE=1",
      ].join("\n"),
    );
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_ALLOWED_USER_IDS;
    delete process.env.BRIDGE_LEASE_CHANNEL_ID;
    delete process.env.BRIDGE_HOST;
    delete process.env.BRIDGE_LEASE_STALE_MS;
    delete process.env.BRIDGE_FORCE;

    const cfg = loadDiscordConfig(root);
    expect(cfg.bridgeLeaseChannelId).toBe("999");
    expect(cfg.bridgeHost).toBe("studio-pc");
    expect(cfg.bridgeLeaseStaleMs).toBe(120_000);
    expect(cfg.bridgeForce).toBe(true);
  });
});
