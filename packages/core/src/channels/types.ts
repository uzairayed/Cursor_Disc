export type Platform = "discord";

export interface ReplyResult {
  messageId?: string;
}

export type ReplyFn = (text: string) => Promise<ReplyResult | void>;
export type ReactFn = (emoji: string) => Promise<void>;
/** React on a previously sent bot message (e.g. ✅ on a plan reply). */
export type ReactToMessageFn = (messageId: string, emoji: string) => Promise<void>;
/** Edit a previously sent bot message (progress board updates). */
export type EditFn = (messageId: string, text: string) => Promise<void>;

/** Transport-neutral delivery contract retained with every queued prompt. */
export interface DeliveryContext {
  platform: Platform;
  reply: ReplyFn;
  react?: ReactFn;
  reactToMessage?: ReactToMessageFn;
  /** When set, progress updates edit one message instead of spamming new ones. */
  edit?: EditFn;
  formatOutput: (text: string) => string;
  maxChars: number;
  /** Optional id for logs (phone, discord user, channel, etc.) */
  sourceId?: string;
  /**
   * When set, Cursor resume + history for this delivery are isolated under
   * `${projectKey}__${conversationKey}` (e.g. one Discord thread = one chat).
   */
  conversationKey?: string;
  /** Discord surface mode for help / UX copy. */
  surface?: "general" | "project";
}

/** Options preserved so drained work matches the original admission path. */
export interface QueuedRunOptions {
  executionMode?: "agent" | "plan" | "ask";
  cursorPrompt?: string;
  skipPlanFirst?: boolean;
  userPromptForPlan?: string;
  /** Clear stored chatId and skip --resume (e.g. implement after plan). */
  freshSession?: boolean;
}

export interface QueuedPrompt {
  prompt: string;
  delivery: DeliveryContext;
  projectKey: string;
  workspace: string;
  /** When set, drain runs this work directly (plan/go/ask expansions). */
  runOpts?: QueuedRunOptions;
}
