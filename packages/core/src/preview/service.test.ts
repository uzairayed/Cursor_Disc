import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewService } from "./service.js";
import { PreviewTunnelError } from "./tunnel.js";

/** Args DevServerManager.ensure receives; the deps are cast, so state it here. */
type EnsureOpts = { cwd: string; port: number };

describe("PreviewService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reuse another project's listening port", async () => {
    const root = mkdtempSync(join(tmpdir(), "preview-svc-"));
    const projectsFile = join(root, "projects.json");
    writeFileSync(projectsFile, JSON.stringify({ dirs: [], previewPorts: { motocards: 3000 } }));

    const ensure = vi.fn(async ({ port }: { port: number }) => ({
      ok: true as const,
      started: true,
      port,
    }));
    const ensureTunnel = vi.fn(async (port: number) => ({
      port,
      url: `https://p${port}.trycloudflare.com`,
      reused: false,
    }));

    // 3000 is up but belongs to tagiser; 3001 is free then ours after start
    const up = new Set([3000]);
    const svc = new PreviewService({
      projectsFile,
      probe: async (port) => up.has(port),
      belongsToProject: async (port, projectPath) =>
        port === 3000
          ? projectPath.includes("tagiser")
          : port === 3001 && projectPath.includes("motocards"),
      devServers: {
        ensure: async (opts: EnsureOpts) => {
          const result = await ensure(opts);
          up.add(opts.port);
          return result;
        },
        owns: (port: number) => port === 3001,
        stop: vi.fn(),
        stopAll: vi.fn(),
      } as never,
      tunnelManager: { ensureTunnel, stopTunnel: vi.fn(), stopAll: vi.fn() } as never,
    });

    const result = await svc.start({
      projectKey: "motocards",
      projectPath: "/Users/apple/p_projects/motocards",
    });

    expect(result.ok).toBe(true);
    expect(result.port).toBe(3001);
    expect(result.url).toBe("https://p3001.trycloudflare.com");
    expect(ensure).toHaveBeenCalledWith({
      cwd: "/Users/apple/p_projects/motocards",
      port: 3001,
    });
    expect(ensureTunnel).toHaveBeenCalledWith(3001);
    expect(result.message).toMatch(/busy with another app|3001/i);
  });

  it("reuses a port only when it belongs to this project", async () => {
    const root = mkdtempSync(join(tmpdir(), "preview-svc-"));
    const projectsFile = join(root, "projects.json");
    writeFileSync(projectsFile, "{}");

    const ensure = vi.fn();
    const ensureTunnel = vi.fn(async () => ({
      port: 3000,
      url: "https://abc.trycloudflare.com",
      reused: false,
    }));

    const svc = new PreviewService({
      projectsFile,
      probe: async () => true,
      belongsToProject: async (_port, projectPath) => projectPath.includes("tagiser"),
      devServers: { ensure, owns: () => false, stop: vi.fn(), stopAll: vi.fn() } as never,
      tunnelManager: { ensureTunnel, stopTunnel: vi.fn() } as never,
    });

    const result = await svc.start({
      projectKey: "tagiser",
      projectPath: "/Users/apple/projects/tagiser-beta",
    });
    expect(result.ok).toBe(true);
    expect(result.port).toBe(3000);
    expect(ensure).not.toHaveBeenCalled();
  });

  it("refuses an explicit port owned by another project", async () => {
    const root = mkdtempSync(join(tmpdir(), "preview-svc-"));
    const projectsFile = join(root, "projects.json");
    writeFileSync(projectsFile, "{}");

    const ensureTunnel = vi.fn();
    const svc = new PreviewService({
      projectsFile,
      probe: async () => true,
      belongsToProject: async () => false,
      tunnelManager: { ensureTunnel, stopTunnel: vi.fn() } as never,
    });

    const result = await svc.start({
      projectKey: "motocards",
      projectPath: "/Users/apple/p_projects/motocards",
      port: 3000,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/different project/i);
    expect(ensureTunnel).not.toHaveBeenCalled();
  });

  it("auto-starts the dev server when no matching listener exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "preview-svc-"));
    const projectsFile = join(root, "projects.json");
    writeFileSync(projectsFile, "{}");
    const projectPath = join(root, "tagiser");

    const ensure = vi.fn(async (_opts: EnsureOpts) => ({
      ok: true as const,
      started: true,
      port: 3000,
    }));
    const ensureTunnel = vi.fn(async () => ({
      port: 3000,
      url: "https://abc.trycloudflare.com",
      reused: false,
    }));

    let up = false;
    const svc = new PreviewService({
      projectsFile,
      probe: async () => up,
      belongsToProject: async () => up,
      devServers: {
        ensure: async (opts: EnsureOpts) => {
          up = true;
          return ensure(opts);
        },
        owns: () => true,
        stop: vi.fn(),
        stopAll: vi.fn(),
      } as never,
      tunnelManager: { ensureTunnel, stopTunnel: vi.fn(), stopAll: vi.fn() } as never,
    });

    const result = await svc.start({
      projectKey: "tagiser",
      projectPath,
      path: "/playground",
    });

    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://abc.trycloudflare.com/playground");
    expect(result.message).toMatch(/started `npm run dev`/i);
  });

  it("appends ?pick=1 when pick mode is requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "preview-svc-"));
    const projectsFile = join(root, "projects.json");
    writeFileSync(projectsFile, "{}");

    const svc = new PreviewService({
      projectsFile,
      probe: async () => true,
      belongsToProject: async () => true,
      tunnelManager: {
        ensureTunnel: async () => ({
          port: 3000,
          url: "https://abc.trycloudflare.com",
          reused: false,
        }),
        stopTunnel: vi.fn(),
      } as never,
    });

    const result = await svc.start({
      projectKey: "tagiser",
      projectPath: "/tmp/tagiser",
      path: "/playground",
      pick: true,
    });
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://abc.trycloudflare.com/playground?pick=1");
    expect(result.message).toMatch(/element picker/i);
  });

  it("maps missing binary errors to install instructions", async () => {
    const root = mkdtempSync(join(tmpdir(), "preview-svc-"));
    const projectsFile = join(root, "projects.json");
    writeFileSync(projectsFile, "{}");

    const svc = new PreviewService({
      projectsFile,
      probe: async () => true,
      belongsToProject: async () => true,
      tunnelManager: {
        ensureTunnel: async () => {
          throw new PreviewTunnelError("missing", "PREVIEW_BIN_MISSING");
        },
        stopTunnel: vi.fn(),
      } as never,
    });

    const result = await svc.start({
      projectKey: "tagiser",
      projectPath: "/tmp/tagiser",
      port: 3000,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/brew install cloudflared/i);
  });
});
