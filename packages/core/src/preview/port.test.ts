import { describe, expect, it } from "vitest";
import {
  loadPreviewPorts,
  parsePreviewPortsEnv,
  resolvePreviewPort,
} from "./service.js";

describe("parsePreviewPortsEnv", () => {
  it("parses project:port pairs", () => {
    expect(parsePreviewPortsEnv("tagiser:3000, motocards:3001")).toEqual({
      tagiser: 3000,
      motocards: 3001,
    });
  });

  it("skips invalid pairs", () => {
    expect(parsePreviewPortsEnv("bad, tagiser:abc, ok:4000")).toEqual({ ok: 4000 });
  });
});

describe("loadPreviewPorts", () => {
  it("reads previewPorts from the scan-shaped projects.json", () => {
    expect(
      loadPreviewPorts({
        dirs: [],
        previewPorts: { "Tagiser-Beta": 3000, motocards: 3001 },
      })
    ).toEqual({ "tagiser-beta": 3000, motocards: 3001 });
  });

  it("returns empty for legacy flat maps", () => {
    expect(loadPreviewPorts({ cliproom: "/tmp/clip" })).toEqual({});
  });
});

describe("resolvePreviewPort", () => {
  it("prefers explicit port, then project map, then default", () => {
    expect(
      resolvePreviewPort({
        explicit: 5173,
        projectKey: "tagiser",
        previewPorts: { tagiser: 3000 },
        defaultPort: 3000,
      })
    ).toBe(5173);

    expect(
      resolvePreviewPort({
        explicit: null,
        projectKey: "tagiser",
        previewPorts: { tagiser: 3000 },
        defaultPort: 8080,
      })
    ).toBe(3000);

    expect(
      resolvePreviewPort({
        explicit: undefined,
        projectKey: "unknown",
        previewPorts: {},
        defaultPort: 3000,
      })
    ).toBe(3000);
  });
});
