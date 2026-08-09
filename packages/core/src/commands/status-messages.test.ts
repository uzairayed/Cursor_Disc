import { describe, expect, it } from "vitest";
import {
  buildBusyStatusMessage,
  buildIdleStatusMessage,
  buildMultiAgentStatusMessage,
  buildWorkingMessage,
} from "./status-messages.js";

describe("buildWorkingMessage", () => {
  it("sounds human and names the project clearly", () => {
    const msg = buildWorkingMessage("cliproom");
    expect(msg.toLowerCase()).toContain("cliproom");
    expect(msg).not.toMatch(/^Working on /);
    expect(msg).toMatch(/on it|looking into|working on that|got it/i);
    expect(msg).toMatch(/check in|stop/i);
  });
});

describe("status messages", () => {
  it("reports busy vs idle", () => {
    expect(buildBusyStatusMessage("tagiser")).toMatch(/TAGISER/);
    expect(buildBusyStatusMessage("tagiser")).toMatch(/still working/i);
    expect(buildIdleStatusMessage()).toMatch(/free/i);
  });

  it("summarizes multiple agents and queued work", () => {
    const msg = buildMultiAgentStatusMessage(
      [{ projectKey: "crm" }, { projectKey: "fleet" }],
      [
        { projectKey: "crm", depth: 1 },
        { projectKey: "alpha", depth: 2 },
      ],
    );
    expect(msg).toMatch(/2 agents running/i);
    expect(msg).toMatch(/Queued: \*CRM\* \(1\), \*ALPHA\* \(2\)/);
    expect(msg).toMatch(/stop all/i);
  });
});
