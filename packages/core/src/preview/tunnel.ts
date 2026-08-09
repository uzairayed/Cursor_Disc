import type { ChildProcess, SpawnOptions } from "node:child_process";
import { connect } from "node:net";
// cloudflared may be a .cmd shim on Windows; see the note in cursor/runner.ts.
import nodeSpawn from "cross-spawn";
import { killProcessTree } from "../utils/kill-tree.js";

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Query flag that auto-opens the in-app element picker (Tagiser DevPicker). */
export const PREVIEW_PICK_PARAM = "pick";

/** Pull the first Cloudflare quick-tunnel URL from cloudflared output. */
export function extractCloudflareTunnelUrl(text: string): string | null {
  const match = text.match(TUNNEL_URL_RE);
  return match ? match[0]! : null;
}

/** Join a tunnel origin with an optional path. */
export function joinPreviewUrl(origin: string, path?: string | null): string {
  const base = origin.replace(/\/+$/, "");
  const raw = (path ?? "").trim();
  if (!raw || raw === "/") return base;
  const suffix = raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}${suffix}`;
}

/** Append or merge query params onto a preview URL (path may already include ?). */
export function withPreviewQuery(url: string, query: Record<string, string>): string {
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(query)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    const qs = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    return `${url}${sep}${qs}`;
  }
}

/**
 * True when something accepts a TCP connection on 127.0.0.1:port.
 * Uses a raw socket (not HTTP) so closed ports never look "up".
 */
export async function probeLocalPort(
  port: number,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 1000;
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    let settled = false;

    const done = (up: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(up);
    };

    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export type PreviewSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export class PreviewTunnelError extends Error {
  constructor(
    message: string,
    readonly code: "PREVIEW_BIN_MISSING" | "PREVIEW_TUNNEL_TIMEOUT" | "PREVIEW_TUNNEL_EXIT",
  ) {
    super(message);
    this.name = "PreviewTunnelError";
  }
}

export interface TunnelHandle {
  port: number;
  url: string;
  reused: boolean;
}

interface ActiveTunnel {
  port: number;
  url: string;
  child: ChildProcess;
}

export class CloudflareTunnelManager {
  private readonly bin: string;
  private readonly spawn: PreviewSpawnFn;
  private readonly readyTimeoutMs: number;
  private readonly byPort = new Map<number, ActiveTunnel>();

  constructor(
    opts: {
      bin?: string;
      spawn?: PreviewSpawnFn;
      readyTimeoutMs?: number;
    } = {},
  ) {
    this.bin = opts.bin?.trim() || "cloudflared";
    this.spawn = opts.spawn ?? nodeSpawn;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 20_000;
  }

  get(port: number): TunnelHandle | null {
    const active = this.byPort.get(port);
    if (!active) return null;
    return { port: active.port, url: active.url, reused: true };
  }

  async ensureTunnel(port: number): Promise<TunnelHandle> {
    const existing = this.byPort.get(port);
    if (existing) {
      return { port: existing.port, url: existing.url, reused: true };
    }

    let child: ChildProcess;
    try {
      child = this.spawn(this.bin, ["tunnel", "--url", `http://127.0.0.1:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        throw new PreviewTunnelError(
          `${this.bin} is not installed or not on PATH`,
          "PREVIEW_BIN_MISSING",
        );
      }
      throw err;
    }

    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // Handled via the ready promise when spawn emits error before data.
      }
    });

    const url = await this.waitForUrl(child, port);
    const active: ActiveTunnel = { port, url, child };
    this.byPort.set(port, active);

    child.on("exit", () => {
      const current = this.byPort.get(port);
      if (current?.child === child) this.byPort.delete(port);
    });

    return { port, url, reused: false };
  }

  async stopTunnel(port: number): Promise<boolean> {
    const active = this.byPort.get(port);
    if (!active) return false;
    this.byPort.delete(port);
    await killChild(active.child);
    return true;
  }

  async stopAll(): Promise<number> {
    const ports = [...this.byPort.keys()];
    let n = 0;
    for (const port of ports) {
      if (await this.stopTunnel(port)) n += 1;
    }
    return n;
  }

  private waitForUrl(child: ChildProcess, port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = "";
      let settled = false;

      const finish = (err: Error | null, url?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        child.off("error", onError);
        child.off("exit", onExit);
        if (err) {
          void killChild(child);
          reject(err);
          return;
        }
        resolve(url!);
      };

      const onData = (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const url = extractCloudflareTunnelUrl(buffer);
        if (url) finish(null, url);
      };

      const onError = (err: Error) => {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          finish(
            new PreviewTunnelError(
              `${this.bin} is not installed or not on PATH`,
              "PREVIEW_BIN_MISSING",
            ),
          );
          return;
        }
        finish(err);
      };

      const onExit = (code: number | null) => {
        finish(
          new PreviewTunnelError(
            `cloudflared exited before publishing a URL (code ${code ?? "?"}) for port ${port}`,
            "PREVIEW_TUNNEL_EXIT",
          ),
        );
      };

      const timer = setTimeout(() => {
        finish(
          new PreviewTunnelError(
            `Timed out waiting for cloudflared URL on port ${port}`,
            "PREVIEW_TUNNEL_TIMEOUT",
          ),
        );
      }, this.readyTimeoutMs);

      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", onError);
      child.on("exit", onExit);
    });
  }
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode != null) {
      resolve();
      return;
    }
    const done = () => resolve();
    child.once("exit", done);
    killProcessTree(child);
    setTimeout(() => {
      if (child.exitCode == null && !child.killed) killProcessTree(child, { force: true });
      resolve();
    }, 1500).unref?.();
  });
}
