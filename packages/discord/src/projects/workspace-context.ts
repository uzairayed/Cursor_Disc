import type { ProjectChannelRegistry } from "./project-channels.js";

export type WorkspaceMode = "general" | "project";

export interface WorkspaceContext {
  mode: WorkspaceMode;
  /** Project key bound to this surface (`general` or a real project). */
  projectKey: string;
  /** True when this Discord channel is locked to a single project. */
  locked: boolean;
}

/**
 * DMs + non-project channels → general.
 * Registered project channels (and their threads) → locked to that project.
 */
export function resolveWorkspaceContext(opts: {
  isDm: boolean;
  guildId: string | null;
  channelId: string;
  parentChannelId?: string | null;
  projectChannels: ProjectChannelRegistry;
}): WorkspaceContext {
  if (opts.isDm) {
    return { mode: "general", projectKey: "general", locked: false };
  }

  const projectKey = opts.projectChannels.findProjectByChannelId(
    opts.guildId,
    opts.channelId,
    opts.parentChannelId,
  );

  if (projectKey && projectKey !== "general") {
    return { mode: "project", projectKey, locked: true };
  }

  // #general (registered) or any other allowlisted non-project channel
  return { mode: "general", projectKey: "general", locked: false };
}

export function buildGeneralModeBanner(): string {
  return [
    "You're in **GENERAL** — good for questions, ideas, and anything not tied to one repo.",
    "Project work only happens in that project's channel. Say `switch to <project>` and I'll point you there.",
  ].join("\n");
}

export function buildProjectModeBanner(projectKey: string): string {
  const name = projectKey.toUpperCase();
  return [
    `You're in **${name}** — this channel is locked to that project.`,
    "For general questions, use `#general` or DM me. To work on another project, open its channel.",
  ].join("\n");
}

export function buildProjectRedirectMessage(opts: {
  projectKey: string;
  channelId: string;
  created: boolean;
}): string {
  const name = opts.projectKey.toUpperCase();
  const createdLine = opts.created
    ? `Created <#${opts.channelId}> for **${name}**.`
    : `**${name}** lives in <#${opts.channelId}>.`;
  return [
    createdLine,
    "",
    `Continue there — I'll only run **${name}** work in that channel.`,
    "This chat stays on **GENERAL** for open-ended prompts.",
  ].join("\n");
}

export function buildProjectLockedMessage(opts: {
  channelProjectKey: string;
  requestedKey: string;
  requestedChannelId?: string | null;
}): string {
  const here = opts.channelProjectKey.toUpperCase();
  const want = opts.requestedKey.toUpperCase();
  if (opts.requestedKey === "general") {
    return `This channel is **${here}** only. For general chat, use \`#general\` or DM me.`;
  }
  if (opts.requestedChannelId) {
    return `This channel is **${here}** only. For **${want}**, go to <#${opts.requestedChannelId}>.`;
  }
  return `This channel is **${here}** only. Open the **${want}** channel for that project.`;
}

/** Allowlisted user, but the channel belongs to another machine (or none here). */
export function buildForeignDeviceMessage(opts: {
  localHost: string;
  remoteHost?: string | null;
  projectKey?: string | null;
}): string {
  const local = opts.localHost;
  if (opts.remoteHost) {
    const where = opts.projectKey
      ? `**${opts.projectKey.toUpperCase()}** lives on **${opts.remoteHost}**`
      : `This channel belongs to **${opts.remoteHost}**`;
    return [
      `${where}, which is offline.`,
      `This bridge is **${local}**. Bring that machine online and use \`/bridge take\` there.`,
    ].join("\n");
  }
  return [
    `This channel isn't available on **${local}**.`,
    "If the project lives on another machine, bring it online and use `/bridge take` there.",
  ].join("\n");
}
