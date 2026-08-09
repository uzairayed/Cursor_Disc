import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevServerManager } from "./dev-server.js";

class FakeChild extends EventEmitter {
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  });
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function projectWithDevScript(): string {
  const root = mkdtempSync(join(tmpdir(), "preview-dev-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
  return root;
}

describe("DevServerManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not treat an occupied port as this project's server", async () => {
    const cwd = projectWithDevScript();
    const spawn = vi.fn();
    const mgr = new DevServerManager({
      spawn,
      probe: async () => true,
    });
    const result = await mgr.ensure({ cwd, port: 3000 });
    expect(result.ok).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("starts npm run dev and waits until the port is ready", async () => {
    const cwd = projectWithDevScript();
    const child = new FakeChild();
    let ready = false;
    const spawn = vi.fn(() => child as never);
    const mgr = new DevServerManager({
      spawn,
      probe: async () => ready,
      readyTimeoutMs: 2000,
      pollMs: 20,
    });

    const pending = mgr.ensure({ cwd, port: 3000 });
    setTimeout(() => {
      ready = true;
    }, 40);
    const result = await pending;

    expect(result).toEqual({ ok: true, started: true, port: 3000 });
    expect(spawn).toHaveBeenCalledWith(
      "npm",
      ["run", "dev"],
      expect.objectContaining({
        cwd,
        env: expect.objectContaining({ PORT: "3000" }),
      }),
    );
  });

  it("fails when package.json has no dev script", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "preview-nodev-"));
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: {} }));
    const mgr = new DevServerManager({
      spawn: () => {
        throw new Error("should not spawn");
      },
      probe: async () => false,
    });
    const result = await mgr.ensure({ cwd, port: 3000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_DEV_SCRIPT");
  });

  it("fails when the port never becomes ready", async () => {
    const cwd = projectWithDevScript();
    const child = new FakeChild();
    const mgr = new DevServerManager({
      spawn: () => child as never,
      probe: async () => false,
      readyTimeoutMs: 60,
      pollMs: 15,
    });
    const result = await mgr.ensure({ cwd, port: 3000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("READY_TIMEOUT");
    expect(child.kill).toHaveBeenCalled();
  });

  it("fails when cwd is missing", async () => {
    const mgr = new DevServerManager({
      probe: async () => false,
      spawn: () => {
        throw new Error("no");
      },
    });
    const result = await mgr.ensure({
      cwd: join(tmpdir(), `does-not-exist-${Date.now()}`),
      port: 3000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_PROJECT_DIR");
  });

  it("stop only kills servers this manager started", async () => {
    const cwd = projectWithDevScript();
    mkdirSync(cwd, { recursive: true });
    const child = new FakeChild();
    let ready = false;
    const mgr = new DevServerManager({
      spawn: () => child as never,
      probe: async () => ready,
      readyTimeoutMs: 1000,
      pollMs: 10,
    });
    const pending = mgr.ensure({ cwd, port: 3000 });
    setTimeout(() => {
      ready = true;
    }, 20);
    await pending;
    expect(await mgr.stop(3000)).toBe(true);
    expect(child.kill).toHaveBeenCalled();
    expect(await mgr.stop(3000)).toBe(false);
  });
});
