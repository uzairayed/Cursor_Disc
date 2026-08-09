import { describe, expect, it } from "vitest";
import {
  BRIDGE_LEASE_MARKER,
  type BridgeLeasePayload,
  decideClaim,
  formatLeaseMessage,
  formatLeaseStatus,
  isLeaseStale,
  parseBridgeLeaseMessage,
} from "./bridge-lease.js";

function lease(overrides: Partial<BridgeLeasePayload> = {}): BridgeLeasePayload {
  return {
    host: "pc",
    pid: 42,
    startedAt: "2026-08-09T10:00:00.000Z",
    heartbeatAt: "2026-08-09T10:00:00.000Z",
    instanceId: "abc",
    ...overrides,
  };
}

describe("parseBridgeLeaseMessage", () => {
  it("parses a formatted lease message", () => {
    const content = formatLeaseMessage(lease({ host: "macbook" }));
    expect(content).toContain(BRIDGE_LEASE_MARKER);
    const parsed = parseBridgeLeaseMessage(content);
    expect(parsed?.host).toBe("macbook");
    expect(parsed?.instanceId).toBe("abc");
  });

  it("returns null for idle / null payload", () => {
    expect(parseBridgeLeaseMessage(formatLeaseMessage(null))).toBeNull();
  });

  it("returns null without marker", () => {
    expect(parseBridgeLeaseMessage('```json\n{"host":"x"}\n```')).toBeNull();
  });
});

describe("isLeaseStale", () => {
  it("is stale when heartbeat is older than staleMs", () => {
    const now = Date.parse("2026-08-09T10:02:00.000Z");
    expect(isLeaseStale(lease({ heartbeatAt: "2026-08-09T10:00:00.000Z" }), now, 90_000)).toBe(
      true,
    );
  });

  it("is fresh within staleMs", () => {
    const now = Date.parse("2026-08-09T10:01:00.000Z");
    expect(isLeaseStale(lease({ heartbeatAt: "2026-08-09T10:00:00.000Z" }), now, 90_000)).toBe(
      false,
    );
  });
});

describe("decideClaim", () => {
  const nowMs = Date.parse("2026-08-09T10:01:00.000Z");

  it("claims when missing", () => {
    expect(
      decideClaim({ existing: null, host: "pc", nowMs, staleMs: 90_000, force: false }),
    ).toEqual({ action: "claim", reason: "missing" });
  });

  it("reclaims same host", () => {
    expect(
      decideClaim({
        existing: lease({ host: "pc", heartbeatAt: "2026-08-09T10:00:50.000Z" }),
        host: "pc",
        nowMs,
        staleMs: 90_000,
        force: false,
      }),
    ).toEqual({ action: "claim", reason: "same_host" });
  });

  it("claims stale other host", () => {
    expect(
      decideClaim({
        existing: lease({ host: "mac", heartbeatAt: "2026-08-09T09:50:00.000Z" }),
        host: "pc",
        nowMs,
        staleMs: 90_000,
        force: false,
      }),
    ).toEqual({ action: "claim", reason: "stale" });
  });

  it("standby when other host is fresh", () => {
    const owner = lease({ host: "mac", heartbeatAt: "2026-08-09T10:00:50.000Z" });
    expect(
      decideClaim({ existing: owner, host: "pc", nowMs, staleMs: 90_000, force: false }),
    ).toEqual({ action: "standby", reason: "other_host_fresh", owner });
  });

  it("force steals a fresh other host", () => {
    expect(
      decideClaim({
        existing: lease({ host: "mac", heartbeatAt: "2026-08-09T10:00:50.000Z" }),
        host: "pc",
        nowMs,
        staleMs: 90_000,
        force: true,
      }),
    ).toEqual({ action: "claim", reason: "force" });
  });
});

describe("formatLeaseStatus", () => {
  it("tells standby how to switch", () => {
    const text = formatLeaseStatus({
      lease: lease({ host: "mac" }),
      localHost: "pc",
      isOwner: false,
      nowMs: Date.parse("2026-08-09T10:00:30.000Z"),
    });
    expect(text).toContain("mac");
    expect(text).toContain("/bridge take");
    expect(text).toContain("standby");
  });
});
