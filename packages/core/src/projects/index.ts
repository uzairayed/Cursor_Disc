import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type AppConfig, resolveProjectPath } from "../config/index.js";
import type { PendingLargePrompt, PendingPlan } from "../orchestration/plan-first.js";
import { formatDevicePicker, loadProjectsConfig, type ProjectsMap } from "./discover.js";

export type { PendingLargePrompt, PendingPlan, ProjectsMap };

/** A configured project resolved to the absolute path Cursor runs in. */
export interface ResolvedProject {
  key: string;
  /** Absolute workspace path. */
  path: string;
  /** Path as written in projects.json (may still contain `~`). */
  displayPath: string;
}

export interface SessionState {
  /** @deprecated legacy single-slot; migrated into pendingPlans */
  pendingPlan?: PendingPlan | null;
  /** @deprecated legacy single-slot; migrated into pendingLargePrompts */
  pendingLargePrompt?: PendingLargePrompt | null;
  /** Per-project pending plans (keyed by project key). */
  pendingPlans?: Record<string, PendingPlan>;
  /** Per-project large-prompt holds (keyed by project key). */
  pendingLargePrompts?: Record<string, PendingLargePrompt>;
}

/**
 * Known projects plus the per-project plan holds waiting on approval.
 *
 * Deliberately holds no "current project": the chat surface a message arrived
 * on decides its project, and several projects can be running at once, so a
 * single shared current would be wrong for all but one of them.
 */
export class ProjectStore {
  private projects: ProjectsMap = {};
  private rawFile: unknown = null;
  private state: SessionState = {
    pendingPlans: {},
    pendingLargePrompts: {},
  };

  constructor(private readonly config: AppConfig) {
    this.loadState();
    this.reload();
  }

  reload(): void {
    if (!existsSync(this.config.projectsFile)) {
      writeFileSync(
        this.config.projectsFile,
        `${JSON.stringify({ exclude: [], devices: {} }, null, 2)}\n`,
        "utf8",
      );
    }
    const raw = JSON.parse(readFileSync(this.config.projectsFile, "utf8")) as unknown;
    this.rawFile = raw;
    mkdirSync(this.config.generalDir, { recursive: true });
    // Built-in general workspace always available; file aliases can override path.
    this.projects = {
      general: this.config.generalDir,
      ...loadProjectsConfig(raw, { host: this.config.bridgeHost }),
    };
  }

  private loadState(): void {
    if (!existsSync(this.config.stateFile)) {
      this.state = { pendingPlans: {}, pendingLargePrompts: {} };
      this.saveState();
      return;
    }
    const loaded = JSON.parse(readFileSync(this.config.stateFile, "utf8")) as SessionState;
    this.state = {
      pendingPlans: migratePendingPlans(loaded),
      pendingLargePrompts: migratePendingLargePrompts(loaded),
    };
  }

  private saveState(): void {
    const toSave: SessionState = {
      pendingPlans: this.state.pendingPlans ?? {},
      pendingLargePrompts: this.state.pendingLargePrompts ?? {},
    };
    writeFileSync(this.config.stateFile, `${JSON.stringify(toSave, null, 2)}\n`, "utf8");
  }

  list(): string[] {
    return Object.keys(this.projects).sort();
  }

  get(key: string): string | null {
    return this.projects[key.toLowerCase()] ?? null;
  }

  resolve(key: string): ResolvedProject | null {
    this.reload();
    const normalized = key.toLowerCase();
    const raw = this.projects[normalized];
    if (!raw) return null;
    return { key: normalized, path: resolveProjectPath(raw), displayPath: raw };
  }

  formatPicker(): string {
    this.reload();
    return formatDevicePicker({
      raw: this.rawFile,
      host: this.config.bridgeHost,
      localKeys: this.list(),
    });
  }

  /** Reverse lookup: which project key owns this absolute workspace path? */
  keyForWorkspace(workspace: string): string | null {
    for (const key of this.list()) {
      if (this.resolve(key)?.path === workspace) return key;
    }
    return null;
  }

  getPendingPlan(projectKey: string): PendingPlan | null {
    return this.state.pendingPlans?.[projectKey.toLowerCase()] ?? null;
  }

  /** Find a pending plan by Discord approval message id (any project). */
  findPendingPlanByApprovalMessageId(messageId: string): PendingPlan | null {
    for (const plan of Object.values(this.state.pendingPlans ?? {})) {
      if (plan.approvalMessageId === messageId) return plan;
    }
    return null;
  }

  setPendingPlan(plan: PendingPlan): void {
    if (!this.state.pendingPlans) this.state.pendingPlans = {};
    const key = plan.projectKey.toLowerCase();
    this.state.pendingPlans[key] = { ...plan, projectKey: key };
    this.saveState();
  }

  getPendingLargePrompt(projectKey: string): PendingLargePrompt | null {
    return this.state.pendingLargePrompts?.[projectKey.toLowerCase()] ?? null;
  }

  /**
   * Hold a large prompt for `pending.projectKey`. Supersedes that project's
   * pending plan only; other projects are untouched.
   */
  setPendingLargePrompt(pending: PendingLargePrompt): void {
    if (!this.state.pendingLargePrompts) this.state.pendingLargePrompts = {};
    if (!this.state.pendingPlans) this.state.pendingPlans = {};
    const key = pending.projectKey.toLowerCase();
    this.state.pendingLargePrompts[key] = { ...pending, projectKey: key };
    delete this.state.pendingPlans[key];
    this.saveState();
  }

  /** Clear plan + large-prompt holds for one project. Returns true if any existed. */
  clearPendingForProject(projectKey: string): boolean {
    const key = projectKey.toLowerCase();
    const had =
      Boolean(this.state.pendingPlans?.[key]) || Boolean(this.state.pendingLargePrompts?.[key]);
    if (this.state.pendingPlans) delete this.state.pendingPlans[key];
    if (this.state.pendingLargePrompts) delete this.state.pendingLargePrompts[key];
    if (had) this.saveState();
    return had;
  }
}

function migratePendingPlans(loaded: SessionState): Record<string, PendingPlan> {
  const map: Record<string, PendingPlan> = {};
  if (loaded.pendingPlans && typeof loaded.pendingPlans === "object") {
    for (const [key, raw] of Object.entries(loaded.pendingPlans)) {
      const plan = normalizePendingPlan(raw);
      if (plan) map[key.toLowerCase()] = plan;
    }
  }
  const legacy = normalizePendingPlan(loaded.pendingPlan);
  if (legacy) map[legacy.projectKey.toLowerCase()] = legacy;
  return map;
}

function migratePendingLargePrompts(loaded: SessionState): Record<string, PendingLargePrompt> {
  const map: Record<string, PendingLargePrompt> = {};
  if (loaded.pendingLargePrompts && typeof loaded.pendingLargePrompts === "object") {
    for (const [key, raw] of Object.entries(loaded.pendingLargePrompts)) {
      const pending = normalizePendingLargePrompt(raw);
      if (pending) map[key.toLowerCase()] = pending;
    }
  }
  const legacy = normalizePendingLargePrompt(loaded.pendingLargePrompt);
  if (legacy) map[legacy.projectKey.toLowerCase()] = legacy;
  return map;
}

function normalizePendingPlan(raw: PendingPlan | null | undefined): PendingPlan | null {
  if (!raw || typeof raw !== "object") return null;
  if (
    typeof raw.projectKey !== "string" ||
    typeof raw.userPrompt !== "string" ||
    typeof raw.planText !== "string"
  ) {
    return null;
  }
  return {
    projectKey: raw.projectKey.toLowerCase(),
    userPrompt: raw.userPrompt,
    planText: raw.planText,
    conversationKey: typeof raw.conversationKey === "string" ? raw.conversationKey : undefined,
    approvalMessageId:
      typeof raw.approvalMessageId === "string" ? raw.approvalMessageId : undefined,
  };
}

function normalizePendingLargePrompt(
  raw: PendingLargePrompt | null | undefined,
): PendingLargePrompt | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.projectKey !== "string" || typeof raw.userPrompt !== "string") {
    return null;
  }
  return {
    projectKey: raw.projectKey.toLowerCase(),
    userPrompt: raw.userPrompt,
    conversationKey: typeof raw.conversationKey === "string" ? raw.conversationKey : undefined,
  };
}
