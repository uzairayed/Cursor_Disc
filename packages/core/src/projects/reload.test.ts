import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/index.js";
import { ProjectStore } from "./index.js";

function setup(): { store: ProjectStore; projectsFile: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "cwa-reload-"));
  const crm = join(root, "crm");
  mkdirSync(crm);
  const projectsFile = join(root, "projects.json");
  writeFileSync(projectsFile, JSON.stringify({ crm }));
  const config: AppConfig = {
    rootDir: root,
    projectsFile,
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
    bridgeHost: "test-host",
  };
  return { store: new ProjectStore(config), projectsFile, root };
}

describe("ProjectStore live reload", () => {
  it("picks up new projects when the picker is rendered", () => {
    const { store, projectsFile, root } = setup();
    const fleet = join(root, "fleet");
    mkdirSync(fleet);
    writeFileSync(projectsFile, JSON.stringify({ crm: join(root, "crm"), fleet }));

    const picker = store.formatPicker();
    expect(picker).toMatch(/FLEET/i);
  });

  it("picks up new projects when resolving a key", () => {
    const { store, projectsFile, root } = setup();
    const fleet = join(root, "fleet");
    mkdirSync(fleet);
    writeFileSync(projectsFile, JSON.stringify({ crm: join(root, "crm"), fleet }));

    const resolved = store.resolve("fleet");
    expect(resolved?.key).toBe("fleet");
    expect(resolved?.path).toBe(fleet);
  });
});
