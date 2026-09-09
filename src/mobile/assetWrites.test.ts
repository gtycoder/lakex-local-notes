import { describe, expect, it, vi } from "vitest";

import { stageAssetWrites } from "./assetWrites.js";

describe("stageAssetWrites", () => {
  it("rolls back a newly added asset when persistence fails", async () => {
    const memory = new Map<string, Uint8Array>();
    const remove = vi.fn(async () => {});
    const deps = {
      memory,
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
    const deps = { memory, save, remove: vi.fn(async () => {}) };

    await expect(
      stageAssetWrites([{ key: "note/image.png", bytes: next }], deps),
    ).rejects.toThrow("write failed");

    expect(memory.get("note/image.png")).toBe(previous);
    expect(save).toHaveBeenNthCalledWith(1, "note/image.png", next);
    expect(save).toHaveBeenNthCalledWith(2, "note/image.png", previous);
  });
});
