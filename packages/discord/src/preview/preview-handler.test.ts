import { describe, expect, it, vi } from "vitest";
import type { DiscordConfig } from "../config.js";
import {
  createPreviewService,
  parsePreviewTextCommand,
  runPreviewSlashCommand,
} from "./preview-handler.js";

describe("parsePreviewTextCommand", () => {
  it("parses start / stop phrases", () => {
    expect(parsePreviewTextCommand("preview")).toEqual({
      action: "start",
      pick: false,
    });
    expect(parsePreviewTextCommand("preview 5173")).toEqual({
      action: "start",
      pick: false,
      port: 5173,
    });
    expect(parsePreviewTextCommand("preview 3000 /playground")).toEqual({
      action: "start",
      pick: false,
      port: 3000,
      path: "/playground",
    });
    expect(parsePreviewTextCommand("preview_stop")).toEqual({ action: "stop" });
    expect(parsePreviewTextCommand("preview stop")).toEqual({ action: "stop" });
  });

  it("parses preview_pick with optional port/path", () => {
    expect(parsePreviewTextCommand("preview_pick")).toEqual({
      action: "start",
      pick: true,
    });
    expect(parsePreviewTextCommand("preview pick")).toEqual({
      action: "start",
      pick: true,
    });
    expect(parsePreviewTextCommand("preview_pick 3000 /playground")).toEqual({
      action: "start",
      pick: true,
      port: 3000,
      path: "/playground",
    });
  });

  it("returns null for unrelated text", () => {
    expect(parsePreviewTextCommand("fix the preview button")).toBeNull();
  });
});

describe("createPreviewService", () => {
  it("wires Discord config into PreviewService", () => {
    const config = {
      projectsFile: "/tmp/projects.json",
      previewDefaultPort: 5173,
      previewCloudflaredBin: "/opt/cloudflared",
      previewPortsEnv: "cliproom:3000",
    } as DiscordConfig;

    const preview = createPreviewService(config);
    expect(preview).toBeTruthy();
    expect(typeof preview.start).toBe("function");
    expect(typeof preview.stop).toBe("function");
  });
});

describe("runPreviewSlashCommand", () => {
  function mockInteraction(opts: {
    commandName: string;
    port?: number | null;
    path?: string | null;
  }) {
    return {
      commandName: opts.commandName,
      options: {
        getInteger: vi.fn((name: string) => (name === "port" ? (opts.port ?? null) : null)),
        getString: vi.fn((name: string) => (name === "path" ? (opts.path ?? null) : null)),
      },
    };
  }

  it("starts a normal preview with optional port/path", async () => {
    const preview = {
      start: vi.fn(async () => ({
        ok: true,
        message: "Preview ready",
      })),
      stop: vi.fn(),
    };

    const result = await runPreviewSlashCommand({
      interaction: mockInteraction({
        commandName: "preview",
        port: 5173,
        path: "/playground",
      }) as never,
      projectKey: "cliproom",
      projectPath: "/tmp/cliproom",
      preview: preview as never,
    });

    expect(result.message).toBe("Preview ready");
    expect(preview.start).toHaveBeenCalledWith({
      projectKey: "cliproom",
      projectPath: "/tmp/cliproom",
      port: 5173,
      path: "/playground",
      pick: false,
    });
  });

  it("enables pick mode for /preview_pick", async () => {
    const preview = {
      start: vi.fn(async () => ({ ok: true, message: "pick" })),
      stop: vi.fn(),
    };

    await runPreviewSlashCommand({
      interaction: mockInteraction({ commandName: "preview_pick" }) as never,
      projectKey: "fleet",
      projectPath: "/tmp/fleet",
      preview: preview as never,
    });

    expect(preview.start).toHaveBeenCalledWith(
      expect.objectContaining({ pick: true, projectKey: "fleet" }),
    );
  });

  it("stops the tunnel for /preview_stop", async () => {
    const preview = {
      start: vi.fn(),
      stop: vi.fn(async () => ({ ok: true, message: "Stopped" })),
    };

    const result = await runPreviewSlashCommand({
      interaction: mockInteraction({ commandName: "preview_stop" }) as never,
      projectKey: "cliproom",
      projectPath: "/tmp/cliproom",
      preview: preview as never,
    });

    expect(result.message).toBe("Stopped");
    expect(preview.stop).toHaveBeenCalledWith("cliproom");
    expect(preview.start).not.toHaveBeenCalled();
  });
});
