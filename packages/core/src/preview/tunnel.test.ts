import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareTunnelManager } from "./tunnel.js";

class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  });
}

describe("CloudflareTunnelManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spawns cloudflared and resolves with the public URL", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as never);
    const mgr = new CloudflareTunnelManager({
      bin: "cloudflared",
      spawn,
      readyTimeoutMs: 2000,
    });

    const pending = mgr.ensureTunnel(3000);
    child.stderr.emit("data", Buffer.from("https://lucky-moon-1234.trycloudflare.com\n"));
    const result = await pending;

    expect(spawn).toHaveBeenCalledWith(
      "cloudflared",
      ["tunnel", "--url", "http://127.0.0.1:3000"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
    expect(result).toEqual({
      port: 3000,
      url: "https://lucky-moon-1234.trycloudflare.com",
      reused: false,
    });

    const again = await mgr.ensureTunnel(3000);
    expect(again.reused).toBe(true);
    expect(again.url).toBe(result.url);
    expect(spawn).toHaveBeenCalledTimes(1);

    await mgr.stopTunnel(3000);
    expect(child.kill).toHaveBeenCalled();
  });

  it("surfaces ENOENT as a missing-binary error", async () => {
    const spawn = vi.fn(() => {
      const err = Object.assign(new Error("spawn cloudflared ENOENT"), {
        code: "ENOENT",
      });
      throw err;
    });
    const mgr = new CloudflareTunnelManager({ bin: "cloudflared", spawn });
    await expect(mgr.ensureTunnel(3000)).rejects.toMatchObject({
      code: "PREVIEW_BIN_MISSING",
    });
  });

  it("times out when cloudflared never prints a URL", async () => {
    const child = new FakeChild();
    const mgr = new CloudflareTunnelManager({
      bin: "cloudflared",
      spawn: () => child as never,
      readyTimeoutMs: 30,
    });
    await expect(mgr.ensureTunnel(3000)).rejects.toMatchObject({
      code: "PREVIEW_TUNNEL_TIMEOUT",
    });
  });
});
