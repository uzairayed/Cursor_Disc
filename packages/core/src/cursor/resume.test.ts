import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

// runner.ts spawns via cross-spawn so Windows .cmd shims work.
vi.mock("cross-spawn", () => ({
  default: vi.fn(),
}));

import spawn from "cross-spawn";
import { CursorRunner } from "./runner.js";

function fakeChild(): EventEmitter & {
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as ReturnType<typeof fakeChild>;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("CursorRunner resume flag", () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it("skips --resume when resume is false even if a chatId exists", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const runner = new CursorRunner();
    const promise = runner.run({
      cursorBin: "cursor",
      workspace: process.cwd(),
      prompt: "hi",
      projectKey: "general",
      resume: false,
      conversations: {
        getChatId: () => "fat-session-id",
        setChatId: () => undefined,
      } as never,
    });

    queueMicrotask(() => child.emit("close", 0));
    await promise;

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args).toBeDefined();
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("fat-session-id");
  });

  it("passes --resume when resume is true and a chatId exists", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const runner = new CursorRunner();
    const promise = runner.run({
      cursorBin: "cursor",
      workspace: process.cwd(),
      prompt: "hi",
      projectKey: "tagiser-beta",
      resume: true,
      conversations: {
        getChatId: () => "sess-123",
        setChatId: () => undefined,
      } as never,
    });

    queueMicrotask(() => child.emit("close", 0));
    await promise;

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args).toContain("--resume");
    expect(args).toContain("sess-123");
  });

  it("passes --model when model is set", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const runner = new CursorRunner();
    const promise = runner.run({
      cursorBin: "cursor",
      workspace: process.cwd(),
      prompt: "hi",
      projectKey: "crm",
      model: "gpt-5.2",
      conversations: {
        getChatId: () => null,
        setChatId: () => undefined,
      } as never,
    });

    queueMicrotask(() => child.emit("close", 0));
    await promise;

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("gpt-5.2");
  });
});
