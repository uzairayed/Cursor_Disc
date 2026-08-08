import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { expandHome } from "../utils/path.js";

export type ProjectsMap = Record<string, string>;

export interface ProjectsFileConfig {
  /** Parent folders — each immediate child project folder is listed */
  dirs?: string[];
  /** Folder names to skip (case-insensitive) */
  exclude?: string[];
  /** Explicit name → path overrides / additions (win over scan on key clash) */
  aliases?: ProjectsMap;
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

export function discoverProjectsFromDirs(
  dirs: string[],
  exclude: string[] = []
): ProjectsMap {
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

/** Accepts legacy flat map or { dirs, exclude, aliases }. */
export function loadProjectsConfig(raw: unknown): ProjectsMap {
  if (!raw || typeof raw !== "object") return {};

  const obj = raw as Record<string, unknown>;
  const hasScanShape =
    Array.isArray(obj.dirs) || Array.isArray(obj.exclude) || obj.aliases != null;

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
  const scanned = discoverProjectsFromDirs(cfg.dirs ?? [], cfg.exclude ?? []);
  const aliases: ProjectsMap = {};
  for (const [key, value] of Object.entries(cfg.aliases ?? {})) {
    if (typeof value === "string" && value.trim()) {
      aliases[key.toLowerCase()] = value;
    }
  }

  return { ...scanned, ...aliases };
}

export function displayNameFromPath(path: string): string {
  return basename(path);
}
