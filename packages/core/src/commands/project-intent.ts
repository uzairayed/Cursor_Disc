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

// Voice STT writes small numbers as words as often as digits.
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function pickByNumber(name: string, projects: ProjectStore): ProjectIntent | null {
  const n = /^\d+$/.test(name) ? Number(name) : NUMBER_WORDS[name.toLowerCase()];
  if (!n) return null;
  const keys = projects.list();
  if (n >= 1 && n <= keys.length) return { action: "select", key: keys[n - 1]! };
  return null;
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
    return pickByNumber(text, projects);
  }

  const switchMatch = text.match(/^(?:switch\s+to|use|go\s+to|open|project)\s+(.+)$/i);
  if (switchMatch?.[1]) {
    const name = switchMatch[1].trim().replace(/^project\s+/i, "");
    const resolved = projects.resolve(name);
    if (resolved) return { action: "select", key: resolved.key };
    // "switch to 7" names the picker slot explicitly — no allowNumber gate needed.
    return pickByNumber(name, projects);
  }

  const resolved = projects.resolve(text);
  if (resolved) return { action: "select", key: resolved.key };

  return null;
}
