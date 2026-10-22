import { describe, expect, it, vi } from "vitest";

import { stageAssetWrites } from "./assetWrites.js";

describe("stageAssetWrites", () => {
  it("rolls back a newly added asset when persistence fails", async () => {
    const memory = new Map<string, Uint8Array>();
    const remove = vi.fn(async () => {});
    const deps = {
      memory,
      read: vi.fn(async () => null),
      save: vi.fn(async () => {
        throw new Error("disk full");
      }),
      remove,
    };

    await expect(
      stageAssetWrites([{ key: "note/image.png", bytes: new Uint8Array([1]) }], deps),
    ).rejects.toThrow("disk full");

    expect(memory.has("note/image.png")).toBe(false);
    expect(remove).toHaveBeenCalledWith("note/image.png");
  });

  it("restores the previous in-memory asset after a failed overwrite", async () => {
    const previous = new Uint8Array([1, 2, 3]);
    const next = new Uint8Array([4, 5, 6]);
    const memory = new Map([["note/image.png", previous]]);
    const save = vi.fn(async (_key: string, bytes: Uint8Array) => {
      if (bytes === next) throw new Error("write failed");
    });
    const deps = { memory, read: vi.fn(async () => null), save, remove: vi.fn(async () => {}) };

    await expect(
      stageAssetWrites([{ key: "note/image.png", bytes: next }], deps),
    ).rejects.toThrow("write failed");

    expect(memory.get("note/image.png")).toBe(previous);
    expect(save).toHaveBeenNthCalledWith(1, "note/image.png", next);
    expect(save).toHaveBeenNthCalledWith(2, "note/image.png", previous);
  });

  it("memory 未加载但磁盘已有旧文件时，回滚恢复磁盘旧字节而不是删除", async () => {
    const diskPrevious = new Uint8Array([7, 8, 9]);
    const next = new Uint8Array([4, 5, 6]);
    const memory = new Map<string, Uint8Array>();
    const save = vi.fn(async (_key: string, bytes: Uint8Array) => {
      if (bytes === next) throw new Error("write failed");
    });
    const remove = vi.fn(async () => {});

    await expect(stageAssetWrites([{ key: "note/disk.png", bytes: next }], {
      memory,
      read: vi.fn(async () => diskPrevious),
      save,
      remove,
    })).rejects.toThrow("write failed");

    expect(memory.get("note/disk.png")).toBe(diskPrevious);
    expect(save).toHaveBeenNthCalledWith(2, "note/disk.png", diskPrevious);
    expect(remove).not.toHaveBeenCalled();
  });
});
