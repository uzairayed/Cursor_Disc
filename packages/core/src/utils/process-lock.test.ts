import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireProcessLock } from "./process-lock.js";

describe("acquireProcessLock", () => {
  it("allows one holder and rejects a second while the first is alive", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-lock-"));
    const path = join(dir, "bridge.lock");

    const first = acquireProcessLock(path);
    expect(() => acquireProcessLock(path)).toThrow(/already running/);
    first.release();
  });

  it("replaces a stale lock from a dead pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-lock-"));
    const path = join(dir, "bridge.lock");
    // pid 1 is almost never our process; on Windows kill(1,0) typically fails
    writeFileSync(path, "1\n");

    const lock = acquireProcessLock(path);
    expect(lock).toBeDefined();
    lock.release();
  });
});
