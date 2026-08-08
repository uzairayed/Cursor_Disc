import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProjectPath, type AppConfig } from "../config/index.js";
import type {
  PendingLargePrompt,
  PendingPlan,
} from "../orchestration/plan-first.js";
import { loadProjectsConfig, type ProjectsMap } from "./discover.js";

export type { ProjectsMap };
export type { PendingLargePrompt, PendingPlan };

export interface SessionState {
  currentProject: string | null;
  awaitingProjectPick?: boolean;
  /** @deprecated legacy single-slot; migrated into pendingPlans */
  pendingPlan?: PendingPlan | null;
  /** @deprecated legacy single-slot; migrated into pendingLargePrompts */
  pendingLargePrompt?: PendingLargePrompt | null;
  /** Per-project pending plans (keyed by project key). */
  pendingPlans?: Record<string, PendingPlan>;
  /** Per-project large-prompt holds (keyed by project key). */
  pendingLargePrompts?: Record<string, PendingLargePrompt>;
}

export class ProjectStore {
  private projects: ProjectsMap = {};
  private state: SessionState = {
    currentProject: null,
    awaitingProjectPick: false,
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
        `${JSON.stringify({ dirs: [], exclude: [], aliases: {} }, null, 2)}\n`,
        "utf8"
      );
    }
    const raw = JSON.parse(readFileSync(this.config.projectsFile, "utf8")) as unknown;
    mkdirSync(this.config.generalDir, { recursive: true });
    // Built-in general workspace always available; file aliases can override path.
    this.projects = {
      general: this.config.generalDir,
      ...loadProjectsConfig(raw),
    };

    if (!this.state.currentProject && this.config.defaultProject) {
      const key = this.config.defaultProject.toLowerCase();
      if (this.projects[key]) {
        this.state.currentProject = key;
        this.saveState();
      }
    }
  }

  private loadState(): void {
    if (!existsSync(this.config.stateFile)) {
      this.state = {
        currentProject: this.config.defaultProject?.toLowerCase() ?? null,
        awaitingProjectPick: false,
        pendingPlans: {},
        pendingLargePrompts: {},
      };
      this.saveState();
      return;
    }
    const loaded = JSON.parse(readFileSync(this.config.stateFile, "utf8")) as SessionState;
    const pendingPlans = migratePendingPlans(loaded);
    const pendingLargePrompts = migratePendingLargePrompts(loaded);
    this.state = {
      currentProject: loaded.currentProject ?? null,
      awaitingProjectPick: Boolean(loaded.awaitingProjectPick),
      pendingPlans,
      pendingLargePrompts,
    };
  }

  private saveState(): void {
    const toSave: SessionState = {
      currentProject: this.state.currentProject,
      awaitingProjectPick: this.state.awaitingProjectPick,
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

  resolve(key: string): { key: string; path: string } | null {
    this.reload();
    const normalized = key.toLowerCase();
    const raw = this.projects[normalized];
    if (!raw) return null;
    return { key: normalized, path: resolveProjectPath(raw) };
  }

  setCurrent(key: string): { key: string; path: string } | null {
    const resolved = this.resolve(key);
    if (!resolved) return null;
    this.state.currentProject = resolved.key;
    this.state.awaitingProjectPick = false;
    this.saveState();
    mkdirSync(join(this.config.historyDir, resolved.key), { recursive: true });
    return resolved;
  }

  getCurrent(): { key: string; path: string; displayPath: string } | null {
    if (!this.state.currentProject) return null;
    const resolved = this.resolve(this.state.currentProject);
    if (!resolved) return null;
    return {
      ...resolved,
      displayPath: this.projects[resolved.key],
    };
  }

  formatList(): string {
    this.reload();
    const keys = this.list();
    if (keys.length === 0) return "(no projects configured in projects.json)";
    return keys.map((k) => k.toUpperCase()).join("\n");
  }

  formatPicker(): string {
    this.reload();
    const keys = this.list();
    if (keys.length === 0) return "No projects are configured yet.";
    return keys.map((k, i) => `${i + 1}. ${k.toUpperCase()}`).join("\n");
  }

  pickByNumber(n: number): { key: string; path: string } | null {
    this.reload();
    const keys = this.list();
    if (n < 1 || n > keys.length) return null;
    return this.setCurrent(keys[n - 1]!);
  }

  setAwaitingProjectPick(value: boolean): void {
    this.state.awaitingProjectPick = value;
    this.saveState();
  }

  isAwaitingProjectPick(): boolean {
    return Boolean(this.state.awaitingProjectPick);
  }

  /**
   * Pending plan for `projectKey`, or the current project's plan when omitted.
   */
  getPendingPlan(projectKey?: string): PendingPlan | null {
    const key = (projectKey ?? this.state.currentProject)?.toLowerCase();
    if (!key) return null;
    return this.state.pendingPlans?.[key] ?? null;
  }

  /** Find a pending plan by Discord approval message id (any project). */
  findPendingPlanByApprovalMessageId(messageId: string): PendingPlan | null {
    for (const plan of Object.values(this.state.pendingPlans ?? {})) {
      if (plan.approvalMessageId === messageId) return plan;
    }
    return null;
  }

  /**
   * Set or clear a pending plan. Passing `null` clears `projectKey` (or current).
   * Passing a plan stores it under `plan.projectKey` without touching other projects.
   */
  setPendingPlan(plan: PendingPlan | null, projectKey?: string): void {
    if (!this.state.pendingPlans) this.state.pendingPlans = {};
    if (plan) {
      const key = plan.projectKey.toLowerCase();
      this.state.pendingPlans[key] = { ...plan, projectKey: key };
    } else {
      const key = (projectKey ?? this.state.currentProject)?.toLowerCase();
      if (key) delete this.state.pendingPlans[key];
    }
    this.saveState();
  }

  getPendingLargePrompt(projectKey?: string): PendingLargePrompt | null {
    const key = (projectKey ?? this.state.currentProject)?.toLowerCase();
    if (!key) return null;
    return this.state.pendingLargePrompts?.[key] ?? null;
  }

  /**
   * Set or clear a large-prompt hold. Setting one clears that project's pending
   * plan only (other projects are untouched).
   */
  setPendingLargePrompt(pending: PendingLargePrompt | null, projectKey?: string): void {
    if (!this.state.pendingLargePrompts) this.state.pendingLargePrompts = {};
    if (!this.state.pendingPlans) this.state.pendingPlans = {};
    if (pending) {
      const key = pending.projectKey.toLowerCase();
      this.state.pendingLargePrompts[key] = { ...pending, projectKey: key };
      delete this.state.pendingPlans[key];
    } else {
      const key = (projectKey ?? this.state.currentProject)?.toLowerCase();
      if (key) delete this.state.pendingLargePrompts[key];
    }
    this.saveState();
  }

  /** Clear plan + large-prompt holds for one project. */
  clearPendingForProject(projectKey: string): boolean {
    const key = projectKey.toLowerCase();
    const hadPlan = Boolean(this.state.pendingPlans?.[key]);
    const hadLarge = Boolean(this.state.pendingLargePrompts?.[key]);
    if (this.state.pendingPlans) delete this.state.pendingPlans[key];
    if (this.state.pendingLargePrompts) delete this.state.pendingLargePrompts[key];
    if (hadPlan || hadLarge) this.saveState();
    return hadPlan || hadLarge;
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

function migratePendingLargePrompts(
  loaded: SessionState
): Record<string, PendingLargePrompt> {
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
    conversationKey:
      typeof raw.conversationKey === "string" ? raw.conversationKey : undefined,
    approvalMessageId:
      typeof raw.approvalMessageId === "string" ? raw.approvalMessageId : undefined,
  };
}

function normalizePendingLargePrompt(
  raw: PendingLargePrompt | null | undefined
): PendingLargePrompt | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.projectKey !== "string" || typeof raw.userPrompt !== "string") {
    return null;
  }
  return {
    projectKey: raw.projectKey.toLowerCase(),
    userPrompt: raw.userPrompt,
    conversationKey:
      typeof raw.conversationKey === "string" ? raw.conversationKey : undefined,
  };
}
