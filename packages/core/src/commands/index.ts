import type { ConversationManager } from "../conversation/index.js";
import type { BusyRun } from "../cursor/runner-pool.js";
import { parsePlanApprovalIntent } from "../orchestration/plan-first.js";
import type { ProjectStore } from "../projects/index.js";
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
  projects: ProjectStore;
  getRunStatus: () => AgentRunStatus;
  stopCurrent: () => boolean;
  stopAllRuns: () => void;
  /** Clear the current project's prompt queue; returns how many items were dropped. */
  clearCurrentQueue: () => number;
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
  projects: ProjectStore,
  opts: { surface?: "general" | "project" } = {}
): string {
  const current = projects.getCurrent();
  const surface = opts.surface;

  if (surface === "general") {
    return "Hey! Ask me anything, or say *projects* if you want to switch channels.";
  }
  if (surface === "project" && current) {
    return `Hey! You're in *${current.key.toUpperCase()}* — what do you need?`;
  }
  if (current) {
    return `Hey! You're in *${current.key.toUpperCase()}* — what do you need?`;
  }
  return "Hey! What can I help with? Say *projects* when you want to pick one.";
}

export function buildHelpMessage(
  projects: ProjectStore,
  opts: { surface?: "general" | "project" } = {}
): string {
  const current = projects.getCurrent();
  const surface = opts.surface;
  const projectLine =
    surface === "general"
      ? "You're in *GENERAL* — open questions land here; project work happens in that project's channel."
      : surface === "project" && current
        ? `You're locked to *${current.key.toUpperCase()}* in this channel.`
        : current
          ? `You're in *${current.key.toUpperCase()}* right now.`
          : "You haven't picked a project yet.";

  return [
    "Hey — you can talk to Cursor right here.",
    "",
    projectLine,
    "",
    surface === "general"
      ? "Ask anything general, or say *switch to <project>* and I'll send you to its channel."
      : "Just text me what you want done, or send a screenshot.",
    "",
    "*Projects:* reply with a number or the name:",
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

function buildProjectPrompt(projects: ProjectStore, intro?: string): string {
  return [
    intro ?? "Which project should I use?",
    "",
    projects.formatPicker(),
    "",
    "Reply with a number or the project name.",
  ].join("\n");
}

function tryPickProject(
  projects: ProjectStore,
  raw: string,
  opts: { allowNumber: boolean }
): CommandResult | null {
  const text = normalize(raw);

  if (opts.allowNumber && /^\d+$/.test(text)) {
    const picked = projects.pickByNumber(Number(text));
    if (!picked) {
      return {
        handled: true,
        reply: `That number isn't on the list.\n\n${buildProjectPrompt(projects)}`,
      };
    }
    return {
      handled: true,
      reply: `Got it — working in *${picked.key.toUpperCase()}* now.\n\nWhat do you need?`,
    };
  }

  if (projects.resolve(text)) {
    const set = projects.setCurrent(text)!;
    return {
      handled: true,
      reply: `Got it — working in *${set.key.toUpperCase()}* now.\n\nWhat do you need?`,
    };
  }

  const switchMatch = text.match(
    /^(?:switch\s+to|use|go\s+to|open|project)\s+(.+)$/i
  );
  if (switchMatch?.[1]) {
    const name = switchMatch[1].trim();
    const set = projects.setCurrent(name);
    if (!set) {
      projects.setAwaitingProjectPick(true);
      return {
        handled: true,
        reply: `I don't have a project called "${name}".\n\n${buildProjectPrompt(projects)}`,
      };
    }
    return {
      handled: true,
      reply: `Switched to *${set.key.toUpperCase()}*.\n\nWhat do you need?`,
    };
  }

  return null;
}

/**
 * Conversational message handler. Slash commands still work as shortcuts.
 * Returns passToAgent when the text should go to Cursor.
 */
export function handleUserMessage(ctx: CommandContext): CommandResult {
  const text = normalize(ctx.raw);
  if (!text) return { handled: true };

  const body = stripSlash(text);
  const lower = body.toLowerCase();

  // Awaiting a project choice (from help / picker / no-project prompt)
  if (ctx.projects.isAwaitingProjectPick()) {
    const picked = tryPickProject(ctx.projects, body, { allowNumber: true });
    if (picked) return picked;

    // Already in a project and this looks like a real prompt → drop out of pick mode
    if (ctx.projects.getCurrent()) {
      ctx.projects.setAwaitingProjectPick(false);
    } else {
      return {
        handled: true,
        reply: `Still need a project first.\n\n${buildProjectPrompt(ctx.projects)}`,
      };
    }
  }

  // Cancel a waiting plan / large-prompt hold (approve/"go"/"plan" handled in router)
  const planIntent = parsePlanApprovalIntent(body);
  if (planIntent?.kind === "cancel") {
    const current = ctx.projects.getCurrent();
    if (!current || !ctx.projects.clearPendingForProject(current.key)) {
      return { handled: true, reply: "No plan waiting to cancel." };
    }
    return { handled: true, reply: "Cleared the pending plan." };
  }

  // New chat / start fresh — before greetings so "start fresh" isn't treated as help
  if (/^(new chat|start fresh|reset chat|clear chat|fresh chat)\b/i.test(lower)) {
    const current = ctx.projects.getCurrent();
    if (!current) {
      ctx.projects.setAwaitingProjectPick(true);
      return {
        handled: true,
        reply: buildProjectPrompt(ctx.projects, "Pick a project first, then we can start a new chat."),
      };
    }
    if (!ctx.conversations) {
      return {
        handled: true,
        reply: "I can't reset the chat right now — try again in a moment.",
      };
    }
    const cleared = ctx.conversations.clearProjectSessions(current.key);
    // Also clear the exact key for this surface (covers non-prefixed legacy).
    ctx.conversations.setChatId(
      sessionStorageKey(current.key, ctx.conversationKey),
      null
    );
    ctx.projects.clearPendingForProject(current.key);
    return {
      handled: true,
      reply:
        cleared > 1
          ? `Clean slate for *${current.key.toUpperCase()}* — cleared ${cleared} chat sessions. Next message starts fresh.`
          : `Clean slate for *${current.key.toUpperCase()}* — next message starts a fresh Cursor chat.`,
    };
  }

  // Short greetings — natural reply only; project list on explicit ask
  if (/^(hi|hello|hey|yo|sup)[!?.]*$/i.test(lower) || /^hey there[!?.]*$/i.test(lower)) {
    return {
      handled: true,
      reply: buildGreetingMessage(ctx.projects, { surface: ctx.surface }),
    };
  }

  // Help / menu ("start" alone — not "start fresh")
  if (
    /^(help|menu)$/i.test(lower) ||
    /^what can you do\b/i.test(lower) ||
    /^start$/i.test(lower)
  ) {
    ctx.projects.setAwaitingProjectPick(true);
    return {
      handled: true,
      reply: buildHelpMessage(ctx.projects, { surface: ctx.surface }),
    };
  }

  // Show / change project picker
  if (
    /^(projects|list projects|show projects|switch project|change project|choose project)\b/i.test(
      lower
    )
  ) {
    ctx.projects.setAwaitingProjectPick(true);
    return {
      handled: true,
      reply: buildProjectPrompt(ctx.projects, "Sure — which project?"),
    };
  }

  // Current project
  if (/^(current|where am i|which project|what project)/i.test(lower)) {
    const current = ctx.projects.getCurrent();
    if (!current) {
      ctx.projects.setAwaitingProjectPick(true);
      return {
        handled: true,
        reply: buildProjectPrompt(ctx.projects, "You haven't picked one yet."),
      };
    }
    return {
      handled: true,
      reply: `You're in *${current.key.toUpperCase()}*\n${current.displayPath}`,
    };
  }

  // Status / are you working
  if (
    /^(status|are you (still )?working|you there|still working)\??$/i.test(lower)
  ) {
    const status = ctx.getRunStatus();
    if (status.busy.length === 0 && status.queuedCount === 0) {
      return { handled: true, reply: buildIdleStatusMessage() };
    }
    const current = ctx.projects.getCurrent();
    if (status.busy.length === 1 && status.queuedCount === 0 && current) {
      const only = status.busy[0]!;
      if (only.projectKey === current.key) {
        return {
          handled: true,
          reply: buildBusyStatusMessage(current.key),
        };
      }
    }
    return {
      handled: true,
      reply: buildMultiAgentStatusMessage(
        status.busy,
        status.queueDepths && status.queueDepths.length > 0
          ? status.queueDepths
          : status.queuedCount
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

  // Stop current project's run and queue
  if (/^(stop|cancel|never ?mind)\b/i.test(lower)) {
    const current = ctx.projects.getCurrent();
    if (!current) {
      return { handled: true, reply: "Nothing's running right now." };
    }
    const status = ctx.getRunStatus();
    const currentBusy = status.busy.some((b) => b.workspace === current.path);
    const cleared = ctx.clearCurrentQueue();
    if (currentBusy) {
      ctx.stopCurrent();
      return {
        handled: true,
        reply:
          cleared > 0
            ? `Okay, stopping *${current.key.toUpperCase()}* and clearing ${cleared} queued task${cleared === 1 ? "" : "s"}…`
            : "Okay, stopping that…",
      };
    }
    if (cleared > 0) {
      return {
        handled: true,
        reply: `Cleared ${cleared} queued task${cleared === 1 ? "" : "s"} for *${current.key.toUpperCase()}*.`,
      };
    }
    // Bare "cancel" with a waiting plan/large-prompt — clear it (exact "cancel plan" handled above).
    if (/^cancel\b/i.test(lower) && ctx.projects.clearPendingForProject(current.key)) {
      return { handled: true, reply: "Cleared the pending plan." };
    }
    if (status.busy.length > 0) {
      const others = status.busy.map((b) => b.projectKey.toUpperCase()).join(", ");
      return {
        handled: true,
        reply: `Nothing running in *${current.key.toUpperCase()}* — still working in ${others}. Say *stop all* to cancel everything.`,
      };
    }
    return { handled: true, reply: "Nothing's running right now." };
  }

  // Explicit project switch / bare name (numbers only via picker mode)
  const picked = tryPickProject(ctx.projects, body, { allowNumber: false });
  if (picked) return picked;

  // Unknown slash command
  if (text.startsWith("/")) {
    ctx.projects.setAwaitingProjectPick(true);
    return {
      handled: true,
      reply: `Hmm, I'm not sure what that means.\n\n${buildHelpMessage(ctx.projects)}`,
    };
  }

  // No project selected → prompt to choose instead of running Cursor
  if (!ctx.projects.getCurrent()) {
    ctx.projects.setAwaitingProjectPick(true);
    return {
      handled: true,
      reply: buildProjectPrompt(
        ctx.projects,
        "Quick one first — which project is this for?"
      ),
    };
  }

  // Normal prompt → Cursor
  return { handled: false, passToAgent: true };
}
