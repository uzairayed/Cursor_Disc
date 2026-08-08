import { describe, expect, it, vi } from "vitest";
import { createSlashDelivery } from "./slash-delivery.js";

describe("createSlashDelivery", () => {
  it("edits the deferred reply first, then followUps", async () => {
    const editReply = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);
    const delivery = createSlashDelivery({
      userId: "u1",
      conversationId: "c1",
      surface: "project",
      editReply,
      followUp,
    });

    await delivery.reply("first");
    await delivery.reply("second");
    await delivery.reply("third");

    expect(editReply).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledWith("first");
    expect(followUp).toHaveBeenCalledTimes(2);
    expect(followUp).toHaveBeenNthCalledWith(1, "second");
    expect(followUp).toHaveBeenNthCalledWith(2, "third");
  });
});
