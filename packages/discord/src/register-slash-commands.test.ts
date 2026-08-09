import { describe, expect, it, vi } from "vitest";
import { registerSlashCommands } from "./register-slash-commands.js";
import { buildSlashCommandBodies } from "./slash-commands.js";

describe("registerSlashCommands", () => {
  it("registers commands on each allowlisted guild", async () => {
    const body = buildSlashCommandBodies();
    const setGuild = vi.fn(async () => undefined);
    const client = {
      application: { commands: { set: vi.fn() } },
      guilds: {
        fetch: vi.fn(async (id: string) => ({
          id,
          name: `Guild ${id}`,
          commands: { set: setGuild },
        })),
      },
    };

    await registerSlashCommands(client as never, ["g1", "g2"]);

    expect(client.guilds.fetch).toHaveBeenCalledTimes(2);
    expect(setGuild).toHaveBeenCalledTimes(2);
    expect(setGuild).toHaveBeenCalledWith(body);
    expect(client.application.commands.set).not.toHaveBeenCalled();
  });

  it("registers globally when no guild IDs are provided", async () => {
    const body = buildSlashCommandBodies();
    const setGlobal = vi.fn(async () => undefined);
    const client = {
      application: { commands: { set: setGlobal } },
      guilds: { fetch: vi.fn() },
    };

    await registerSlashCommands(client as never, []);

    expect(setGlobal).toHaveBeenCalledOnce();
    expect(setGlobal).toHaveBeenCalledWith(body);
    expect(client.guilds.fetch).not.toHaveBeenCalled();
  });

  it("throws when the client has no application", async () => {
    const client = { application: null, guilds: { fetch: vi.fn() } };
    await expect(registerSlashCommands(client as never, [])).rejects.toThrow(
      /client\.application is missing/,
    );
  });
});
