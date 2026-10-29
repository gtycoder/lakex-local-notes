import { beforeEach, describe, expect, it, vi } from "vitest";

const readdir = vi.hoisted(() => vi.fn());
const writeFile = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const deleteFile = vi.hoisted(() => vi.fn());
const mkdir = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { readdir, writeFile, readFile, deleteFile, mkdir },
  Directory: { Data: "DATA" },
}));

import {
  listAssetKeysFs,
  listNoteAssetKeysFs,
  loadAssetBytesFs,
  removeAssetBytesFs,
  saveAssetBytesFs,
} from "./assetFs.js";

describe("mobile asset filesystem", () => {
  beforeEach(() => {
    readdir.mockReset();
    writeFile.mockReset();
    readFile.mockReset();
    deleteFile.mockReset();
    mkdir.mockReset();
    mkdir.mockResolvedValue({ uri: "file:///data/user/0/com.lakexlocalnotes.android/files/x" });
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
            { name: "quick-notes", type: "directory" }, // 旧布局残留：不再作为小记资源根
            { name: "stray-file", type: "file" },
          ],
        };
      }
      if (path === "note-assets/note-1") {
        return { files: [{ name: "document.png", type: "file" }] };
      }
      if (path === "quick-notes/assets") {
        return { files: [{ name: "quick-note-1", type: "directory" }] };
      }
      if (path === "quick-notes/assets/quick-note-1") {
        return { files: [{ name: "snapshot.png", type: "file" }] };
      }
      throw new Error("unexpected path: " + path);
    });

    await expect(listAssetKeysFs()).resolves.toEqual([
      "note-1/document.png",
      "quick-notes/quick-note-1/snapshot.png",
    ]);
  });

  it("writes only validated asset key segments", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await saveAssetBytesFs("quick-notes/note-1/image.png", bytes);
    expect(writeFile).toHaveBeenCalledWith({
      path: "quick-notes/assets/note-1/image.png",
      data: expect.any(String),
      directory: "DATA",
      recursive: true,
    });

    await expect(saveAssetBytesFs("../note-1/image.png", bytes)).rejects.toThrow("非法资产键");
    await expect(saveAssetBytesFs("note-1/..", bytes)).rejects.toThrow("非法资产键");
    await expect(saveAssetBytesFs("note-1/a\\b.png", bytes)).rejects.toThrow("非法资产键");
  });

  it("returns null only for missing files and propagates read failures", async () => {
    const missing = Object.assign(new Error("File does not exist"), { code: "ENOENT" });
    readFile.mockRejectedValueOnce(missing);
    await expect(loadAssetBytesFs("note-1/missing.png")).resolves.toBeNull();

    readFile.mockRejectedValueOnce(new Error("permission denied"));
    await expect(loadAssetBytesFs("note-1/image.png")).rejects.toThrow("permission denied");
  });

  it("survives concurrent new-directory race: pre-creates parent and retries once on OS-PLUG-FILE-0011", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    writeFile
      .mockRejectedValueOnce(new Error("Missing parent directory – possibly recursive=false was passed or parent directory creation failed."))
      .mockResolvedValueOnce({ uri: "file:///data/user/0/com.lakexlocalnotes.android/files/note-assets/note-1/new.png" });
    await expect(saveAssetBytesFs("note-1/new.png", bytes)).resolves.toBeUndefined();
    // 写前 mkdir 父目录 + 失败后再次 mkdir（两次）
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(mkdir).toHaveBeenNthCalledWith(1, { path: "note-assets/note-1", directory: "DATA", recursive: true });
    expect(writeFile).toHaveBeenCalledTimes(2);
    // 非该错误原样抛出，不重试
    writeFile.mockReset();
    writeFile.mockRejectedValueOnce(new Error("permission denied"));
    mkdir.mockClear();
    await expect(saveAssetBytesFs("note-1/other.png", bytes)).rejects.toThrow("permission denied");
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("keeps deletion idempotent without hiding IO failures", async () => {
    deleteFile.mockRejectedValueOnce(new Error("File does not exist"));
    await expect(removeAssetBytesFs("note-1/missing.png")).resolves.toBeUndefined();

    deleteFile.mockRejectedValueOnce(new Error("permission denied"));
    await expect(removeAssetBytesFs("note-1/image.png")).rejects.toThrow("permission denied");
  });
});
