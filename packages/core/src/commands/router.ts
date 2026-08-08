import type {
  DeliveryContext,
  QueuedRunOptions,
} from "../channels/types.js";
import type { AppConfig } from "../config/index.js";
import { ConversationManager } from "../conversation/index.js";
import type { CursorExecutionMode } from "../cursor/runner.js";
import { CursorRunnerPool } from "../cursor/runner-pool.js";
import { RunLogger } from "../logger/index.js";
import {
  buildImplementPrompt,
  formatAskPlanModeReply,
  parsePlanApprovalIntent,
  shouldPlanFirst,
  wrapPromptForPlan,
} from "../orchestration/plan-first.js";
import { ProjectStore } from "../projects/index.js";
import { DirectoryQueues } from "./directory-queues.js";
import { generalExecutionMode } from "./general-mode.js";
import { handleUserMessage } from "./index.js";
import {
  MAX_CONCURRENT,
  QUEUE_CAP,
  RunLifecycle,
  type RunTarget,
} from "./run-lifecycle.js";

export class MessageRouter {
  readonly projects: ProjectStore;
  readonly conversations: ConversationManager;
  readonly runners = new CursorRunnerPool(MAX_CONCURRENT);
  readonly queues = new DirectoryQueues(QUEUE_CAP);
  readonly logger: RunLogger;
  private readonly lifecycle: RunLifecycle;

  constructor(private readonly config: AppConfig) {
    this.projects = new ProjectStore(config);
    this.conversations = new ConversationManager(config.historyDir);
    this.logger = new RunLogger(config.logsDir);
    this.lifecycle = new RunLifecycle(
      config,
      this.projects,
      this.conversations,
      this.runners,
      this.queues,
      this.logger
    );
  }

  async handle(
    text: string,
    delivery: DeliveryContext,
    opts: {
      /** Force Cursor CLI mode (e.g. Discord /ask → read-only ask). */
      executionMode?: CursorExecutionMode;
      skipPlanFirst?: boolean;
    } = {}
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    // General: ask for chat; agent when live search is needed (ask blocks web).
    if (!opts.executionMode && delivery.surface === "general") {
      opts = {
        ...opts,
        executionMode: generalExecutionMode(trimmed),
        skipPlanFirst: true,
      };
    }

    // Slash /ask (and similar) — skip plan-gate and run read-only ask mode.
    if (opts.executionMode === "ask") {
      const current = this.projects.getCurrent();
      if (!current) {
        this.projects.setAwaitingProjectPick(true);
        await delivery.reply(
          delivery.formatOutput(
            `Quick one first — which project is this for?\n\n${this.projects.formatPicker()}\n\nReply with a number or the project name.`
          )
        );
        return;
      }
      const target = this.toRunTarget(current);
      const runOpts: QueuedRunOptions = {
        skipPlanFirst: true,
        executionMode: "ask",
      };
      const queued = await this.lifecycle.tryQueue(trimmed, delivery, target, runOpts);
      if (queued !== "idle") return;
      await this.lifecycle.runPrompt(trimmed, delivery, target, runOpts);
      return;
    }

    const planIntent = parsePlanApprovalIntent(trimmed);

    if (planIntent?.kind === "enter_plan") {
      await this.consumePendingLargePrompt(delivery, "plan");
      return;
    }

    if (planIntent?.kind === "run_anyway") {
      await this.consumePendingLargePrompt(delivery, "run");
      return;
    }

    if (planIntent?.kind === "approve") {
      const pendingPlan = this.projects.getPendingPlan();
      if (!pendingPlan) {
        // *go* while a large prompt is waiting → enter plan mode (recommended path).
        const large = this.projects.getPendingLargePrompt();
        if (large) {
          await this.consumePendingLargePrompt(delivery, "plan");
          return;
        }
        await delivery.reply(
          delivery.formatOutput(
            "No plan waiting — send a task first (big ones ask you to enter plan mode)."
          )
        );
        return;
      }
      if (!(await this.ensureProjectMatches(pendingPlan.projectKey, delivery))) return;
      const target = this.projectTarget(pendingPlan.projectKey);
      if (!target) return;

      const implementBody = buildImplementPrompt(pendingPlan);
      const runOpts: QueuedRunOptions = {
        skipPlanFirst: true,
        executionMode: "agent",
        cursorPrompt: implementBody,
        // Plan chat is done — implement in a fresh Cursor session with the plan text.
        freshSession: true,
      };
      const queued = await this.lifecycle.tryQueue(implementBody, delivery, target, runOpts);
      if (queued === "full") return;
      this.projects.setPendingPlan(null, pendingPlan.projectKey);
      if (queued === "queued") return;
      await this.lifecycle.runPrompt(implementBody, delivery, target, runOpts);
      return;
    }

    const command = handleUserMessage({
      projects: this.projects,
      getRunStatus: () => this.getRunStatus(),
      stopCurrent: () => {
        const current = this.projects.getCurrent();
        if (!current) return false;
        return this.runners.stop(current.path);
      },
      stopAllRuns: () => {
        this.runners.stopAll();
      },
      clearCurrentQueue: () => {
        const current = this.projects.getCurrent();
        if (!current) return 0;
        return this.queues.clear(current.path);
      },
      clearAllQueues: () => this.queues.clearAll(),
      raw: trimmed,
      conversations: this.conversations,
      conversationKey: delivery.conversationKey,
      surface: delivery.surface,
    });

    if (command.handled) {
      if (command.reply) {
        await delivery.reply(delivery.formatOutput(command.reply));
      }
      return;
    }

    const current = this.projects.getCurrent();
    if (!current) {
      this.projects.setAwaitingProjectPick(true);
      await delivery.reply(
        delivery.formatOutput(
          `Quick one first — which project is this for?\n\n${this.projects.formatPicker()}\n\nReply with a number or the project name.`
        )
      );
      return;
    }

    const target = this.toRunTarget(current);
    const queued = await this.lifecycle.tryQueue(trimmed, delivery, target);
    if (queued !== "idle") return;

    // Big prompt → ask user to enter plan mode (don't auto-run).
    if (!opts.skipPlanFirst && shouldPlanFirst(trimmed)) {
      this.projects.setPendingLargePrompt({
        projectKey: current.key,
        userPrompt: trimmed,
        conversationKey: delivery.conversationKey,
      });
      await delivery.reply(delivery.formatOutput(formatAskPlanModeReply()));
      return;
    }

    await this.lifecycle.runPrompt(trimmed, delivery, target, {
      executionMode: opts.executionMode,
      skipPlanFirst: opts.skipPlanFirst,
    });
  }

  /** Admit a held large prompt as plan-mode or agent run; keep hold if queue is full. */
  private async consumePendingLargePrompt(
    delivery: DeliveryContext,
    mode: "plan" | "run"
  ): Promise<void> {
    const pending = this.projects.getPendingLargePrompt();
    if (!pending) {
      await delivery.reply(
        delivery.formatOutput(
          mode === "plan"
            ? "Nothing waiting for plan mode — send a task first. Big prompts get this prompt automatically."
            : "Nothing waiting to run — send a task first."
        )
      );
      return;
    }
    if (!(await this.ensureProjectMatches(pending.projectKey, delivery))) return;
    const target = this.projectTarget(pending.projectKey);
    if (!target) return;

    const userPrompt = pending.userPrompt;
    const runOpts: QueuedRunOptions =
      mode === "plan"
        ? {
            skipPlanFirst: true,
            executionMode: "plan",
            cursorPrompt: wrapPromptForPlan(userPrompt),
            userPromptForPlan: userPrompt,
          }
        : { skipPlanFirst: true };

    const queued = await this.lifecycle.tryQueue(userPrompt, delivery, target, runOpts);
    if (queued === "full") return;
    this.projects.setPendingLargePrompt(null, pending.projectKey);
    if (queued === "queued") return;
    await this.lifecycle.runPrompt(userPrompt, delivery, target, runOpts);
  }

  private toRunTarget(project: { key: string; path: string }): RunTarget {
    return { projectKey: project.key, workspace: project.path };
  }

  private getRunStatus() {
    return {
      busy: this.runners.listBusy(),
      queuedCount: this.queues.totalSize(),
      queueDepths: this.queues.queueDepths().map((q) => {
        const busy = this.runners.listBusy().find((b) => b.workspace === q.workspace);
        return {
          projectKey: busy?.projectKey ?? this.projectKeyForWorkspace(q.workspace),
          workspace: q.workspace,
          depth: q.depth,
        };
      }),
    };
  }

  private projectKeyForWorkspace(workspace: string): string {
    for (const key of this.projects.list()) {
      const resolved = this.projects.resolve(key);
      if (resolved?.path === workspace) return resolved.key;
    }
    return workspace;
  }

  private projectTarget(projectKey: string): RunTarget | null {
    const resolved = this.projects.resolve(projectKey);
    if (!resolved) return null;
    return { projectKey: resolved.key, workspace: resolved.path };
  }

  private async ensureProjectMatches(
    projectKey: string,
    delivery: DeliveryContext
  ): Promise<boolean> {
    const current = this.projects.getCurrent();
    if (!current) {
      this.projects.setAwaitingProjectPick(true);
      await delivery.reply(
        delivery.formatOutput(
          `Quick one first — which project is this for?\n\n${this.projects.formatPicker()}\n\nReply with a number or the project name.`
        )
      );
      return false;
    }
    if (projectKey !== current.key) {
      await delivery.reply(
        delivery.formatOutput(
          `That was for *${projectKey.toUpperCase()}*. Switch back there, or say *cancel plan*.`
        )
      );
      return false;
    }
    return true;
  }
}
