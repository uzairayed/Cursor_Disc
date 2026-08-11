import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { expandHome } from "../utils/path.js";

export type ProjectsMap = Record<string, string>;

export interface DeviceProjectsConfig {
  /** Parent folders — each immediate child project folder is listed */
  dirs?: string[];
  /** Explicit name → path overrides / additions (win over scan on key clash) */
  aliases?: ProjectsMap;
  /** Optional /preview port map for this device */
  previewPorts?: Record<string, number>;
}

export interface ProjectsFileConfig {
  /** Parent folders — each immediate child project folder is listed */
  dirs?: string[];
  /** Folder names to skip (case-insensitive); applies to every device section */
  exclude?: string[];
  /** Explicit name → path overrides / additions (win over scan on key clash) */
  aliases?: ProjectsMap;
  /** Optional /preview port map (flat config) */
  previewPorts?: Record<string, number>;
  /**
   * Per-machine project roots. When set, the active `BRIDGE_HOST` section is
   * what this bridge can run; other sections show as separate picker categories.
   */
  devices?: Record<string, DeviceProjectsConfig>;
}

function looksLikeProject(dirPath: string): boolean {
  return existsSync(join(dirPath, "package.json")) || existsSync(join(dirPath, ".git"));
}

function projectKey(folderName: string): string {
  return folderName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAliases(raw: ProjectsMap | undefined): ProjectsMap {
  const aliases: ProjectsMap = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === "string" && value.trim()) {
      aliases[key.toLowerCase()] = value;
    }
  }
  return aliases;
}

function loadSection(section: DeviceProjectsConfig, exclude: string[]): ProjectsMap {
  const scanned = discoverProjectsFromDirs(section.dirs ?? [], exclude);
  return { ...scanned, ...normalizeAliases(section.aliases) };
}

export function discoverProjectsFromDirs(dirs: string[], exclude: string[] = []): ProjectsMap {
  const excluded = new Set(exclude.map((e) => e.toLowerCase()));
  const found: ProjectsMap = {};

  for (const rawDir of dirs) {
    const dir = expandHome(rawDir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;

    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      const key = projectKey(entry);
      if (!key || excluded.has(key) || excluded.has(entry.toLowerCase())) continue;
      if (!looksLikeProject(full)) continue;

      // First scan wins on duplicate keys across dirs
      if (!found[key]) found[key] = full;
    }
  }

  return found;
}

/** Case-insensitive lookup of a devices.* section. */
export function findDeviceSection(
  devices: Record<string, DeviceProjectsConfig>,
  host: string,
): { name: string; section: DeviceProjectsConfig } | null {
  const want = host.trim().toLowerCase();
  if (!want) return null;
  for (const [name, section] of Object.entries(devices)) {
    if (name.toLowerCase() === want) return { name, section };
  }
  return null;
}

export function deviceNames(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const devices = (raw as ProjectsFileConfig).devices;
  if (!devices || typeof devices !== "object") return [];
  return Object.keys(devices).sort((a, b) => a.localeCompare(b));
}

/**
 * Accepts legacy flat map, flat { dirs, exclude, aliases }, or { devices, exclude }.
 * With `devices`, only the active host section is runnable on this machine.
 */
export function loadProjectsConfig(raw: unknown, opts: { host?: string | null } = {}): ProjectsMap {
  if (!raw || typeof raw !== "object") return {};

  const obj = raw as Record<string, unknown>;
  const hasDevices = obj.devices != null && typeof obj.devices === "object";
  const hasScanShape =
    Array.isArray(obj.dirs) ||
    Array.isArray(obj.exclude) ||
    obj.aliases != null ||
    obj.previewPorts != null ||
    hasDevices;

  if (!hasScanShape) {
    // Legacy: { "name": "/path", ... }
    const legacy: ProjectsMap = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string" && value.trim()) {
        legacy[key.toLowerCase()] = value;
      }
    }
    return legacy;
  }

  const cfg = obj as ProjectsFileConfig;
  const exclude = cfg.exclude ?? [];

  if (hasDevices) {
    const devices = cfg.devices ?? {};
    const match = findDeviceSection(devices, opts.host ?? "");
    if (!match) return {};
    return loadSection(match.section, exclude);
  }

  return loadSection(
    { dirs: cfg.dirs, aliases: cfg.aliases, previewPorts: cfg.previewPorts },
    exclude,
  );
}

/** Keys listed for a non-active device (aliases + whatever dirs exist here). */
export function listRemoteDeviceKeys(
  section: DeviceProjectsConfig,
  exclude: string[] = [],
): string[] {
  const scanned = discoverProjectsFromDirs(section.dirs ?? [], exclude);
  const keys = new Set([
    ...Object.keys(scanned),
    ...Object.keys(normalizeAliases(section.aliases)),
  ]);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * Picker text with one category per device. Numbers only on the active host
 * (matches parseProjectIntent reply-with-number against ProjectStore.list()).
 */
export function formatDevicePicker(opts: {
  raw: unknown;
  host: string;
  /** Runnable keys on this host (already includes general, sorted). */
  localKeys: string[];
}): string {
  const { raw, host, localKeys } = opts;
  if (!raw || typeof raw !== "object") {
    if (localKeys.length === 0) return "No projects are configured yet.";
    return localKeys.map((k, i) => `${i + 1}. ${k.toUpperCase()}`).join("\n");
  }

  const cfg = raw as ProjectsFileConfig;
  const devices = cfg.devices;
  if (!devices || typeof devices !== "object" || Object.keys(devices).length === 0) {
    if (localKeys.length === 0) return "No projects are configured yet.";
    return localKeys.map((k, i) => `${i + 1}. ${k.toUpperCase()}`).join("\n");
  }

  const hostLower = host.trim().toLowerCase();
  const names = Object.keys(devices).sort((a, b) => {
    const aActive = a.toLowerCase() === hostLower;
    const bActive = b.toLowerCase() === hostLower;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return a.localeCompare(b);
  });

  const exclude = cfg.exclude ?? [];
  const lines: string[] = [];
  let n = 1;

  for (const name of names) {
    const active = name.toLowerCase() === hostLower;
    lines.push(`**${name}**${active ? " · this machine" : ""}`);
    if (active) {
      if (localKeys.length === 0) {
        lines.push("_No projects on this machine yet._");
      } else {
        for (const key of localKeys) {
          lines.push(`${n}. ${key.toUpperCase()}`);
          n += 1;
        }
      }
    } else {
      const remoteKeys = listRemoteDeviceKeys(devices[name] ?? {}, exclude);
      if (remoteKeys.length === 0) {
        lines.push(`_Projects live on that machine — \`/bridge take\` there._`);
      } else {
        for (const key of remoteKeys) {
          lines.push(`• ${key.toUpperCase()}`);
        }
        lines.push(`_Switch with \`/bridge take\` on ${name}._`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function displayNameFromPath(path: string): string {
  return basename(path);
}
