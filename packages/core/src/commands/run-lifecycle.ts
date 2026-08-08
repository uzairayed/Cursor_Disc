import type {
  DeliveryContext,
  QueuedPrompt,
  QueuedRunOptions,
} from "../channels/types.js";
import type { AppConfig } from "../config/index.js";
import { ConversationManager } from "../conversation/index.js";
import {
  CursorBusyError,
  CursorNotFoundError,
  type CursorExecutionMode,
} from "../cursor/runner.js";
import { CursorRunnerPool } from "../cursor/runner-pool.js";
import { modelForExecutionMode } from "../cursor/model-for-mode.js";
import { shouldResumeCursorChat } from "../cursor/resume-policy.js";
import { RunLogger } from "../logger/index.js";
import {
  formatAskPlanModeReply,
  formatPlanReply,
  PLAN_APPROVAL_EMOJI,
  shouldPlanFirst,
} from "../orchestration/plan-first.js";
import { ProjectStore } from "../projects/index.js";
import { splitMessage } from "../utils/split.js";
import { DirectoryQueues } from "./directory-queues.js";
import { sessionStorageKey } from "./index.js";
import {
  createLiveProgressReporter,
  createProgressBoard,
  createProgressHeartbeat,
  formatLiveStepMessage,
  PROGRESS_INTERVALS_MS,
} from "./progress.js";
import {
  buildStoppedMessage,
  buildTimedOutMessage,
  buildWorkingMessage,
} from "./status-messages.js";
import { formatUsageFooter } from "./usage.js";

export const QUEUE_CAP = 5;
export const MAX_CONCURRENT = 3;

export interface RunTarget {
  projectKey: string;
  workspace: string;
}

export interface RunPromptOptions {
  executionMode?: CursorExecutionMode;
  cursorPrompt?: string;
  /** Skip the "ask to enter plan mode" gate. */
  skipPlanFirst?: boolean;
  /** Original user text when cursorPrompt is a wrapped/implement variant. */
  userPromptForPlan?: string;
  /** Clear stored chatId and skip --resume (e.g. implement after plan). */
  freshSession?: boolean;
  /** Slot already reserved via tryAcquire. */
  alreadyAcquired?: boolean;
}

/** Cursor run / queue / progress lifecycle extracted from MessageRouter. */
export class RunLifecycle {
  constructor(
    private readonly config: AppConfig,
    private readonly projects: ProjectStore,
    private readonly conversations: ConversationManager,
    readonly runners: CursorRunnerPool,
    readonly queues: DirectoryQueues,
    private readonly logger: RunLogger
  ) {}

  async tryQueue(
    trimmed: string,
    delivery: DeliveryContext,
    target: RunTarget,
    runOpts?: QueuedRunOptions
  ): Promise<"idle" | "queued" | "full"> {
    const { workspace, projectKey } = target;
    const workspaceBusy = this.runners.isBusy(workspace);
    const waitingForSlot = !workspaceBusy && !this.runners.hasCapacity();

    if (!workspaceBusy && !waitingForSlot) {
      return "idle";
    }

    const enqueued = this.queues.enqueue({
      prompt: trimmed,
      delivery,
      projectKey,
      workspace,
      runOpts,
    });

    if (!enqueued.ok) {
      await delivery.reply(
        delivery.formatOutput(
          `Queue is full (${QUEUE_CAP} tasks for this project) — wait for something to finish or say *stop all*.`
        )
      );
      return "full";
    }

    if (waitingForSlot) {
      const running = this.runners.listBusy().length;
      await delivery.reply(
        delivery.formatOutput(
          enqueued.position === 1
            ? `Queued — waiting for a free agent (${running} running, max ${MAX_CONCURRENT})`
            : `Queued — ${enqueued.position} tasks waiting for a free agent (${running} running)`
        )
      );
      return "queued";
    }

    const ahead = 1 + (enqueued.position - 1);
    await delivery.reply(
      delivery.formatOutput(
        ahead === 1 ? "Queued — 1 task ahead" : `Queued — ${ahead} tasks ahead`
      )
    );
    return "queued";
  }

  async runQueuedPrompt(item: QueuedPrompt): Promise<void> {
    const target = {
      projectKey: item.projectKey,
      workspace: item.workspace,
    };

    if (item.runOpts) {
      await this.runPrompt(item.prompt, item.delivery, target, {
        ...item.runOpts,
        alreadyAcquired: true,
      });
      return;
    }

    // Normal queued prompt — re-apply plan-first against the bound project.
    if (shouldPlanFirst(item.prompt)) {
      this.runners.markIdle(item.workspace);
      this.projects.setPendingLargePrompt({
        projectKey: item.projectKey,
        userPrompt: item.prompt,
        conversationKey: item.delivery.conversationKey,
      });
      await item.delivery.reply(
        item.delivery.formatOutput(formatAskPlanModeReply())
      );
      await this.drainAfterRun(item.workspace);
      return;
    }

    await this.runPrompt(item.prompt, item.delivery, target, {
      skipPlanFirst: true,
      alreadyAcquired: true,
    });
  }

  async drainAfterRun(preferredWorkspace: string): Promise<void> {
    const started: Promise<void>[] = [];
    let prefer = preferredWorkspace;

    while (this.runners.hasCapacity()) {
      let item: QueuedPrompt | null = null;

      if (prefer && !this.runners.isBusy(prefer)) {
        item = this.queues.dequeue(prefer);
      }
      if (!item) {
        item = this.queues.findNextIdleQueue((ws) => this.runners.isBusy(ws));
      }
      if (!item) break;

      if (!this.runners.tryAcquire(item.workspace, item.projectKey)) {
        this.queues.enqueueFront(item);
        break;
      }

      // Start concurrently up to remaining capacity; await as a batch below.
      started.push(this.runQueuedPrompt(item));
      prefer = "";
    }

    if (started.length > 0) {
      await Promise.all(started);
    }
  }

  async runPrompt(
    trimmed: string,
    delivery: DeliveryContext,
    target: RunTarget,
    opts: RunPromptOptions = {}
  ): Promise<void> {
    const { projectKey, workspace } = target;
    /** True once runAcquired owns (and will release) the slot. */
    let handedToRunner = false;

    if (!opts.alreadyAcquired) {
      if (!this.runners.tryAcquire(workspace, projectKey)) {
        const waitingForSlot = !this.runners.isBusy(workspace);
        const enqueued = this.queues.enqueue({
          prompt: trimmed,
          delivery,
          projectKey,
          workspace,
          runOpts: {
            executionMode: opts.executionMode,
            cursorPrompt: opts.cursorPrompt,
            skipPlanFirst: opts.skipPlanFirst,
            userPromptForPlan: opts.userPromptForPlan,
          },
        });
        if (enqueued.ok) {
          await delivery.reply(
            delivery.formatOutput(
              waitingForSlot
                ? `Queued — waiting for a free agent (${this.runners.listBusy().length} running, max ${MAX_CONCURRENT})`
                : "Queued — 1 task ahead"
            )
          );
        } else {
          await delivery.reply(
            delivery.formatOutput(
              `Queue is full (${QUEUE_CAP} tasks for this project) — wait for something to finish or say *stop all*.`
            )
          );
        }
        return;
      }
    }

    const progressBoard = createProgressBoard(delivery, { projectKey });

    if (delivery.react) {
      try {
        await delivery.react("👀");
      } catch (err) {
        console.warn("[cursor] react ack failed:", err);
        const sent = await delivery.reply(
          delivery.formatOutput(
            buildWorkingMessage(projectKey, opts.executionMode ?? "agent")
          )
        );
        if (sent?.messageId) progressBoard.attach(sent.messageId);
      }
    } else {
      const sent = await delivery.reply(
        delivery.formatOutput(
          buildWorkingMessage(projectKey, opts.executionMode ?? "agent")
        )
      );
      if (sent?.messageId) progressBoard.attach(sent.messageId);
    }

    // stop() during react/working-message — honour before spawning Cursor.
    if (this.runners.getRunnerFor(workspace).wasStopRequested()) {
      this.runners.markIdle(workspace);
      await delivery.reply(delivery.formatOutput(buildStoppedMessage()));
      await this.drainAfterRun(workspace);
      return;
    }

    const executionMode: CursorExecutionMode = opts.executionMode ?? "agent";
    const cursorPrompt = opts.cursorPrompt ?? trimmed;
    const userPromptForPlan = opts.userPromptForPlan ?? trimmed;

    console.log(
      `[cursor] start platform=${delivery.platform} project=${projectKey} mode=${executionMode} prompt=${trimmed.slice(0, 80)}`
    );

    const liveProgress = createLiveProgressReporter({
      minIntervalMs: 12_000,
      onSend: async (step) => {
        try {
          await progressBoard.addStep(formatLiveStepMessage(step));
          console.log(`[cursor] ▸ ${projectKey} | ${step}`);
        } catch (err) {
          console.warn("[cursor] progress send failed:", err);
        }
      },
    });

    const heartbeat = createProgressHeartbeat({
      intervalsMs: PROGRESS_INTERVALS_MS,
      onTick: async (elapsedSec) => {
        try {
          await progressBoard.tick(elapsedSec);
          const last = liveProgress.lastText();
          console.log(
            `[cursor] ⏱ ${projectKey} | ${elapsedSec}s${last ? ` | ${last}` : ""}`
          );
        } catch (err) {
          console.warn("[cursor] heartbeat send failed:", err);
        }
      },
    });

    const storageKey = sessionStorageKey(projectKey, delivery.conversationKey);
    const freshSession = Boolean(opts.freshSession);
    if (freshSession) {
      this.conversations.setChatId(storageKey, null);
    }
    const resume =
      !freshSession &&
      shouldResumeCursorChat({
        surface: delivery.surface,
        projectKey,
      });
    const model = modelForExecutionMode(this.config, executionMode);

    try {
      handedToRunner = true;
      const result = await this.runners.runAcquired({
        cursorBin: this.config.cursorBin,
        workspace,
        prompt: cursorPrompt,
        projectKey,
        sessionKey: storageKey,
        conversations: this.conversations,
        executionMode,
        resume,
        model,
        timeoutMs: this.config.cursorTimeoutMin * 60_000,
        onProgress: (step) => liveProgress.report(step),
      });

      liveProgress.stop();
      heartbeat.stop();
      console.log(
        `[cursor] done project=${projectKey} mode=${executionMode} exit=${result.exitCode} duration=${result.durationSec}s cancelled=${result.cancelled} timedOut=${result.timedOut}`
      );

      if (result.timedOut) {
        this.logger.log({
          time: new Date().toISOString(),
          project: projectKey,
          prompt: trimmed,
          duration: result.durationSec,
          exit: result.exitCode,
          error: "timed_out",
          platform: delivery.platform,
          sourceId: delivery.sourceId,
        });
        await delivery.reply(delivery.formatOutput(buildTimedOutMessage()));
        return;
      }

      if (result.cancelled) {
        this.logger.log({
          time: new Date().toISOString(),
          project: projectKey,
          prompt: trimmed,
          duration: result.durationSec,
          exit: result.exitCode,
          error: "cancelled",
          platform: delivery.platform,
          sourceId: delivery.sourceId,
        });
        await delivery.reply(delivery.formatOutput(buildStoppedMessage()));
        return;
      }

      let response =
        result.stdout ||
        result.stderr ||
        (result.exitCode === 0
          ? "(Cursor finished with no output.)"
          : "Cursor exited unexpectedly.");

      if (result.exitCode !== 0 && result.stdout && result.stderr) {
        response = `${result.stdout}\n\n---\n${result.stderr}`;
      } else if (result.exitCode !== 0 && !result.stdout && result.stderr) {
        response = `Cursor exited unexpectedly.\n\n${result.stderr}`;
      } else if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
        response = "Cursor exited unexpectedly.";
      }

      // General runs are intentionally non-resuming — don't keep a Cursor chatId.
      this.conversations.append(
        storageKey,
        trimmed,
        response,
        resume ? result.chatId : null
      );
      this.logger.log({
        time: new Date().toISOString(),
        project: projectKey,
        prompt: trimmed,
        response: response.slice(0, 2000),
        duration: result.durationSec,
        exit: result.exitCode,
        platform: delivery.platform,
        sourceId: delivery.sourceId,
        ...(result.usage
          ? {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            }
          : {}),
      });

      if (executionMode === "plan" && result.exitCode === 0) {
        const planReply = delivery.formatOutput(formatPlanReply(response));
        let approvalMessageId: string | undefined;
        for (const chunk of splitMessage(planReply, delivery.maxChars)) {
          const sent = await delivery.reply(chunk);
          if (sent?.messageId) approvalMessageId = sent.messageId;
        }
        this.projects.setPendingPlan({
          projectKey,
          userPrompt: userPromptForPlan,
          planText: response,
          conversationKey: delivery.conversationKey,
          approvalMessageId,
        });
        if (approvalMessageId && delivery.reactToMessage) {
          try {
            await delivery.reactToMessage(approvalMessageId, PLAN_APPROVAL_EMOJI);
          } catch (err) {
            console.warn("[cursor] plan approval react failed:", err);
          }
        }
        return;
      }

      let formatted = delivery.formatOutput(response);
      if (result.usage) {
        formatted = `${formatted}\n\n${delivery.formatOutput(formatUsageFooter(result.usage))}`;
      }
      for (const chunk of splitMessage(formatted, delivery.maxChars)) {
        await delivery.reply(chunk);
      }
    } catch (err) {
      liveProgress.stop();
      heartbeat.stop();
      console.error(`[cursor] error project=${projectKey}:`, err);
      if (err instanceof CursorBusyError) {
        const enqueued = this.queues.enqueue({
          prompt: trimmed,
          delivery,
          projectKey,
          workspace,
          runOpts: {
            executionMode: opts.executionMode,
            cursorPrompt: opts.cursorPrompt,
            skipPlanFirst: opts.skipPlanFirst,
            userPromptForPlan: opts.userPromptForPlan,
            freshSession: opts.freshSession,
          },
        });
        if (enqueued.ok) {
          await delivery.reply(delivery.formatOutput("Queued — 1 task ahead"));
        } else {
          await delivery.reply(delivery.formatOutput(err.message));
        }
        return;
      }
      if (err instanceof CursorNotFoundError) {
        await delivery.reply(delivery.formatOutput("Cursor CLI not found."));
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.logger.log({
        time: new Date().toISOString(),
        project: projectKey,
        prompt: trimmed,
        duration: 0,
        exit: null,
        error: message,
        platform: delivery.platform,
        sourceId: delivery.sourceId,
      });
      await delivery.reply(delivery.formatOutput(message));
    } finally {
      // runAcquired releases the slot. Only markIdle here if we never handed off
      // (otherwise we can steal a newer run's acquire on the same workspace).
      if (!handedToRunner && this.runners.isBusy(workspace)) {
        this.runners.markIdle(workspace);
      }
      await this.drainAfterRun(workspace);
    }
  }
}
