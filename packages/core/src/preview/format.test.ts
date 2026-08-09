import { describe, expect, it } from "vitest";
import {
  formatPreviewBinaryMissing,
  formatPreviewPortDown,
  formatPreviewReady,
  formatPreviewStopped,
} from "./service.js";

describe("preview formatters", () => {
  it("formats a ready preview with project, port, and URL", () => {
    const text = formatPreviewReady({
      projectKey: "tagiser",
      port: 3000,
      url: "https://abc.trycloudflare.com/playground",
      reused: false,
    });
    expect(text).toMatch(/TAGISER/);
    expect(text).toContain("3000");
    expect(text).toContain("https://abc.trycloudflare.com/playground");
    expect(text).toMatch(/phone|browser|preview_pick/i);
    expect(text).toMatch(/anyone with this link/i);
  });

  it("notes when an existing tunnel was reused or a server was started", () => {
    expect(
      formatPreviewReady({
        projectKey: "tagiser",
        port: 3000,
        url: "https://abc.trycloudflare.com",
        reused: true,
      }),
    ).toMatch(/already|reuse/i);
    expect(
      formatPreviewReady({
        projectKey: "tagiser",
        port: 3000,
        url: "https://abc.trycloudflare.com",
        reused: false,
        startedDevServer: true,
      }),
    ).toMatch(/started `npm run dev`/i);
  });

  it("explains a down local port", () => {
    expect(formatPreviewPortDown({ projectKey: "motocards", port: 3000 })).toMatch(
      /couldn't start|npm run dev/i,
    );
  });

  it("explains missing cloudflared", () => {
    expect(formatPreviewBinaryMissing("cloudflared")).toMatch(/brew install|cloudflared/i);
  });

  it("formats stop confirmation", () => {
    expect(formatPreviewStopped({ projectKey: "tagiser", port: 3000 })).toMatch(/stopped|closed/i);
  });
});
