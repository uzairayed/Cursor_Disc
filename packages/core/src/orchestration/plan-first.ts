export interface PendingPlan {
  projectKey: string;
  userPrompt: string;
  planText: string;
  conversationKey?: string;
  /** Platform message id of the plan reply — react ✅ on it to approve. */
  approvalMessageId?: string;
}

/** Discord / Unicode checkmark used to approve a pending plan. */
export const PLAN_APPROVAL_EMOJI = "✅";

/** Large prompt waiting for the user to choose plan vs run. */
export interface PendingLargePrompt {
  projectKey: string;
  userPrompt: string;
  conversationKey?: string;
}

export type PlanApprovalIntent =
  | { kind: "approve" }
  | { kind: "cancel" }
  | { kind: "enter_plan" }
  | { kind: "run_anyway" };

/** Character / structure heuristic for "too big for a blind agent run". */
export const PLAN_FIRST_CHAR_THRESHOLD = 400;

const PLAN_PREAMBLE = [
  "You are planning only (read-only). Do not edit files or run mutating commands.",
  "Produce a concise implementation plan:",
  "1. Goal",
  "2. Specs to write or update (if any)",
  "3. Ordered slices (each: failing test first, then code)",
  "4. Risks / unknowns",
  "5. What you will NOT do in the first implement pass",
  "",
  "Original request:",
].join("\n");

export function shouldPlanFirst(prompt: string): boolean {
  const text = prompt.trim();
  if (text.length >= PLAN_FIRST_CHAR_THRESHOLD) return true;

  const numbered = text.match(/^\s*\d+[.)]\s+\S/gm);
  if (numbered && numbered.length >= 3) return true;

  if (
    (/image is attached/i.test(text) || /Discord image is attached/i.test(text)) &&
    text.length >= 200
  ) {
    return true;
  }

  return false;
}

export function wrapPromptForPlan(userPrompt: string): string {
  return `${PLAN_PREAMBLE}\n${userPrompt}`;
}

function normalize(text: string): string {
  const trimmed = text.trim();
  const body = trimmed.startsWith("/") ? trimmed.slice(1).trim() : trimmed;
  return body.replace(/\s+/g, " ").toLowerCase();
}

export function parsePlanApprovalIntent(text: string): PlanApprovalIntent | null {
  const normalized = normalize(text);

  if (
    normalized === "go" ||
    normalized === "implement" ||
    normalized === "do it" ||
    normalized === "ship it" ||
    normalized === "build it"
  ) {
    return { kind: "approve" };
  }

  if (
    normalized === "plan" ||
    normalized === "plan mode" ||
    normalized === "enter plan" ||
    normalized === "enter plan mode" ||
    normalized === "use plan mode"
  ) {
    return { kind: "enter_plan" };
  }

  if (
    normalized === "run" ||
    normalized === "run anyway" ||
    normalized === "force" ||
    normalized === "just run"
  ) {
    return { kind: "run_anyway" };
  }

  if (
    normalized === "cancel plan" ||
    normalized === "nevermind plan" ||
    normalized === "never mind plan"
  ) {
    return { kind: "cancel" };
  }

  return null;
}

export function buildImplementPrompt(pending: { userPrompt: string; planText: string }): string {
  return [
    "Implement the approved plan below. Follow red → green → refactor.",
    "",
    "## Approved plan",
    pending.planText.trim(),
    "",
    "## Original request",
    pending.userPrompt.trim(),
  ].join("\n");
}

export function formatAskPlanModeReply(): string {
  return [
    "That prompt is pretty large for a straight agent run.",
    "",
    "Reply *plan* to enter plan mode first (recommended),",
    "or *run* to send it to the agent as-is.",
    "Say *cancel plan* to drop it.",
  ].join("\n");
}

export function formatPlanReply(planText: string): string {
  const body = planText.trim() || "(Plan was empty — try again or send a smaller task.)";
  return [
    body,
    "",
    "—",
    `React ${PLAN_APPROVAL_EMOJI} or reply *go* to implement this plan, or *cancel plan* to drop it.`,
  ].join("\n");
}

export function isPlanApprovalEmoji(emojiName: string | null | undefined): boolean {
  if (!emojiName) return false;
  return (
    emojiName === PLAN_APPROVAL_EMOJI ||
    emojiName === "✔️" ||
    emojiName === "white_check_mark" ||
    emojiName === "heavy_check_mark"
  );
}
