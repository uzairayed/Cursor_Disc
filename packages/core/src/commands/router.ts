import type { DeliveryContext, QueuedRunOptions } from "../channels/types.js";
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
import { ProjectStore, type ResolvedProject } from "../projects/index.js";
import { DirectoryQueues } from "./directory-queues.js";
import { generalExecutionMode } from "./general-mode.js";
import { handleUserMessage } from "./index.js";
import { QUEUE_CAP, RunLifecycle, type RunTarget } from "./run-lifecycle.js";

export class MessageRouter {
  readonly projects: ProjectStore;
  readonly conversations: ConversationManager;
  readonly runners: CursorRunnerPool;
  readonly queues = new DirectoryQueues(QUEUE_CAP);
  readonly logger: RunLogger;
  private readonly lifecycle: RunLifecycle;

  constructor(config: AppConfig) {
    this.runners = new CursorRunnerPool(config.cursorMaxConcurrent);
    this.projects = new ProjectStore(config);
    this.conversations = new ConversationManager(config.historyDir);
    this.logger = new RunLogger(config.logsDir);
    this.lifecycle = new RunLifecycle(
      config,
      this.projects,
      this.conversations,
      this.runners,
      this.queues,
      this.logger,
    );
  }

  async handle(
    text: string,
    delivery: DeliveryContext,
    opts: {
      /** Force Cursor CLI mode (e.g. Discord /ask → read-only ask). */
      executionMode?: CursorExecutionMode;
      skipPlanFirst?: boolean;
    } = {},
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    // The surface decides the project; nothing here reads a shared current.
    const project = this.projects.resolve(delivery.projectKey);
    if (!project) {
      await delivery.reply(
        delivery.formatOutput(
          `I don't have a project called "${delivery.projectKey}" any more — check projects.json.\n\n${this.projects.formatPicker()}`,
        ),
      );
      return;
    }
    const target: RunTarget = { projectKey: project.key, workspace: project.path };

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
      const runOpts: QueuedRunOptions = { skipPlanFirst: true, executionMode: "ask" };
      const queued = await this.lifecycle.tryQueue(trimmed, delivery, target, runOpts);
      if (queued !== "idle") return;
      await this.lifecycle.runPrompt(trimmed, delivery, target, runOpts);
      return;
    }

    const planIntent = parsePlanApprovalIntent(trimmed);

    if (planIntent?.kind === "enter_plan") {
      await this.consumePendingLargePrompt(delivery, project, "plan");
      return;
    }

    if (planIntent?.kind === "run_anyway") {
      await this.consumePendingLargePrompt(delivery, project, "run");
      return;
    }

    if (planIntent?.kind === "approve") {
      const pendingPlan = this.projects.getPendingPlan(project.key);
      if (!pendingPlan) {
        // *go* while a large prompt is waiting → enter plan mode (recommended path).
        if (this.projects.getPendingLargePrompt(project.key)) {
          await this.consumePendingLargePrompt(delivery, project, "plan");
          return;
        }
        await delivery.reply(
          delivery.formatOutput(
            "No plan waiting — send a task first (big ones ask you to enter plan mode).",
          ),
        );
        return;
      }

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
      this.projects.clearPendingForProject(project.key);
      if (queued === "queued") return;
      await this.lifecycle.runPrompt(implementBody, delivery, target, runOpts);
      return;
    }

    const command = handleUserMessage({
      projects: this.projects,
      project,
      getRunStatus: () => this.getRunStatus(),
      stopProject: () => this.runners.stop(project.path),
      stopAllRuns: () => {
        this.runners.stopAll();
      },
      clearProjectQueue: () => this.queues.clear(project.path),
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

    const queued = await this.lifecycle.tryQueue(trimmed, delivery, target);
    if (queued !== "idle") return;

    // Big prompt → ask user to enter plan mode (don't auto-run).
    if (!opts.skipPlanFirst && shouldPlanFirst(trimmed)) {
      this.projects.setPendingLargePrompt({
        projectKey: project.key,
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
    project: ResolvedProject,
    mode: "plan" | "run",
  ): Promise<void> {
    const pending = this.projects.getPendingLargePrompt(project.key);
    if (!pending) {
      await delivery.reply(
        delivery.formatOutput(
          mode === "plan"
            ? "Nothing waiting for plan mode — send a task first. Big prompts get this prompt automatically."
            : "Nothing waiting to run — send a task first.",
        ),
      );
      return;
    }
    const target: RunTarget = { projectKey: project.key, workspace: project.path };

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
    this.projects.clearPendingForProject(project.key);
    if (queued === "queued") return;
    await this.lifecycle.runPrompt(userPrompt, delivery, target, runOpts);
  }

  private getRunStatus() {
    const busy = this.runners.listBusy();
    return {
      busy,
      queuedCount: this.queues.totalSize(),
      queueDepths: this.queues.queueDepths().map((q) => {
        const running = busy.find((b) => b.workspace === q.workspace);
        return {
          projectKey:
            running?.projectKey ?? this.projects.keyForWorkspace(q.workspace) ?? q.workspace,
          workspace: q.workspace,
          depth: q.depth,
        };
      }),
    };
  }
}
