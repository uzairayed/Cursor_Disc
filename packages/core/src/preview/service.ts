import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DevServerManager } from "./dev-server.js";
import { portBelongsToProject } from "./port-owner.js";
import {
  CloudflareTunnelManager,
  joinPreviewUrl,
  PREVIEW_PICK_PARAM,
  PreviewTunnelError,
  probeLocalPort,
  withPreviewQuery,
} from "./tunnel.js";

export type PreviewPortsMap = Record<string, number>;

/** Parse `tagiser:3000,motocards:3001` style env values. */
export function parsePreviewPortsEnv(raw: string | null | undefined): PreviewPortsMap {
  if (!raw?.trim()) return {};
  const out: PreviewPortsMap = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.lastIndexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const port = Number.parseInt(trimmed.slice(colon + 1).trim(), 10);
    if (!key || !Number.isFinite(port) || port < 1 || port > 65535) continue;
    out[key] = port;
  }
  return out;
}

function coercePreviewPorts(ports: unknown): PreviewPortsMap {
  if (!ports || typeof ports !== "object") return {};
  const out: PreviewPortsMap = {};
  for (const [key, value] of Object.entries(ports as Record<string, unknown>)) {
    const port =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseInt(value, 10)
          : NaN;
    if (!Number.isFinite(port) || port < 1 || port > 65535) continue;
    const normalized = key.trim().toLowerCase();
    if (normalized) out[normalized] = port;
  }
  return out;
}

/** Read optional `previewPorts` from projects.json (flat or active devices.* section). */
export function loadPreviewPorts(
  raw: unknown,
  opts: { host?: string | null } = {},
): PreviewPortsMap {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const devices = obj.devices;
  if (devices && typeof devices === "object") {
    const host = (opts.host ?? "").trim().toLowerCase();
    for (const [name, section] of Object.entries(devices as Record<string, unknown>)) {
      if (name.toLowerCase() !== host || !section || typeof section !== "object") continue;
      return coercePreviewPorts((section as { previewPorts?: unknown }).previewPorts);
    }
    return {};
  }

  const hasScanShape =
    Array.isArray(obj.dirs) ||
    Array.isArray(obj.exclude) ||
    obj.aliases != null ||
    obj.previewPorts != null;
  if (!hasScanShape) return {};
  return coercePreviewPorts(obj.previewPorts);
}

export function resolvePreviewPort(opts: {
  explicit?: number | null;
  projectKey: string;
  previewPorts: PreviewPortsMap;
  defaultPort: number;
}): number {
  if (
    typeof opts.explicit === "number" &&
    Number.isFinite(opts.explicit) &&
    opts.explicit >= 1 &&
    opts.explicit <= 65535
  ) {
    return Math.trunc(opts.explicit);
  }
  const fromMap = opts.previewPorts[opts.projectKey.toLowerCase()];
  if (typeof fromMap === "number") return fromMap;
  return opts.defaultPort;
}

export function formatPreviewReady(opts: {
  projectKey: string;
  port: number;
  url: string;
  reused: boolean;
  startedDevServer?: boolean;
  pick?: boolean;
}): string {
  const name = opts.projectKey.toUpperCase();
  const headline = opts.reused
    ? `Preview tunnel already running for **${name}** (localhost:${opts.port}).`
    : `Preview tunnel ready for **${name}** (localhost:${opts.port}).`;
  const pickLines = opts.pick
    ? [
        "**Element picker is on** — tap the element you mean, hit Copy, then paste into Discord.",
        "Sky-blue floating dot (bottom-right) toggles the picker if it isn't open.",
      ]
    : [
        "Open that link on your phone or in Cursor's browser — no deploy needed.",
        "Want to point at a UI element? Use `/preview_pick` instead.",
      ];
  const lines = [
    headline,
    opts.startedDevServer ? `Started \`npm run dev\` for you on port ${opts.port}.` : null,
    opts.pick ? "Opened with the AI element picker (`?pick=1`)." : null,
    "",
    opts.url,
    "",
    ...pickLines,
    "Heads up: **anyone with this link** can reach your local server while the tunnel is up.",
    "Say `/preview_stop` when you're done (stops the tunnel; also stops a dev server we started).",
  ];
  return lines.filter((line) => line != null).join("\n");
}

export function formatPreviewPortDown(opts: { projectKey: string; port: number }): string {
  return [
    `Nothing is listening on **localhost:${opts.port}** for **${opts.projectKey.toUpperCase()}**, and I couldn't start \`npm run dev\`.`,
    "",
    "Check the project has a `dev` script, or pass a port: `/preview port:5173`",
  ].join("\n");
}

export function formatPreviewDevServerFailed(opts: {
  projectKey: string;
  port: number;
  reason: string;
  detail?: string;
}): string {
  const name = opts.projectKey.toUpperCase();
  const hints: Record<string, string> = {
    NO_PROJECT_DIR: `Project folder for **${name}** wasn't found on this machine.`,
    NO_PACKAGE_JSON: `**${name}** has no package.json — can't run \`npm run dev\`.`,
    NO_DEV_SCRIPT: `**${name}** has no \`dev\` script in package.json.`,
    SPAWN_FAILED: `Couldn't spawn \`npm run dev\` for **${name}**.`,
    READY_TIMEOUT: `Started \`npm run dev\` for **${name}**, but localhost:${opts.port} never came up.`,
    EXITED_EARLY: `\`npm run dev\` for **${name}** exited before the server was ready.`,
    PORT_BUSY_OTHER: `Port **${opts.port}** is already serving a different project — not **${name}**.`,
    NO_FREE_PORT: `Couldn't find a free local port for **${name}** near ${opts.port}.`,
  };
  const head =
    hints[opts.reason] ??
    `Couldn't get a local server running for **${name}** on port ${opts.port}.`;
  return [
    head,
    opts.detail ? `\n${opts.detail}` : null,
    "",
    "Fix the app locally, then `/preview` again.",
  ]
    .filter((line) => line != null)
    .join("\n");
}

export function formatPreviewBinaryMissing(bin: string): string {
  return [
    `Can't start a preview tunnel — \`${bin}\` isn't installed (or not on PATH).`,
    "",
    "Install it with your OS package manager:",
    "```",
    "Windows: winget install cloudflare.cloudflared",
    "macOS:   brew install cloudflared",
    "```",
    "Then run `/preview` again.",
  ].join("\n");
}

export function formatPreviewStopped(opts: { projectKey: string; port: number }): string {
  return `Closed the preview tunnel for **${opts.projectKey.toUpperCase()}** (was localhost:${opts.port}).`;
}

export function formatPreviewNotRunning(projectKey: string): string {
  return `No preview tunnel is running for **${projectKey.toUpperCase()}**.`;
}

export function formatPreviewError(message: string): string {
  return `Couldn't start the preview tunnel: ${message}`;
}

const PORT_SEARCH_SPAN = 20;

export interface PreviewServiceOptions {
  projectsFile: string;
  defaultPort?: number;
  cloudflaredBin?: string;
  portsEnv?: string | null;
  /** Selects devices.<host>.previewPorts when projects.json uses devices. */
  bridgeHost?: string | null;
  tunnelManager?: CloudflareTunnelManager;
  devServers?: DevServerManager;
  probe?: (port: number) => Promise<boolean>;
  /** Injected for tests — does this listening port belong to projectPath? */
  belongsToProject?: (port: number, projectPath: string) => Promise<boolean>;
}

export interface PreviewStartInput {
  projectKey: string;
  /** Absolute path to the project workspace (needed to auto-start npm run dev). */
  projectPath?: string | null;
  port?: number | null;
  path?: string | null;
  /** When true, append ?pick=1 so the in-app element picker auto-opens. */
  pick?: boolean;
}

export interface PreviewCommandResult {
  ok: boolean;
  message: string;
  url?: string;
  port?: number;
}

/**
 * Starts / stops Cloudflare quick tunnels for local project previews.
 * Only reuses a listening port when it belongs to this project's directory.
 */
export class PreviewService {
  private readonly defaultPort: number;
  private readonly bin: string;
  private readonly portsEnv: PreviewPortsMap;
  private readonly tunnels: CloudflareTunnelManager;
  private readonly devServers: DevServerManager;
  private readonly probe: (port: number) => Promise<boolean>;
  private readonly belongsToProject: (port: number, projectPath: string) => Promise<boolean>;
  private readonly projectPort = new Map<string, number>();

  constructor(private readonly opts: PreviewServiceOptions) {
    this.defaultPort = opts.defaultPort ?? 3000;
    this.bin = opts.cloudflaredBin?.trim() || "cloudflared";
    this.portsEnv = parsePreviewPortsEnv(opts.portsEnv);
    this.probe = opts.probe ?? ((port) => probeLocalPort(port));
    this.belongsToProject =
      opts.belongsToProject ?? ((port, projectPath) => portBelongsToProject(port, projectPath));
    this.devServers =
      opts.devServers ??
      new DevServerManager({
        probe: this.probe,
      });
    this.tunnels = opts.tunnelManager ?? new CloudflareTunnelManager({ bin: this.bin });
  }

  private portsFromFile(): PreviewPortsMap {
    try {
      if (!existsSync(this.opts.projectsFile)) return {};
      const raw = JSON.parse(readFileSync(this.opts.projectsFile, "utf8")) as unknown;
      return loadPreviewPorts(raw, { host: this.opts.bridgeHost });
    } catch {
      return {};
    }
  }

  private mergedPorts(): PreviewPortsMap {
    return { ...this.portsFromFile(), ...this.portsEnv };
  }

  private async isOurs(port: number, projectPath: string | null): Promise<boolean> {
    if (this.devServers.owns(port)) return true;
    if (!projectPath) return false;
    return this.belongsToProject(port, resolve(projectPath));
  }

  /**
   * Pick a port that either already serves this project, or is free to start on.
   * Never reuses another project's listener.
   */
  private async resolveLocalServer(opts: {
    projectKey: string;
    projectPath: string | null;
    preferred: number;
    portLocked: boolean;
  }): Promise<
    | { ok: true; port: number; startedDevServer: boolean }
    | { ok: false; port: number; message: string }
  > {
    const { projectKey, projectPath, preferred, portLocked } = opts;

    const existing = this.projectPort.get(projectKey);
    if (existing != null && (await this.probe(existing))) {
      if (await this.isOurs(existing, projectPath)) {
        return { ok: true, port: existing, startedDevServer: false };
      }
    }

    const candidates: number[] = [];
    if (portLocked) {
      candidates.push(preferred);
    } else {
      for (let i = 0; i <= PORT_SEARCH_SPAN; i += 1) {
        candidates.push(preferred + i);
      }
    }

    for (const port of candidates) {
      const up = await this.probe(port);
      if (up) {
        if (await this.isOurs(port, projectPath)) {
          return { ok: true, port, startedDevServer: false };
        }
        // Busy with something else — try next port unless user locked this one.
        if (portLocked) {
          return {
            ok: false,
            port,
            message: formatPreviewDevServerFailed({
              projectKey,
              port,
              reason: "PORT_BUSY_OTHER",
              detail: projectPath
                ? `Pass a free port, e.g. \`/preview port:${preferred + 1}\`.`
                : undefined,
            }),
          };
        }
        continue;
      }

      // Free port — start this project's server here.
      if (!projectPath) {
        return {
          ok: false,
          port,
          message: formatPreviewPortDown({ projectKey, port }),
        };
      }

      const ensured = await this.devServers.ensure({ cwd: projectPath, port });
      if (!ensured.ok) {
        return {
          ok: false,
          port,
          message: formatPreviewDevServerFailed({
            projectKey,
            port,
            reason: ensured.reason,
            detail: ensured.detail,
          }),
        };
      }

      // Re-verify identity after start (belt and suspenders).
      if (!(await this.probe(port)) || !(await this.isOurs(port, projectPath))) {
        if (this.devServers.owns(port)) await this.devServers.stop(port);
        return {
          ok: false,
          port,
          message: formatPreviewDevServerFailed({
            projectKey,
            port,
            reason: "READY_TIMEOUT",
            detail: "Server came up but does not look like this project.",
          }),
        };
      }

      return { ok: true, port, startedDevServer: ensured.started };
    }

    return {
      ok: false,
      port: preferred,
      message: formatPreviewDevServerFailed({
        projectKey,
        port: preferred,
        reason: "NO_FREE_PORT",
      }),
    };
  }

  async start(input: PreviewStartInput): Promise<PreviewCommandResult> {
    const projectKey = input.projectKey.toLowerCase();
    const preferred = resolvePreviewPort({
      explicit: input.port,
      projectKey,
      previewPorts: this.mergedPorts(),
      defaultPort: this.defaultPort,
    });
    const projectPath = input.projectPath?.trim() || null;
    const portLocked = typeof input.port === "number";

    const local = await this.resolveLocalServer({
      projectKey,
      projectPath,
      preferred,
      portLocked,
    });
    if (!local.ok) {
      return { ok: false, port: local.port, message: local.message };
    }

    const { port, startedDevServer } = local;

    try {
      const previous = this.projectPort.get(projectKey);
      if (previous != null && previous !== port) {
        await this.tunnels.stopTunnel(previous);
        if (this.devServers.owns(previous)) {
          await this.devServers.stop(previous);
        }
      }

      // Never share a tunnel that another project already registered on this port.
      for (const [otherKey, otherPort] of this.projectPort) {
        if (otherKey !== projectKey && otherPort === port) {
          if (startedDevServer && this.devServers.owns(port)) {
            await this.devServers.stop(port);
          }
          return {
            ok: false,
            port,
            message: formatPreviewDevServerFailed({
              projectKey,
              port,
              reason: "PORT_BUSY_OTHER",
              detail: `**${otherKey.toUpperCase()}** is already using this preview port.`,
            }),
          };
        }
      }

      const tunnel = await this.tunnels.ensureTunnel(port);
      this.projectPort.set(projectKey, port);
      const pick = Boolean(input.pick);
      let url = joinPreviewUrl(tunnel.url, input.path);
      if (pick) url = withPreviewQuery(url, { [PREVIEW_PICK_PARAM]: "1" });
      const movedPort = !portLocked && port !== preferred;
      const ready = formatPreviewReady({
        projectKey,
        port,
        url,
        reused: tunnel.reused,
        startedDevServer,
        pick,
      });
      const note = movedPort
        ? `\n(Preferred port ${preferred} was busy with another app — used ${port} instead.)`
        : "";
      return {
        ok: true,
        port,
        url,
        message: ready + note,
      };
    } catch (err) {
      if (startedDevServer && this.devServers.owns(port)) {
        await this.devServers.stop(port);
      }
      if (err instanceof PreviewTunnelError && err.code === "PREVIEW_BIN_MISSING") {
        return { ok: false, port, message: formatPreviewBinaryMissing(this.bin) };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, port, message: formatPreviewError(message) };
    }
  }

  async stop(projectKey: string): Promise<PreviewCommandResult> {
    const key = projectKey.toLowerCase();
    const port = this.projectPort.get(key);
    if (port == null) {
      return { ok: false, message: formatPreviewNotRunning(key) };
    }
    await this.tunnels.stopTunnel(port);
    const stoppedServer = this.devServers.owns(port) ? await this.devServers.stop(port) : false;
    this.projectPort.delete(key);
    const base = formatPreviewStopped({ projectKey: key, port });
    return {
      ok: true,
      port,
      message: stoppedServer
        ? `${base}\nAlso stopped the \`npm run dev\` process I started.`
        : base,
    };
  }

  /** Tear down every active tunnel and any dev servers we started. */
  async stopAll(): Promise<number> {
    this.projectPort.clear();
    const tunnels = await this.tunnels.stopAll();
    const servers = await this.devServers.stopAll();
    return tunnels + servers;
  }
}
