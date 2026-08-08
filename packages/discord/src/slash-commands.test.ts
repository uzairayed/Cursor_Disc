import { describe, expect, it } from "vitest";
import {
  buildSlashCommandBodies,
  promptFromSlashCommand,
} from "./slash-commands.js";

describe("buildSlashCommandBodies", () => {
  it("registers the core Cursor bridge commands", () => {
    const names = buildSlashCommandBodies().map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "ask",
        "cancel_plan",
        "gmail_auth",
        "gmail_code",
        "go",
        "help",
        "join",
        "leave",
        "new_chat",
        "plan",
        "preview",
        "preview_pick",
        "preview_stop",
        "project",
        "prompt",
        "run",
        "status",
        "stop",
        "stop_all",
        "voice_status",
      ].sort()
    );
  });

  it("registers voice and gmail assistant commands", () => {
    const bodies = buildSlashCommandBodies();
    expect(bodies.find((c) => c.name === "join")?.description).toMatch(/voice/i);
    expect(bodies.find((c) => c.name === "leave")).toBeTruthy();
    expect(bodies.find((c) => c.name === "voice_status")).toBeTruthy();
    const gmailCode = bodies.find((c) => c.name === "gmail_code");
    expect(gmailCode?.options?.[0]).toMatchObject({ name: "code", required: true });
  });

  it("requires text on /prompt and prompt on /ask", () => {
    const prompt = buildSlashCommandBodies().find((c) => c.name === "prompt");
    const ask = buildSlashCommandBodies().find((c) => c.name === "ask");
    expect(prompt?.options?.[0]).toMatchObject({ name: "text", required: true });
    expect(ask?.options?.[0]).toMatchObject({ name: "prompt", required: true });
  });

  it("exposes optional port and path on /preview", () => {
    const preview = buildSlashCommandBodies().find((c) => c.name === "preview");
    expect(preview?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "port", required: false }),
        expect.objectContaining({ name: "path", required: false }),
      ])
    );
  });
});

describe("promptFromSlashCommand", () => {
  it("maps /prompt and /ask to the prompt string", () => {
    expect(
      promptFromSlashCommand({
        commandName: "prompt",
        getString: (name) => (name === "text" ? "fix the login bug" : null),
      })
    ).toBe("fix the login bug");
    expect(
      promptFromSlashCommand({
        commandName: "ask",
        getString: (name) => (name === "prompt" ? "fix the login bug" : null),
      })
    ).toBe("fix the login bug");
  });

  it("maps control commands to conversational phrases the router already understands", () => {
    expect(promptFromSlashCommand({ commandName: "help", getString: () => null })).toBe(
      "help"
    );
    expect(promptFromSlashCommand({ commandName: "status", getString: () => null })).toBe(
      "status"
    );
    expect(promptFromSlashCommand({ commandName: "stop", getString: () => null })).toBe(
      "stop"
    );
    expect(promptFromSlashCommand({ commandName: "stop_all", getString: () => null })).toBe(
      "stop all"
    );
    expect(promptFromSlashCommand({ commandName: "new_chat", getString: () => null })).toBe(
      "new chat"
    );
    expect(promptFromSlashCommand({ commandName: "plan", getString: () => null })).toBe(
      "plan"
    );
    expect(promptFromSlashCommand({ commandName: "go", getString: () => null })).toBe("go");
    expect(promptFromSlashCommand({ commandName: "run", getString: () => null })).toBe(
      "run"
    );
    expect(
      promptFromSlashCommand({ commandName: "cancel_plan", getString: () => null })
    ).toBe("cancel plan");
  });

  it("maps /project with a name to switch, and without to current", () => {
    expect(
      promptFromSlashCommand({
        commandName: "project",
        getString: (name) => (name === "name" ? "motocards" : null),
      })
    ).toBe("switch to motocards");
    expect(
      promptFromSlashCommand({
        commandName: "project",
        getString: () => null,
      })
    ).toBe("current");
  });

  it("returns null for unknown commands and preview (handled separately)", () => {
    expect(
      promptFromSlashCommand({ commandName: "nope", getString: () => null })
    ).toBeNull();
    expect(
      promptFromSlashCommand({ commandName: "preview", getString: () => null })
    ).toBeNull();
    expect(
      promptFromSlashCommand({ commandName: "preview_stop", getString: () => null })
    ).toBeNull();
  });
});
