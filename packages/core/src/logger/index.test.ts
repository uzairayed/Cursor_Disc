import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunLogger } from "./index.js";

describe("RunLogger", () => {
  it("appends JSONL entries into a day-stamped log file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-logs-"));
    const logger = new RunLogger(dir);

    logger.log({
      time: "2026-07-29T10:11:12.000Z",
      project: "cliproom",
      prompt: "fix login",
      response: "done",
      duration: 12.5,
      exit: 0,
      platform: "discord",
      sourceId: "chan-1",
    });

    const file = join(dir, "2026-07-29.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      time: "2026-07-29T10:11:12.000Z",
      project: "cliproom",
      prompt: "fix login",
      response: "done",
      duration: 12.5,
      exit: 0,
      platform: "discord",
      sourceId: "chan-1",
    });
  });

  it("appends multiple entries to the same day file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-logs-"));
    const logger = new RunLogger(dir);
    logger.log({
      time: "2026-07-29T01:00:00.000Z",
      project: "a",
      prompt: "one",
      duration: 1,
      exit: 0,
    });
    logger.log({
      time: "2026-07-29T02:00:00.000Z",
      project: "b",
      prompt: "two",
      duration: 2,
      exit: 1,
      error: "boom",
    });

    const lines = readFileSync(join(dir, "2026-07-29.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).error).toBe("boom");
  });
});
