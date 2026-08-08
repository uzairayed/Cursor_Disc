import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome } from "./path.js";

describe("expandHome", () => {
  it("expands ~ to the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("expands ~/relative paths under home", () => {
    expect(expandHome("~/code/app")).toBe(resolve(homedir(), "code/app"));
  });

  it("resolves absolute and relative paths without home expansion", () => {
    expect(expandHome("/tmp/project")).toBe(resolve("/tmp/project"));
    expect(expandHome("relative/dir")).toBe(resolve("relative/dir"));
  });
});
