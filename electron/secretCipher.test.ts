import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({ available: true, backend: undefined as string | undefined }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptString: (v: string) => Buffer.from("enc:" + v),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
  },
}));

const { createLocalSecretCipher } = await import("./secretCipher.js");
const { exportWorkspaceBackup } = await import("./workspaceBackup.js");

describe("createLocalSecretCipher（本机加密 enc:v2，261201 裁决）", () => {
  let userDir: string;
  afterEach(() => { state.available = true; state.backend = undefined; if (userDir) rmSync(userDir, { recursive: true, force: true }); });
  const freshDir = () => (userDir = mkdtempSync(path.join(os.tmpdir(), "secret-cipher-")));

  it("加密往返可解回；密文 enc:v2: 前缀且不含明文；两次加密不同（随机 nonce）", () => {
    const c = createLocalSecretCipher(freshDir());
    const out = c.encrypt("sk-secret");
    expect(out.startsWith("enc:v2:")).toBe(true);
    expect(out).not.toContain("sk-secret");
    expect(c.decrypt(out)).toBe("sk-secret");
    expect(c.encrypt("sk-secret")).not.toBe(out);
  });

  it("钥匙文件首次使用生成 32 字节、0600 权限；跨实例复用同一钥匙（换钥会丢密文）", () => {
    const dir = freshDir();
    const c1 = createLocalSecretCipher(dir);
    const out = c1.encrypt("sk-secret");
    const keyPath = path.join(dir, "machine.key");
    expect(statSync(keyPath).size).toBe(32);
    if (process.platform !== "win32") expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    const c2 = createLocalSecretCipher(dir);
    expect(c2.decrypt(out)).toBe("sk-secret"); // 同 userData ⇒ 同钥匙 ⇒ 可解
  });

  it("v1（safeStorage）旧密文可解；再次保存即换 v2（惰性迁移）", () => {
    const c = createLocalSecretCipher(freshDir());
    const legacy = "enc:v1:" + Buffer.from("enc:sk-legacy").toString("base64"); // 桩的 encryptString 产物
    expect(c.decrypt(legacy)).toBe("sk-legacy");
    expect(c.encrypt(c.decrypt(legacy)).startsWith("enc:v2:")).toBe(true);
  });

  it("v1 且 safeStorage 不可用 ⇒ 空串（未配置口径，绝不回显密文）", () => {
    state.available = false;
    const c = createLocalSecretCipher(freshDir());
    const legacy = "enc:v1:" + Buffer.from("enc:sk-legacy").toString("base64");
    expect(c.decrypt(legacy)).toBe("");
  });

  it("S2：旧明文格式不放行，返回空串提示重配", () => {
    const c = createLocalSecretCipher(freshDir());
    expect(c.decrypt("plain-old")).toBe("");
  });

  it("密文被篡改 ⇒ GCM 校验失败返回空串（不抛、不回显）", () => {
    const c = createLocalSecretCipher(freshDir());
    const out = c.encrypt("sk-secret");
    const blob = Buffer.from(out.slice("enc:v2:".length), "base64");
    blob[blob.length - 1] ^= 0xff;
    expect(c.decrypt("enc:v2:" + blob.toString("base64"))).toBe("");
  });

  it("钥匙文件损坏（长度不符）⇒ encrypt 拒绝保存；decrypt 返回空串", () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, "machine.key"), Buffer.from("short"));
    const c = createLocalSecretCipher(dir);
    expect(() => c.encrypt("sk-secret")).toThrow(/钥匙文件损坏/);
    expect(c.decrypt("enc:v2:" + Buffer.alloc(40).toString("base64"))).toBe("");
  });

  it("钥匙丢失（换机/恢复场景）⇒ 旧密文解不开返回空串（未配置），新密文照常可解", () => {
    const dir = freshDir();
    const old = createLocalSecretCipher(dir).encrypt("sk-old");
    rmSync(path.join(dir, "machine.key"));
    const c = createLocalSecretCipher(dir);
    expect(c.decrypt(old)).toBe("");
    expect(c.decrypt(c.encrypt("sk-new"))).toBe("sk-new");
  });

  it("解析畸形 base64/超短密文 ⇒ 空串，不抛", () => {
    const c = createLocalSecretCipher(freshDir());
    expect(c.decrypt("enc:v2:AAAA")).toBe("");
  });
});

describe("备份/导出白名单不含 machine.key（只进不出，261201 实测核对）", () => {
  it("整库备份只复制工作区：userData 根的 machine.key 不随包", () => {
    const userData = mkdtempSync(path.join(os.tmpdir(), "secret-userdata-"));
    const target = mkdtempSync(path.join(os.tmpdir(), "secret-backup-"));
    try {
      const ws = path.join(userData, "workspace-default");
      mkdirSync(path.join(ws, "notes"), { recursive: true });
      writeFileSync(path.join(ws, "notes", "doc.lake"), "body");
      createLocalSecretCipher(userData).encrypt("sk-x"); // 生成 <userData>/machine.key（生产装配口径）
      expect(existsSync(path.join(userData, "machine.key"))).toBe(true);
      exportWorkspaceBackup(ws, target, () => {}, () => {});
      expect(existsSync(path.join(target, "notes", "doc.lake"))).toBe(true); // 工作区内容在
      expect(existsSync(path.join(target, "machine.key"))).toBe(false);     // 钥匙只进不出
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });
});
