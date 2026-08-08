import { describe, expect, it } from "vitest";
import { sessionStorageKey } from "./index.js";

describe("sessionStorageKey", () => {
  it("returns the project key when no conversation key is set", () => {
    expect(sessionStorageKey("crm")).toBe("crm");
  });

  it("namespaces by conversation key", () => {
    expect(sessionStorageKey("crm", "discord:thread-1")).toBe("crm__discord:thread-1");
  });
});
