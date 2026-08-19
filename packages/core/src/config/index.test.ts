import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCoreConfig, loadEnvFile, resolveCursorBin, resolveProjectPath } from "./index.js";

const prev = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in prev)) delete process.env[key];
  }
  Object.assign(process.env, prev);
});

describe("loadEnvFile", () => {
  it("loads KEY=value pairs and skips comments / blanks", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-env-"));
    const path = join(root, ".env");
    writeFileSync(
      path,
      [
        "# comment",
        "",
        "CURSOR_BIN=my-cursor",
        'QUOTED="hello world"',
        "SINGLE='x'",
        "NO_EQ_LINE",
      ].join("\n"),
    );
    delete process.env.CURSOR_BIN;
    delete process.env.QUOTED;
    delete process.env.SINGLE;

    loadEnvFile(path);
    expect(process.env.CURSOR_BIN).toBe("my-cursor");
    expect(process.env.QUOTED).toBe("hello world");
    expect(process.env.SINGLE).toBe("x");
  });

  it("does not override existing env unless override is set", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-env-"));
    const path = join(root, ".env");
    writeFileSync(path, "APP_NAME=from-file\n");
    process.env.APP_NAME = "already-set";

    loadEnvFile(path);
    expect(process.env.APP_NAME).toBe("already-set");

    loadEnvFile(path, { override: true });
    expect(process.env.APP_NAME).toBe("from-file");
  });

  it("no-ops when the file is missing", () => {
    expect(() => loadEnvFile(join(tmpdir(), "missing-env-file-xyz"))).not.toThrow();
  });
});

describe("loadCoreConfig", () => {
  it("loads defaults and paths under the given root", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-cfg-"));
    delete process.env.CURSOR_BIN;
    delete process.env.APP_NAME;
    delete process.env.CURSOR_TIMEOUT_MIN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.RETENTION_DAYS;
    delete process.env.PREVIEW_DEFAULT_PORT;
    delete process.env.PREVIEW_CLOUDFLARED_BIN;
    delete process.env.PREVIEW_PORTS;

    const cfg = loadCoreConfig(root);
    expect(cfg.rootDir).toBe(root);
    expect(cfg.projectsFile).toBe(join(root, "projects.json"));
    expect(cfg.historyDir).toBe(join(root, "history"));
    expect(cfg.logsDir).toBe(join(root, "logs"));
    expect(cfg.stateFile).toBe(join(root, "state.json"));
    expect(cfg.generalDir).toBe(join(root, "general"));
    // Resolved via resolveCursorBin(); may be a local agent install when present.
    expect(cfg.cursorBin).toBe(resolveCursorBin(undefined));
    expect(cfg.appName).toBe("CursorDiscord");
    expect(cfg.cursorTimeoutMin).toBe(15);
    expect(cfg.openaiApiKey).toBeNull();
    expect(cfg.voiceTtsVoice).toBe("alloy");
    expect(cfg.voiceTtsSpeed).toBe(1);
    expect(cfg.voiceSttMode).toBe("realtime");
    expect(cfg.retentionDays).toBe(7);
    expect(cfg.previewDefaultPort).toBe(3000);
    expect(cfg.previewCloudflaredBin).toBe("cloudflared");
    expect(cfg.previewPortsEnv).toBeNull();
    expect(cfg.cursorPlanModel).toBeNull();
    expect(cfg.cursorAgentModel).toBeNull();
    expect(cfg.cursorAskModel).toBeNull();
  });

  it("reads plan/agent/ask model overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-cfg-"));
    writeFileSync(
      join(root, ".env"),
      [
        "CURSOR_PLAN_MODEL=gpt-5.2",
        "CURSOR_AGENT_MODEL=cursor-grok-4.5-high",
        "CURSOR_ASK_MODEL=cursor-grok-4.5-medium",
      ].join("\n"),
    );
    delete process.env.CURSOR_PLAN_MODEL;
    delete process.env.CURSOR_AGENT_MODEL;
    delete process.env.CURSOR_ASK_MODEL;

    const cfg = loadCoreConfig(root);
    expect(cfg.cursorPlanModel).toBe("gpt-5.2");
    expect(cfg.cursorAgentModel).toBe("cursor-grok-4.5-high");
    expect(cfg.cursorAskModel).toBe("cursor-grok-4.5-medium");
  });

  it("lets .env.local override .env", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-cfg-"));
    writeFileSync(join(root, ".env"), "APP_NAME=from-env\nCURSOR_TIMEOUT_MIN=20\n");
    writeFileSync(join(root, ".env.local"), "APP_NAME=from-local\n");
    delete process.env.APP_NAME;
    delete process.env.CURSOR_TIMEOUT_MIN;

    const cfg = loadCoreConfig(root);
    expect(cfg.appName).toBe("from-local");
    expect(cfg.cursorTimeoutMin).toBe(20);
  });

  it("clamps invalid preview ports back to 3000", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-cfg-"));
    writeFileSync(join(root, ".env"), "PREVIEW_DEFAULT_PORT=99999\n");
    delete process.env.PREVIEW_DEFAULT_PORT;

    expect(loadCoreConfig(root).previewDefaultPort).toBe(3000);
  });

  it("reads preview ports env and openai key", () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-cfg-"));
    writeFileSync(
      join(root, ".env"),
      [
        "OPENAI_API_KEY=sk-test",
        "PREVIEW_PORTS=cliproom:5173",
        "PREVIEW_CLOUDFLARED_BIN=/usr/local/bin/cloudflared",
        "RETENTION_DAYS=3",
      ].join("\n"),
    );
    delete process.env.OPENAI_API_KEY;
    delete process.env.PREVIEW_PORTS;
    delete process.env.PREVIEW_CLOUDFLARED_BIN;
    delete process.env.RETENTION_DAYS;

    const cfg = loadCoreConfig(root);
    expect(cfg.openaiApiKey).toBe("sk-test");
    expect(cfg.previewPortsEnv).toBe("cliproom:5173");
    expect(cfg.previewCloudflaredBin).toBe("/usr/local/bin/cloudflared");
    expect(cfg.retentionDays).toBe(3);
  });
});

describe("resolveCursorBin", () => {
  it("uses CURSOR_BIN when set", () => {
    expect(resolveCursorBin("  my-agent  ", { exists: () => true })).toBe("my-agent");
  });

  it("prefers Windows agent.cmd when installed", () => {
    const agentCmd = join("C:\\Users\\me\\AppData\\Local", "cursor-agent", "agent.cmd");
    expect(
      resolveCursorBin(undefined, {
        platform: "win32",
        localAppData: "C:\\Users\\me\\AppData\\Local",
        homeDir: "C:\\Users\\me",
        exists: (p) => p === agentCmd,
      }),
    ).toBe(agentCmd);
  });

  it("falls back to cursor when no agent install is found", () => {
    expect(
      resolveCursorBin(undefined, {
        platform: "linux",
        homeDir: "/home/me",
        exists: () => false,
      }),
    ).toBe("cursor");
  });
});

describe("resolveProjectPath", () => {
  it("expands home-relative project paths", () => {
    expect(resolveProjectPath("~/Projects/app")).toBe(resolve(homedir(), "Projects/app"));
  });
});
