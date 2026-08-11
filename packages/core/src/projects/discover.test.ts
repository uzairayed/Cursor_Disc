import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProjectsFromDirs, formatDevicePicker, loadProjectsConfig } from "./discover.js";

function makeTree(): { root: string; a: string; b: string; skip: string } {
  const root = mkdtempSync(join(tmpdir(), "cwa-discover-"));
  const a = join(root, "ClipRoom");
  const b = join(root, "Motocards");
  const skip = join(root, "notes");
  const hidden = join(root, ".hidden");
  mkdirSync(a);
  mkdirSync(b);
  mkdirSync(skip);
  mkdirSync(hidden);
  writeFileSync(join(a, "package.json"), "{}");
  writeFileSync(join(b, ".git"), ""); // file is enough for our check via exists
  // skip has neither package.json nor .git
  return { root, a, b, skip };
}

describe("discoverProjectsFromDirs", () => {
  it("picks immediate subfolders that look like projects", () => {
    const { root, a, b } = makeTree();
    const found = discoverProjectsFromDirs([root], []);
    expect(found).toEqual({
      cliproom: a,
      motocards: b,
    });
  });

  it("honors exclude names", () => {
    const { root, b } = makeTree();
    const found = discoverProjectsFromDirs([root], ["cliproom"]);
    expect(found).toEqual({ motocards: b });
  });
});

describe("loadProjectsConfig", () => {
  it("keeps legacy flat map format", () => {
    expect(
      loadProjectsConfig({
        tagiser: "/Users/apple/projects/tagiser-beta",
      }),
    ).toEqual({ tagiser: "/Users/apple/projects/tagiser-beta" });
  });

  it("merges scanned dirs with explicit aliases (aliases win on key clash)", () => {
    const { root } = makeTree();
    const custom = join(root, "custom-clip");
    mkdirSync(custom);
    const found = loadProjectsConfig({
      dirs: [root],
      exclude: ["motocards"],
      aliases: {
        cliproom: custom,
        tagiser: "/tmp/tagiser",
      },
    });
    expect(found.cliproom).toBe(custom);
    expect(found.tagiser).toBe("/tmp/tagiser");
    expect(found.motocards).toBeUndefined();
  });

  it("loads only the matching devices.<host> section", () => {
    const { root, a } = makeTree();
    const found = loadProjectsConfig(
      {
        exclude: [],
        devices: {
          "windows-pc": { dirs: [root] },
          macbook: { aliases: { other: "/tmp/other" } },
        },
      },
      { host: "windows-pc" },
    );
    expect(found.cliproom).toBe(a);
    expect(found.other).toBeUndefined();
    expect(
      loadProjectsConfig({ devices: { macbook: { aliases: { x: "/x" } } } }, { host: "pc" }),
    ).toEqual({});
  });
});

describe("formatDevicePicker", () => {
  it("numbers only the active host's keys", () => {
    const text = formatDevicePicker({
      raw: {
        devices: {
          "windows-pc": { aliases: { motocards: "D:/p_projects/Motocards" } },
          macbook: { aliases: { fleet: "/Users/YOU/fleet" } },
        },
      },
      host: "windows-pc",
      localKeys: ["general", "motocards"],
    });
    expect(text).toMatch(/\*\*windows-pc\*\* · this machine/);
    expect(text).toMatch(/1\.\s*GENERAL/);
    expect(text).toMatch(/2\.\s*MOTOCARDS/);
    expect(text).toMatch(/\*\*macbook\*\*/);
    expect(text).toMatch(/• FLEET/);
    expect(text).not.toMatch(/1\.\s*FLEET/);
  });
});
