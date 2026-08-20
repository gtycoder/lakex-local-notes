import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceRepository } from "./resourceRepository";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ResourceRepository image format preservation", () => {
  it("stores GIF and WebP bytes with their detected extensions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-resource-test-"));
    tempRoots.push(root);
    const repo = new ResourceRepository({
      noteAssetsDirFor: (noteId) => path.join(root, noteId),
      assetUrl: (noteId, filename) => `http://127.0.0.1:19876/${noteId}/${filename}`,
      registerOrphan: () => undefined,
    });
    const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(8)]);
    const webp = Buffer.from("RIFF1234WEBP", "ascii");

    const gifOutput = repo.upload({ bytes: [...gif], filename: "preview.jpg" }, "note");
    const webpOutput = repo.upload({ bytes: [...webp], filename: "preview.png" }, "note");

    expect(gifOutput.filename).toMatch(/\.gif$/);
    expect(gifOutput.mimeType).toBe("image/gif");
    expect(webpOutput.filename).toMatch(/\.webp$/);
    expect(webpOutput.mimeType).toBe("image/webp");
    expect(fs.readFileSync(path.join(root, "note", gifOutput.filename))).toEqual(gif);
    expect(fs.readFileSync(path.join(root, "note", webpOutput.filename))).toEqual(webp);
  });
});

describe("ResourceRepository atomic writes", () => {
  it("does not leave a partial asset when the final rename fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-resource-atomic-test-"));
    tempRoots.push(root);
    const repo = new ResourceRepository({
      noteAssetsDirFor: (noteId) => path.join(root, noteId),
      assetUrl: (noteId, filename) => `http://127.0.0.1:19876/${noteId}/${filename}`,
      registerOrphan: () => undefined,
    });
    const originalRename = fs.renameSync;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).startsWith(path.join(root, "note"))) throw new Error("injected asset rename failure");
      return originalRename(from, to);
    }) as typeof fs.renameSync);
    try {
      expect(() => repo.upload({ bytes: [...Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(8)])], filename: "image.gif" }, "note"))
        .toThrow("injected asset rename failure");
      expect(fs.readdirSync(path.join(root, "note"))).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });
});
