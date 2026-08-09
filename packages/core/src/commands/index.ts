import type { ConversationManager } from "../conversation/index.js";
import type { BusyRun } from "../cursor/runner-pool.js";
import { parsePlanApprovalIntent } from "../orchestration/plan-first.js";
import type { ProjectStore, ResolvedProject } from "../projects/index.js";
import {
  buildBusyStatusMessage,
  buildIdleStatusMessage,
  buildMultiAgentStatusMessage,
} from "./status-messages.js";

export interface AgentRunStatus {
  busy: BusyRun[];
  queuedCount: number;
  queueDepths?: { projectKey: string; workspace: string; depth: number }[];
}

export interface CommandContext {
  /** Only for listing the configured projects in help copy. */
  projects: ProjectStore;
  /** Project this message belongs to, from the chat surface it arrived on. */
  project: ResolvedProject;
  getRunStatus: () => AgentRunStatus;
  /** Stop the run in `project`; false when it wasn't running. */
  stopProject: () => boolean;
  stopAllRuns: () => void;
  /** Clear `project`'s prompt queue; returns how many items were dropped. */
  clearProjectQueue: () => number;
  /** Clear every directory queue; returns how many items were dropped. */
  clearAllQueues: () => number;
  raw: string;
  conversations?: ConversationManager;
  /**
   * Optional transport conversation id (e.g. Discord thread). Used with
   * project key to isolate Cursor sessions per chat surface.
   */
  conversationKey?: string;
  /** Discord (or other) surface for contextual help copy. */
  surface?: "general" | "project";
}

export function sessionStorageKey(projectKey: string, conversationKey?: string): string {
  if (!conversationKey) return projectKey;
  return `${projectKey}__${conversationKey}`;
}

export interface CommandResult {
  handled: boolean;
  reply?: string;
  /** True when the message should be forwarded to Cursor Agent */
  passToAgent?: boolean;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function stripSlash(text: string): string {
  return text.startsWith("/") ? text.slice(1).trim() : text;
}

export function buildGreetingMessage(
  opts: { surface?: "general" | "project"; projectKey?: string } = {},
): string {
  if (opts.surface === "general") {
    return "Hey! Ask me anything, or say *projects* if you want to switch channels.";
  }
  if (opts.projectKey) {
    return `Hey! You're in *${opts.projectKey.toUpperCase()}* — what do you need?`;
  }
  return "Hey! What can I help with? Say *projects* when you want to pick one.";
}

export function buildHelpMessage(
  projects: ProjectStore,
  opts: { surface?: "general" | "project"; projectKey?: string } = {},
): string {
  const projectLine =
    opts.surface === "general"
      ? "You're in *GENERAL* — open questions land here; project work happens in that project's channel."
      : opts.projectKey
        ? `You're locked to *${opts.projectKey.toUpperCase()}* in this channel.`
        : "You're in *GENERAL*.";

  return [
    "Hey — you can talk to Cursor right here.",
    "",
    projectLine,
    "",
    opts.surface === "general"
      ? "Ask anything general, or say *switch to <project>* and I'll send you to its channel."
      : "Just text me what you want done, or send a screenshot.",
    "",
    "*Projects:* say *switch to <name>* (or reply with its number):",
    projects.formatPicker(),
    "",
    "You can also say things like:",
    '• "switch to cliproom" (from general → opens that channel)',
    '• "general" / switch to general',
    '• "what project am I on?"',
    '• "new chat" to start a fresh Cursor thread',
    "• Big tasks ask you to enter *plan* mode first — then react ✅ or say *go*",
    '• "status" / "stop" / "stop all"',
    "• `/preview` — public tunnel to the local dev server (works from your phone)",
    "• `/preview_pick` — same, with the AI element picker open (click → Copy → paste here)",
    "• `/preview_stop` — close that tunnel",
  ].join("\n");
}

function buildProjectList(projects: ProjectStore, intro: string): string {
  return [
    intro,
    "",
    projects.formatPicker(),
    "",
    "Say *switch to <name>*, or reply with a number, and I'll take you to its channel.",
  ].join("\n");
}

/**
 * Conversational message handler. Slash commands still work as shortcuts.
 * Returns passToAgent when the text should go to Cursor.
 *
 * Every branch acts on `ctx.project` — the project of the surface this message
 * arrived on — so two channels can be handled concurrently without crosstalk.
 */
export function handleUserMessage(ctx: CommandContext): CommandResult {
  const text = normalize(ctx.raw);
  if (!text) return { handled: true };

  const body = stripSlash(text);
  const lower = body.toLowerCase();
  const project = ctx.project;

  // Cancel a waiting plan / large-prompt hold (approve/"go"/"plan" handled in router)
  const planIntent = parsePlanApprovalIntent(body);
  if (planIntent?.kind === "cancel") {
    if (!ctx.projects.clearPendingForProject(project.key)) {
      return { handled: true, reply: "No plan waiting to cancel." };
    }
    return { handled: true, reply: "Cleared the pending plan." };
  }

  // New chat / start fresh — before greetings so "start fresh" isn't treated as help
  if (/^(new chat|start fresh|reset chat|clear chat|fresh chat)\b/i.test(lower)) {
    if (!ctx.conversations) {
      return {
        handled: true,
        reply: "I can't reset the chat right now — try again in a moment.",
      };
    }
    const cleared = ctx.conversations.clearProjectSessions(project.key);
    // Also clear the exact key for this surface (covers non-prefixed legacy).
    ctx.conversations.setChatId(sessionStorageKey(project.key, ctx.conversationKey), null);
    ctx.projects.clearPendingForProject(project.key);
    return {
      handled: true,
      reply:
        cleared > 1
          ? `Clean slate for *${project.key.toUpperCase()}* — cleared ${cleared} chat sessions. Next message starts fresh.`
          : `Clean slate for *${project.key.toUpperCase()}* — next message starts a fresh Cursor chat.`,
    };
  }

  // Short greetings — natural reply only; project list on explicit ask
  if (/^(hi|hello|hey|yo|sup)[!?.]*$/i.test(lower) || /^hey there[!?.]*$/i.test(lower)) {
    return {
      handled: true,
      reply: buildGreetingMessage({ surface: ctx.surface, projectKey: project.key }),
    };
  }

  // Help / menu ("start" alone — not "start fresh")
  if (/^(help|menu)$/i.test(lower) || /^what can you do\b/i.test(lower) || /^start$/i.test(lower)) {
    return {
      handled: true,
      reply: buildHelpMessage(ctx.projects, {
        surface: ctx.surface,
        projectKey: project.key,
      }),
    };
  }

  // Show the project list
  if (
    /^(projects|list projects|show projects|switch project|change project|choose project)\b/i.test(
      lower,
    )
  ) {
    return {
      handled: true,
      reply: buildProjectList(ctx.projects, "Sure — here's what I've got:"),
    };
  }

  // Which project is this surface bound to
  if (/^(current|where am i|which project|what project)/i.test(lower)) {
    return {
      handled: true,
      reply: `You're in *${project.key.toUpperCase()}*\n${project.displayPath}`,
    };
  }

  // Status / are you working
  if (/^(status|are you (still )?working|you there|still working)\??$/i.test(lower)) {
    const status = ctx.getRunStatus();
    if (status.busy.length === 0 && status.queuedCount === 0) {
      return { handled: true, reply: buildIdleStatusMessage() };
    }
    if (status.busy.length === 1 && status.queuedCount === 0) {
      const only = status.busy[0]!;
      if (only.projectKey === project.key) {
        return { handled: true, reply: buildBusyStatusMessage(project.key) };
      }
    }
    return {
      handled: true,
      reply: buildMultiAgentStatusMessage(
        status.busy,
        status.queueDepths && status.queueDepths.length > 0
          ? status.queueDepths
          : status.queuedCount,
      ),
    };
  }

  // Stop all — cancel every run and clear all queues
  if (/^(stop all|cancel all)\b/i.test(lower)) {
    const cleared = ctx.clearAllQueues();
    const wasBusy = ctx.getRunStatus().busy.length > 0;
    ctx.stopAllRuns();
    if (wasBusy) {
      return {
        handled: true,
        reply:
          cleared > 0
            ? `Okay, stopping all agents and clearing ${cleared} queued task${cleared === 1 ? "" : "s"}…`
            : "Okay, stopping all agents…",
      };
    }
    if (cleared > 0) {
      return {
        handled: true,
        reply: `Cleared ${cleared} queued task${cleared === 1 ? "" : "s"}. Nothing's running.`,
      };
    }
    return { handled: true, reply: "Nothing's running right now." };
  }

  // Stop this project's run and queue
  if (/^(stop|cancel|never ?mind)\b/i.test(lower)) {
    const status = ctx.getRunStatus();
    const projectBusy = status.busy.some((b) => b.workspace === project.path);
    const cleared = ctx.clearProjectQueue();
    if (projectBusy) {
      ctx.stopProject();
      return {
        handled: true,
        reply:
          cleared > 0
            ? `Okay, stopping *${project.key.toUpperCase()}* and clearing ${cleared} queued task${cleared === 1 ? "" : "s"}…`
            : "Okay, stopping that…",
      };
    }
    if (cleared > 0) {
      return {
        handled: true,
        reply: `Cleared ${cleared} queued task${cleared === 1 ? "" : "s"} for *${project.key.toUpperCase()}*.`,
      };
    }
    // Bare "cancel" with a waiting plan/large-prompt — clear it (exact "cancel plan" handled above).
    if (/^cancel\b/i.test(lower) && ctx.projects.clearPendingForProject(project.key)) {
      return { handled: true, reply: "Cleared the pending plan." };
    }
    if (status.busy.length > 0) {
      const others = status.busy.map((b) => b.projectKey.toUpperCase()).join(", ");
      return {
        handled: true,
        reply: `Nothing running in *${project.key.toUpperCase()}* — still working in ${others}. Say *stop all* to cancel everything.`,
      };
    }
    return { handled: true, reply: "Nothing's running right now." };
  }

  // Unknown slash command
  if (text.startsWith("/")) {
    return {
      handled: true,
      reply: `Hmm, I'm not sure what that means.\n\n${buildHelpMessage(ctx.projects, {
        surface: ctx.surface,
        projectKey: project.key,
      })}`,
    };
  }

  // Normal prompt → Cursor
  return { handled: false, passToAgent: true };
}
