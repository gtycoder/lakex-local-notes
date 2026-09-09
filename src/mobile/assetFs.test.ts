import { beforeEach, describe, expect, it, vi } from "vitest";

const readdir = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { readdir },
  Directory: { Data: "DATA" },
}));

import { listAssetKeysFs, listNoteAssetKeysFs } from "./assetFs.js";

describe("mobile asset directory listing", () => {
  beforeEach(() => {
    readdir.mockReset();
  });

  it("lists one note directory without scanning the asset root", async () => {
    readdir.mockResolvedValue({ files: [{ name: "image.png", type: "file" }] });

    await expect(listNoteAssetKeysFs("note-1")).resolves.toEqual(["note-1/image.png"]);
    expect(readdir).toHaveBeenCalledTimes(1);
    expect(readdir).toHaveBeenCalledWith({ path: "note-assets/note-1", directory: "DATA" });
  });

  it("global listing includes nested quick-note assets", async () => {
    readdir.mockImplementation(async ({ path }: { path: string }) => {
      if (path === "note-assets") {
        return {
          files: [
            { name: "note-1", type: "directory" },
            { name: "quick-notes", type: "directory" },
            { name: "stray-file", type: "file" },
          ],
        };
      }
      if (path === "note-assets/note-1") {
        return { files: [{ name: "document.png", type: "file" }] };
      }
      if (path === "note-assets/quick-notes") {
        return { files: [{ name: "quick-note-1", type: "directory" }] };
      }
      if (path === "note-assets/quick-notes/quick-note-1") {
        return { files: [{ name: "snapshot.png", type: "file" }] };
      }
      throw new Error("unexpected path: " + path);
    });

    await expect(listAssetKeysFs()).resolves.toEqual([
      "note-1/document.png",
      "quick-notes/quick-note-1/snapshot.png",
    ]);
  });
});
