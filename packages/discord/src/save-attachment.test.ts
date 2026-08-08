import { describe, expect, it } from "vitest";
import {
  classifyAttachment,
  isAllowedAttachment,
  MAX_ATTACHMENT_BYTES,
} from "./save-attachment.js";

describe("classifyAttachment", () => {
  it("detects images by content type or extension", () => {
    expect(classifyAttachment({ contentType: "image/png", name: "a.bin" })).toBe("image");
    expect(classifyAttachment({ contentType: null, name: "shot.JPEG" })).toBe("image");
  });

  it("detects audio by content type or extension", () => {
    expect(classifyAttachment({ contentType: "audio/ogg", name: "v.bin" })).toBe("audio");
    expect(classifyAttachment({ contentType: null, name: "note.mp3" })).toBe("audio");
  });

  it("returns unsupported for other types", () => {
    expect(classifyAttachment({ contentType: "application/pdf", name: "a.pdf" })).toBe(
      "unsupported"
    );
  });
});

describe("isAllowedAttachment", () => {
  it("accepts supported types under the size cap", () => {
    expect(
      isAllowedAttachment({
        contentType: "image/png",
        name: "a.png",
        size: 1024,
      })
    ).toEqual({ ok: true, kind: "image" });
  });

  it("rejects oversized attachments", () => {
    expect(
      isAllowedAttachment({
        contentType: "image/png",
        name: "big.png",
        size: MAX_ATTACHMENT_BYTES + 1,
      })
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects unsupported types", () => {
    expect(
      isAllowedAttachment({
        contentType: "text/plain",
        name: "notes.txt",
        size: 10,
      })
    ).toEqual({ ok: false, reason: "unsupported" });
  });
});
