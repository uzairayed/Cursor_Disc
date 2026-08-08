import { describe, expect, it } from "vitest";
import {
  isSameProjectPath,
  parseListeningPid,
  parseProcessCwd,
} from "./port-owner.js";

describe("parseListeningPid", () => {
  it("reads the PID from lsof LISTEN output", () => {
    const out = [
      "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345 apple   21u  IPv4 0x1      0t0  TCP 127.0.0.1:3000 (LISTEN)",
    ].join("\n");
    expect(parseListeningPid(out)).toBe(12345);
  });

  it("returns null when nothing is listening", () => {
    expect(parseListeningPid("")).toBeNull();
  });
});

describe("parseProcessCwd", () => {
  it("reads cwd from lsof -d cwd output", () => {
    const out = [
      "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    12345 apple  cwd    DIR  1,15     704 123 /Users/apple/projects/tagiser-beta",
    ].join("\n");
    expect(parseProcessCwd(out)).toBe("/Users/apple/projects/tagiser-beta");
  });
});

describe("isSameProjectPath", () => {
  it("matches the project root and nested listener cwds", () => {
    expect(
      isSameProjectPath(
        "/Users/apple/projects/tagiser-beta",
        "/Users/apple/projects/tagiser-beta"
      )
    ).toBe(true);
    expect(
      isSameProjectPath(
        "/Users/apple/projects/tagiser-beta/.next",
        "/Users/apple/projects/tagiser-beta"
      )
    ).toBe(true);
    expect(
      isSameProjectPath(
        "/Users/apple/p_projects/motocards",
        "/Users/apple/projects/tagiser-beta"
      )
    ).toBe(false);
  });
});
