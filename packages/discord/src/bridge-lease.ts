import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import type { Client, TextChannel } from "discord.js";

export const BRIDGE_LEASE_MARKER = "<!-- cursor-bridge-lease -->";
export const BRIDGE_LEASE_HEARTBEAT_MS = 30_000;

export interface BridgeLeasePayload {
  host: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  instanceId: string;
}

export type ClaimDecision =
  | { action: "claim"; reason: "missing" | "stale" | "same_host" | "force" }
  | { action: "standby"; reason: "other_host_fresh"; owner: BridgeLeasePayload };

export function parseBridgeLeaseMessage(content: string): BridgeLeasePayload | null {
  if (!content.includes(BRIDGE_LEASE_MARKER)) return null;
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!match?.[1]) return null;
  const raw = match[1].trim();
  if (!raw || raw === "null") return null;
  try {
    const obj = JSON.parse(raw) as Partial<BridgeLeasePayload>;
    if (
      typeof obj.host !== "string" ||
      typeof obj.pid !== "number" ||
      typeof obj.startedAt !== "string" ||
      typeof obj.heartbeatAt !== "string" ||
      typeof obj.instanceId !== "string"
    ) {
      return null;
    }
    return {
      host: obj.host,
      pid: obj.pid,
      startedAt: obj.startedAt,
      heartbeatAt: obj.heartbeatAt,
      instanceId: obj.instanceId,
    };
  } catch {
    return null;
  }
}

export function isLeaseStale(
  lease: BridgeLeasePayload,
  nowMs: number,
  staleMs: number,
): boolean {
  const hb = Date.parse(lease.heartbeatAt);
  if (!Number.isFinite(hb)) return true;
  return nowMs - hb > staleMs;
}

export function decideClaim(opts: {
  existing: BridgeLeasePayload | null;
  host: string;
  nowMs: number;
  staleMs: number;
  force: boolean;
}): ClaimDecision {
  const { existing, host, nowMs, staleMs, force } = opts;
  if (!existing) return { action: "claim", reason: "missing" };
  if (force) return { action: "claim", reason: "force" };
  if (existing.host === host) return { action: "claim", reason: "same_host" };
  if (isLeaseStale(existing, nowMs, staleMs)) return { action: "claim", reason: "stale" };
  return { action: "standby", reason: "other_host_fresh", owner: existing };
}

export function formatLeaseMessage(lease: BridgeLeasePayload | null): string {
  if (!lease) {
    return [
      BRIDGE_LEASE_MARKER,
      "Bridge idle — no active owner.",
      "",
      "```json",
      "null",
      "```",
    ].join("\n");
  }
  const ageSec = Math.max(0, Math.round((Date.now() - Date.parse(lease.heartbeatAt)) / 1000));
  return [
    BRIDGE_LEASE_MARKER,
    `Active bridge: **${lease.host}** (pid ${lease.pid}, heartbeat ${ageSec}s ago)`,
    "Use `/bridge take` on another machine to switch, or wait until this heartbeat goes stale.",
    "",
    "```json",
    JSON.stringify(lease, null, 2),
    "```",
  ].join("\n");
}

export function formatLeaseStatus(opts: {
  lease: BridgeLeasePayload | null;
  localHost: string;
  isOwner: boolean;
  nowMs?: number;
}): string {
  const now = opts.nowMs ?? Date.now();
  if (!opts.lease) {
    return `No active bridge lease. This host: **${opts.localHost}** (${opts.isOwner ? "owner" : "standby"}).`;
  }
  const ageSec = Math.max(0, Math.round((now - Date.parse(opts.lease.heartbeatAt)) / 1000));
  const role = opts.isOwner ? "owner" : "standby";
  return [
    `Bridge lease: **${opts.lease.host}** (pid ${opts.lease.pid})`,
    `Heartbeat: ${ageSec}s ago · this host: **${opts.localHost}** (${role})`,
    opts.isOwner
      ? "This machine handles Discord prompts."
      : "This machine is standby. Use `/bridge take` to switch here.",
  ].join("\n");
}

export function newLeasePayload(host: string, now = new Date()): BridgeLeasePayload {
  const iso = now.toISOString();
  return {
    host,
    pid: process.pid,
    startedAt: iso,
    heartbeatAt: iso,
    instanceId: randomUUID(),
  };
}

export interface BridgeLeaseConfig {
  channelId: string | null;
  host: string;
  staleMs: number;
  force: boolean;
}

type LeaseMessage = {
  id: string;
  content: string;
  edit: (content: string) => Promise<unknown>;
};

type LeaseChannel = {
  isTextBased: () => boolean;
  send: (content: string) => Promise<LeaseMessage>;
  messages: {
    fetch: (
      opts: { limit: number } | string,
    ) => Promise<Map<string, LeaseMessage> | LeaseMessage | Iterable<LeaseMessage>>;
  };
};

/**
 * Discord-backed multi-machine lease. When channelId is null, always owns
 * (single-machine / lease disabled).
 */
export class BridgeLeaseManager {
  private payload: BridgeLeasePayload | null = null;
  private messageId: string | null = null;
  private owner = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = new Date();

  constructor(
    private readonly cfg: BridgeLeaseConfig,
    private readonly client: Client,
  ) {}

  get host(): string {
    return this.cfg.host;
  }

  isOwner(): boolean {
    return this.owner;
  }

  /** True when multi-machine lease is configured. */
  isEnabled(): boolean {
    return Boolean(this.cfg.channelId);
  }

  currentPayload(): BridgeLeasePayload | null {
    return this.payload;
  }

  async start(): Promise<void> {
    if (!this.cfg.channelId) {
      this.owner = true;
      console.log("Bridge lease: disabled (set BRIDGE_LEASE_CHANNEL_ID for multi-machine).");
      return;
    }

    const channel = await this.fetchChannel(this.cfg.channelId);
    const existingMsg = await this.findLeaseMessage(channel);
    const existing = existingMsg ? parseBridgeLeaseMessage(existingMsg.content) : null;
    const decision = decideClaim({
      existing,
      host: this.cfg.host,
      nowMs: Date.now(),
      staleMs: this.cfg.staleMs,
      force: this.cfg.force,
    });

    if (decision.action === "standby") {
      this.owner = false;
      this.payload = decision.owner;
      this.messageId = existingMsg?.id ?? null;
      console.log(
        `Bridge lease: standby — **${decision.owner.host}** holds a fresh lease. ` +
          `Use /bridge take or BRIDGE_FORCE=1 to switch.`,
      );
      return;
    }

    await this.claim(channel, existingMsg, decision.reason);
  }

  async take(): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    if (!this.cfg.channelId) {
      this.owner = true;
      return { ok: true, message: "Lease disabled — this process already handles prompts." };
    }
    const channel = await this.fetchChannel(this.cfg.channelId);
    const existingMsg = await this.findLeaseMessage(channel);
    await this.claim(channel, existingMsg, "force");
    return {
      ok: true,
      message: formatLeaseStatus({
        lease: this.payload,
        localHost: this.cfg.host,
        isOwner: true,
      }),
    };
  }

  async status(): Promise<string> {
    if (!this.cfg.channelId) {
      return formatLeaseStatus({
        lease: null,
        localHost: this.cfg.host,
        isOwner: true,
      }).replace("No active bridge lease.", "Lease disabled (single-machine).");
    }
    try {
      const channel = await this.fetchChannel(this.cfg.channelId);
      const existingMsg = await this.findLeaseMessage(channel);
      const lease = existingMsg ? parseBridgeLeaseMessage(existingMsg.content) : null;
      const owns = Boolean(lease && lease.instanceId === this.payload?.instanceId && this.owner);
      return formatLeaseStatus({
        lease,
        localHost: this.cfg.host,
        isOwner: owns,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return `Could not read bridge lease: ${detail}`;
    }
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    if (!this.owner || !this.cfg.channelId || !this.messageId) {
      this.owner = false;
      return;
    }
    try {
      const channel = await this.fetchChannel(this.cfg.channelId);
      const msg = await this.fetchMessage(channel, this.messageId);
      if (msg) await msg.edit(formatLeaseMessage(null));
    } catch (err) {
      console.warn("Bridge lease: release failed:", err);
    }
    this.owner = false;
    this.payload = null;
  }

  private async claim(
    channel: LeaseChannel,
    existingMsg: LeaseMessage | null,
    reason: string,
  ): Promise<void> {
    this.payload = newLeasePayload(this.cfg.host, this.startedAt);
    const content = formatLeaseMessage(this.payload);
    if (existingMsg) {
      await existingMsg.edit(content);
      this.messageId = existingMsg.id;
    } else {
      const sent = await channel.send(content);
      this.messageId = sent.id;
    }
    this.owner = true;
    this.startHeartbeat(channel);
    console.log(`Bridge lease: claimed by **${this.cfg.host}** (${reason}).`);
  }

  private startHeartbeat(channel: LeaseChannel): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.beat(channel).catch((err) => console.warn("Bridge lease: heartbeat failed:", err));
    }, BRIDGE_LEASE_HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async beat(channel: LeaseChannel): Promise<void> {
    if (!this.owner || !this.payload || !this.messageId) return;
    this.payload = { ...this.payload, heartbeatAt: new Date().toISOString(), pid: process.pid };
    const msg = await this.fetchMessage(channel, this.messageId);
    if (!msg) {
      const sent = await channel.send(formatLeaseMessage(this.payload));
      this.messageId = sent.id;
      return;
    }
    // Re-check we still own (another machine may have taken).
    const remote = parseBridgeLeaseMessage(msg.content);
    if (remote && remote.instanceId !== this.payload.instanceId) {
      this.owner = false;
      this.payload = remote;
      this.stopHeartbeat();
      console.log(
        `Bridge lease: lost to **${remote.host}** — entering standby. /bridge take to reclaim.`,
      );
      return;
    }
    await msg.edit(formatLeaseMessage(this.payload));
  }

  private async fetchChannel(channelId: string): Promise<LeaseChannel> {
    const ch = await this.client.channels.fetch(channelId);
    if (!ch || !("messages" in ch) || typeof (ch as TextChannel).isTextBased !== "function") {
      throw new Error(`BRIDGE_LEASE_CHANNEL_ID ${channelId} is not a text channel`);
    }
    const text = ch as TextChannel;
    if (!text.isTextBased()) {
      throw new Error(`BRIDGE_LEASE_CHANNEL_ID ${channelId} is not a text channel`);
    }
    return text as unknown as LeaseChannel;
  }

  private async findLeaseMessage(channel: LeaseChannel): Promise<LeaseMessage | null> {
    const fetched = await channel.messages.fetch({ limit: 50 });
    const list =
      fetched instanceof Map
        ? [...fetched.values()]
        : Array.isArray(fetched)
          ? fetched
          : typeof fetched === "object" && fetched && "content" in fetched
            ? [fetched as LeaseMessage]
            : [...(fetched as Iterable<LeaseMessage>)];
    for (const msg of list) {
      if (typeof msg.content === "string" && msg.content.includes(BRIDGE_LEASE_MARKER)) {
        return msg;
      }
    }
    return null;
  }

  private async fetchMessage(
    channel: LeaseChannel,
    messageId: string,
  ): Promise<LeaseMessage | null> {
    try {
      const msg = await channel.messages.fetch(messageId);
      if (msg && typeof msg === "object" && "content" in msg) {
        return msg as LeaseMessage;
      }
      return null;
    } catch {
      return null;
    }
  }
}

export function resolveBridgeHost(envHost?: string | null): string {
  const trimmed = envHost?.trim();
  return trimmed || osHostname();
}
