import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationManager, toFsSafeKey } from "./index.js";

describe("ConversationManager", () => {
  it("stores chat id and messages per project", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-hist-"));
    const mgr = new ConversationManager(dir);

    mgr.setChatId("crm", "session-abc");
    mgr.append("crm", "fix login", "done", "session-abc");

    const state = mgr.load("crm");
    expect(state.chatId).toBe("session-abc");
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.role).toBe("user");
    expect(state.messages[1]?.content).toBe("done");

    expect(mgr.load("fleet").messages).toHaveLength(0);
  });

  it("persists sessions whose keys contain Windows-reserved characters", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-hist-"));
    const mgr = new ConversationManager(dir);
    const key = "crm__discord:thread-1";

    mgr.setChatId(key, "session-xyz");
    expect(mgr.getChatId(key)).toBe("session-xyz");
    expect(readdirSync(dir)).toContain("crm__discord_thread-1");

    expect(mgr.clearProjectSessions("crm")).toBe(1);
    expect(mgr.getChatId(key)).toBeNull();
  });
});

describe("toFsSafeKey", () => {
  it("replaces reserved characters and is idempotent", () => {
    const once = toFsSafeKey('CRM__a:b/c\\d|e?f*g<h>i"j');
    expect(once).toBe("crm__a_b_c_d_e_f_g_h_i_j");
    expect(toFsSafeKey(once)).toBe(once);
  });

  it("strips trailing dots and escapes reserved device names", () => {
    expect(toFsSafeKey("session...")).toBe("session");
    expect(toFsSafeKey("con")).toBe("_con");
    expect(toFsSafeKey("_con")).toBe("_con");
  });
});
