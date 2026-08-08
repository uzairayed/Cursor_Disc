import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { purgeOldFiles } from "./housekeeping.js";

describe("purgeOldFiles", () => {
  it("deletes files older than retentionDays and keeps recent ones", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-hk-"));
    const inbox = join(root, "inbox");
    const logs = join(root, "logs");
    mkdirSync(inbox);
    mkdirSync(logs);

    const oldInbox = join(inbox, "old.jpg");
    const newInbox = join(inbox, "new.jpg");
    const oldLog = join(logs, "old.jsonl");
    const newLog = join(logs, "new.jsonl");
    for (const f of [oldInbox, newInbox, oldLog, newLog]) {
      writeFileSync(f, "x");
    }

    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    utimesSync(oldInbox, nineDaysAgo, nineDaysAgo);
    utimesSync(oldLog, nineDaysAgo, nineDaysAgo);

    const removed = purgeOldFiles({
      dirs: [inbox, logs],
      retentionDays: 7,
      now: Date.now(),
    });

    expect(removed).toBe(2);
    expect(existsSync(oldInbox)).toBe(false);
    expect(existsSync(oldLog)).toBe(false);
    expect(existsSync(newInbox)).toBe(true);
    expect(existsSync(newLog)).toBe(true);
  });

  it("no-ops when directories are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-hk-missing-"));
    expect(
      purgeOldFiles({
        dirs: [join(root, "nope")],
        retentionDays: 7,
      })
    ).toBe(0);
  });
});
