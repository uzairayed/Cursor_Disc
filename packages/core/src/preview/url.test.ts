import { describe, expect, it } from "vitest";
import { extractCloudflareTunnelUrl, joinPreviewUrl, withPreviewQuery } from "./tunnel.js";

describe("extractCloudflareTunnelUrl", () => {
  it("pulls the trycloudflare URL from cloudflared stderr noise", () => {
    const output = [
      "2026-07-28T12:00:00Z INF Thank you for trying Cloudflare Tunnel.",
      "https://lucky-moon-1234.trycloudflare.com",
      "2026-07-28T12:00:01Z INF Connection registered",
    ].join("\n");
    expect(extractCloudflareTunnelUrl(output)).toBe("https://lucky-moon-1234.trycloudflare.com");
  });

  it("returns null when no tunnel URL is present", () => {
    expect(extractCloudflareTunnelUrl("failed to dial")).toBeNull();
  });
});

describe("joinPreviewUrl", () => {
  it("appends a path without doubling slashes", () => {
    expect(joinPreviewUrl("https://abc.trycloudflare.com", "/playground")).toBe(
      "https://abc.trycloudflare.com/playground",
    );
    expect(joinPreviewUrl("https://abc.trycloudflare.com/", "playground")).toBe(
      "https://abc.trycloudflare.com/playground",
    );
    expect(joinPreviewUrl("https://abc.trycloudflare.com", "")).toBe(
      "https://abc.trycloudflare.com",
    );
  });
});

describe("withPreviewQuery", () => {
  it("adds pick=1 for the element-picker preview command", () => {
    expect(withPreviewQuery("https://abc.trycloudflare.com/playground", { pick: "1" })).toBe(
      "https://abc.trycloudflare.com/playground?pick=1",
    );
  });
});
