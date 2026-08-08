import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export function purgeOldFiles(opts: {
  dirs: string[];
  retentionDays: number;
  now?: number;
}): number {
  const now = opts.now ?? Date.now();
  const cutoff = now - opts.retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const dir of opts.dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        const st = statSync(path);
        if (!st.isFile()) continue;
        if (st.mtimeMs < cutoff) {
          unlinkSync(path);
          removed += 1;
        }
      } catch {
        // ignore races / permission errors
      }
    }
  }

  return removed;
}
