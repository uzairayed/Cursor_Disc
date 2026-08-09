import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exclusive pid lock so only one Discord bridge runs per machine/workdir.
 * Stale locks (dead pid) are cleared automatically.
 */
export function acquireProcessLock(lockPath: string): { release: () => void } {
  const writeLock = (): boolean => {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };

  if (!writeLock()) {
    let existingPid: number | null = null;
    try {
      existingPid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    } catch {
      // missing/unreadable — try replace below
    }
    if (existingPid != null && Number.isFinite(existingPid) && isPidAlive(existingPid)) {
      throw new Error(
        `Another bridge is already running (pid ${existingPid}). Stop it before starting a second one.`,
      );
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // race with another starter
    }
    if (!writeLock()) {
      throw new Error("Another bridge is already running (could not acquire lock).");
    }
  }

  const release = () => {
    try {
      if (!existsSync(lockPath)) return;
      const pid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
      if (pid === process.pid) unlinkSync(lockPath);
    } catch {
      // best effort
    }
  };

  process.once("exit", release);
  return { release };
}
