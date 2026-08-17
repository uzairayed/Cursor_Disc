import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyAttachment,
  isAllowedAttachment,
  MAX_ATTACHMENT_BYTES,
  saveDiscordAttachment,
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

  it("detects documents by content type or extension", () => {
    expect(classifyAttachment({ contentType: "application/pdf", name: "a.bin" })).toBe("document");
    expect(classifyAttachment({ contentType: null, name: "notes.TXT" })).toBe("document");
    expect(classifyAttachment({ contentType: "text/markdown", name: "README" })).toBe("document");
  });

  it("returns unsupported for other types", () => {
    expect(classifyAttachment({ contentType: "application/zip", name: "a.zip" })).toBe(
      "unsupported",
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
      }),
    ).toEqual({ ok: true, kind: "image" });
  });

  it("rejects oversized attachments", () => {
    expect(
      isAllowedAttachment({
        contentType: "image/png",
        name: "big.png",
        size: MAX_ATTACHMENT_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts documents under the size cap", () => {
    expect(
      isAllowedAttachment({
        contentType: "application/pdf",
        name: "spec.pdf",
        size: 1024,
      }),
    ).toEqual({ ok: true, kind: "document" });
  });

  it("rejects unsupported types", () => {
    expect(
      isAllowedAttachment({
        contentType: "application/zip",
        name: "archive.zip",
        size: 10,
      }),
    ).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("saveDiscordAttachment", () => {
  const okFetch = async () => new Response(new Blob(["x"]), { status: 200 }) as unknown as Response;

  it("rejects path traversal in file names before fetching", async () => {
    const destDir = mkdtempSync(join(tmpdir(), "cwa-attach-"));
    for (const fileName of ["../evil.png", "..\\evil.png", "a/b.png", ".."]) {
      let fetched = false;
      await expect(
        saveDiscordAttachment({
          url: "https://cdn.example/x",
          fileName,
          destDir,
          fetchImpl: (async () => {
            fetched = true;
            return okFetch();
          }) as typeof fetch,
        }),
      ).rejects.toThrow(/unsafe/i);
      expect(fetched).toBe(false);
    }
  });

  it("saves a plain file name inside destDir", async () => {
    const destDir = mkdtempSync(join(tmpdir(), "cwa-attach-"));
    const dest = await saveDiscordAttachment({
      url: "https://cdn.example/x",
      fileName: "shot.png",
      destDir,
      fetchImpl: okFetch as unknown as typeof fetch,
    });
    expect(dest).toBe(join(destDir, "shot.png"));
  });
});
