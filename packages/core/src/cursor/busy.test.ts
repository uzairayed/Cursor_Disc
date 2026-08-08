import { describe, expect, it } from "vitest";
import { CursorBusyError, CursorRunner } from "./runner.js";

describe("CursorRunner busy state", () => {
  it("throws CursorBusyError when a run is already in progress", async () => {
    const runner = new CursorRunner();
    // Force busy by setting private child via a fake in-flight run marker
    (runner as unknown as { child: object }).child = { kill: () => undefined };

    await expect(
      runner.run({
        cursorBin: "cursor",
        workspace: process.cwd(),
        prompt: "hi",
        projectKey: "crm",
        conversations: {
          getChatId: () => null,
          setChatId: () => undefined,
        } as never,
      })
    ).rejects.toBeInstanceOf(CursorBusyError);
  });

  it("stop returns false when idle", () => {
    const runner = new CursorRunner();
    expect(runner.stop()).toBe(false);
  });
});
