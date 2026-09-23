import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ available: true, backend: undefined as string | undefined }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptString: (v: string) => Buffer.from("enc:" + v),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
  },
}));

const { createSafeStorageSecretCipher } = await import("./secretCipher.js");

describe("createSafeStorageSecretCipher（fail-closed）", () => {
  afterEach(() => { state.available = true; state.backend = undefined; });

  it("可用时加密并可解回", () => {
    const c = createSafeStorageSecretCipher();
    const out = c.encrypt("sk-secret");
    expect(out.startsWith("enc:v1:")).toBe(true);
    expect(c.decrypt(out)).toBe("sk-secret");
  });

  it("safeStorage 不可用 → 抛错，绝不落明文", () => {
    state.available = false;
    const c = createSafeStorageSecretCipher();
    expect(() => c.encrypt("sk-secret")).toThrow(/安全存储/);
  });

  it("Linux basic_text 后端 → 同样拒绝", () => {
    state.backend = "basic_text";
    const c = createSafeStorageSecretCipher();
    expect(() => c.encrypt("sk-secret")).toThrow(/安全存储/);
  });

  it("旧明文仍可读（不破坏既有数据）", () => {
    const c = createSafeStorageSecretCipher();
    expect(c.decrypt("plain-old")).toBe("plain-old");
  });
});