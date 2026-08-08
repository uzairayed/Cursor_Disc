import { describe, expect, it, vi } from "vitest";
import {
  GmailNotConnectedError,
  formatInboxSummary,
  listUnreadMessages,
  type GmailMessageSummary,
  type GmailTransport,
} from "./gmail.js";

describe("formatInboxSummary", () => {
  it("describes an empty inbox", () => {
    expect(formatInboxSummary([])).toBe("You have no unread emails.");
  });

  it("summarizes subjects, from, and date", () => {
    const messages: GmailMessageSummary[] = [
      {
        id: "1",
        subject: "Invoice due",
        from: "billing@acme.com",
        date: "Mon, 28 Jul 2026",
      },
      {
        id: "2",
        subject: "Standup notes",
        from: "team@example.com",
        date: "Tue, 29 Jul 2026",
      },
    ];
    const text = formatInboxSummary(messages);
    expect(text).toMatch(/2 unread/);
    expect(text).toMatch(/Invoice due/);
    expect(text).toMatch(/billing@acme.com/);
    expect(text).toMatch(/Standup notes/);
  });
});

describe("listUnreadMessages", () => {
  it("throws GmailNotConnectedError when transport reports not connected", async () => {
    const transport: GmailTransport = {
      isConnected: () => false,
      listUnread: vi.fn(),
    };
    await expect(listUnreadMessages({ transport, max: 5 })).rejects.toBeInstanceOf(
      GmailNotConnectedError
    );
  });

  it("returns messages from the transport capped by max", async () => {
    const transport: GmailTransport = {
      isConnected: () => true,
      listUnread: vi.fn(async (max) =>
        Array.from({ length: max }, (_, i) => ({
          id: String(i),
          subject: `S${i}`,
          from: "a@b.com",
          date: "now",
        }))
      ),
    };
    const msgs = await listUnreadMessages({ transport, max: 3 });
    expect(msgs).toHaveLength(3);
    expect(transport.listUnread).toHaveBeenCalledWith(3);
  });
});
