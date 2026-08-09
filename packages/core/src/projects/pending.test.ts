import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/index.js";
import { ProjectStore } from "./index.js";

function setup(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "cwa-pending-"));
  mkdirSync(join(root, "crm"));
  mkdirSync(join(root, "fleet"));
  writeFileSync(
    join(root, "projects.json"),
    JSON.stringify({ crm: join(root, "crm"), fleet: join(root, "fleet") }),
  );
  const config: AppConfig = {
    rootDir: root,
    projectsFile: join(root, "projects.json"),
    historyDir: join(root, "history"),
    logsDir: join(root, "logs"),
    stateFile: join(root, "state.json"),
    generalDir: join(root, "general"),
    cursorBin: "cursor",
    appName: "CursorDiscord",
    cursorTimeoutMin: 15,
    openaiApiKey: null,
    voiceTtsVoice: "alloy",
    voiceSttMode: "realtime",
    retentionDays: 7,
    previewDefaultPort: 3000,
    previewCloudflaredBin: "cloudflared",
    previewPortsEnv: null,
    cursorPlanModel: null,
    cursorAgentModel: null,
    cursorAskModel: null,
    cursorMaxConcurrent: 3,
    logPrompts: false,
  };
  return new ProjectStore(config);
}

describe("per-project pending plan/large-prompt", () => {
  it("keeps project A plan when B gets a large-prompt hold", () => {
    const store = setup();
    store.setPendingPlan({
      projectKey: "crm",
      userPrompt: "crm task",
      planText: "crm plan",
    });
    store.setPendingLargePrompt({
      projectKey: "fleet",
      userPrompt: "x".repeat(400),
    });

    expect(store.getPendingPlan("crm")?.planText).toBe("crm plan");
    expect(store.getPendingLargePrompt("fleet")?.projectKey).toBe("fleet");
    expect(store.getPendingPlan("fleet")).toBeNull();
  });

  it("finds a plan by approval message id across projects", () => {
    const store = setup();
    store.setPendingPlan({
      projectKey: "crm",
      userPrompt: "a",
      planText: "p",
      approvalMessageId: "msg-crm",
    });
    store.setPendingPlan({
      projectKey: "fleet",
      userPrompt: "b",
      planText: "q",
      approvalMessageId: "msg-fleet",
    });

    expect(store.findPendingPlanByApprovalMessageId("msg-fleet")?.projectKey).toBe("fleet");
  });
});
