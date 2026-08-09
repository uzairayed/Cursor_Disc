import type { ProjectStore } from "../projects/index.js";

export type ProjectIntent =
  | { action: "select"; key: string }
  | { action: "list" }
  | { action: "current" };

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function stripSlash(text: string): string {
  return text.startsWith("/") ? text.slice(1).trim() : text;
}

/**
 * Detect project-navigation intents (switch / pick / list / current).
 * Does not mutate ProjectStore.
 */
export function parseProjectIntent(
  raw: string,
  projects: ProjectStore,
  opts: { allowNumber?: boolean } = {},
): ProjectIntent | null {
  const text = normalize(stripSlash(raw));
  if (!text) return null;
  const lower = text.toLowerCase();

  if (
    /^(projects|list projects|show projects|switch project|change project|choose project)\b/i.test(
      lower,
    )
  ) {
    return { action: "list" };
  }

  if (/^(current|where am i|which project|what project)/i.test(lower)) {
    return { action: "current" };
  }

  if (opts.allowNumber && /^\d+$/.test(text)) {
    const keys = projects.list();
    const n = Number(text);
    if (n >= 1 && n <= keys.length) {
      return { action: "select", key: keys[n - 1]! };
    }
    return null;
  }

  const switchMatch = text.match(/^(?:switch\s+to|use|go\s+to|open|project)\s+(.+)$/i);
  if (switchMatch?.[1]) {
    const name = switchMatch[1].trim();
    const resolved = projects.resolve(name);
    if (resolved) return { action: "select", key: resolved.key };
    return null;
  }

  const resolved = projects.resolve(text);
  if (resolved) return { action: "select", key: resolved.key };

  return null;
}
