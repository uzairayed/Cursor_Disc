import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { probeLocalPort } from "./tunnel.js";

export type DevServerSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export type DevServerEnsureResult =
  | { ok: true; started: boolean; port: number }
  | {
      ok: false;
      reason:
        | "NO_PROJECT_DIR"
        | "NO_PACKAGE_JSON"
        | "NO_DEV_SCRIPT"
        | "SPAWN_FAILED"
        | "READY_TIMEOUT"
        | "EXITED_EARLY";
      detail?: string;
      port: number;
    };

interface ManagedServer {
  port: number;
  cwd: string;
  child: ChildProcess;
}

export class DevServerManager {
  private readonly spawn: DevServerSpawnFn;
  private readonly probe: (port: number) => Promise<boolean>;
  private readonly readyTimeoutMs: number;
  private readonly pollMs: number;
  private readonly byPort = new Map<number, ManagedServer>();

  constructor(
    opts: {
      spawn?: DevServerSpawnFn;
      probe?: (port: number) => Promise<boolean>;
      readyTimeoutMs?: number;
      pollMs?: number;
    } = {}
  ) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.probe = opts.probe ?? ((port) => probeLocalPort(port));
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 90_000;
    this.pollMs = opts.pollMs ?? 500;
  }

  /** True when this manager spawned the process currently tracked for `port`. */
  owns(port: number): boolean {
    return this.byPort.has(port);
  }

  async ensure(opts: { cwd: string; port: number }): Promise<DevServerEnsureResult> {
    const { cwd, port } = opts;

    // Caller (PreviewService) must only invoke this for a free port, or a port
    // already verified as this project. Never treat "something is listening"
    // as success — that was cross-project preview contamination.
    if (await this.probe(port)) {
      const managed = this.byPort.get(port);
      if (managed && resolvePath(managed.cwd) === resolvePath(cwd)) {
        return { ok: true, started: false, port };
      }
      return {
        ok: false,
        reason: "SPAWN_FAILED",
        port,
        detail: `Port ${port} is already in use`,
      };
    }

    if (!existsSync(cwd)) {
      return { ok: false, reason: "NO_PROJECT_DIR", port };
    }

    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) {
      return { ok: false, reason: "NO_PACKAGE_JSON", port };
    }

    let hasDev = false;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      hasDev = Boolean(pkg.scripts?.dev?.trim());
    } catch {
      return { ok: false, reason: "NO_PACKAGE_JSON", port };
    }
    if (!hasDev) {
      return { ok: false, reason: "NO_DEV_SCRIPT", port };
    }

    let child: ChildProcess;
    try {
      child = this.spawn("npm", ["run", "dev"], {
        cwd,
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          HOSTNAME: "127.0.0.1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      return {
        ok: false,
        reason: "SPAWN_FAILED",
        port,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    const managed: ManagedServer = { port, cwd, child };
    this.byPort.set(port, managed);

    child.on("exit", () => {
      const current = this.byPort.get(port);
      if (current?.child === child) this.byPort.delete(port);
    });

    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode != null) {
        this.byPort.delete(port);
        return {
          ok: false,
          reason: "EXITED_EARLY",
          port,
          detail: `npm run dev exited with code ${child.exitCode}`,
        };
      }
      if (await this.probe(port)) {
        return { ok: true, started: true, port };
      }
      await sleep(this.pollMs);
    }

    await killChild(child);
    this.byPort.delete(port);
    return { ok: false, reason: "READY_TIMEOUT", port };
  }

  async stop(port: number): Promise<boolean> {
    const managed = this.byPort.get(port);
    if (!managed) return false;
    this.byPort.delete(port);
    await killChild(managed.child);
    return true;
  }

  async stopAll(): Promise<number> {
    const ports = [...this.byPort.keys()];
    let n = 0;
    for (const port of ports) {
      if (await this.stop(port)) n += 1;
    }
    return n;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode != null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode == null && !child.killed) child.kill("SIGKILL");
      resolve();
    }, 2000).unref?.();
  });
}
