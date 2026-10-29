import { describe, expect, it, vi } from "vitest";
import { IpcInputError } from "../../src/core/ipcLimits.js";
import type { S3Settings } from "../../src/core/syncUtils.js";
import type { IpcRegistrar } from "./registrar.js";

/**
 * SEC-02 护栏：save_s3_settings 必须在**保存前**过 validateS3Settings（强制 https、非法 URL 拒绝），
 * 否则恶意 endpoint 先存进设置表、等下一次 sync_now 才生效 —— 那时是"同步成功"路径，
 * 用户全库正文+附件已被上传到攻击者的桶。
 * 另：endpoint 变更只记 log.s3.warn（不弹窗打扰用户）。
 */
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
}));

import { registerSyncIpc, S3_SECRET_MASK } from "./registerSync.js";

type Handler = (...args: unknown[]) => unknown;
type Deps = Parameters<typeof registerSyncIpc>[1];

const VALID: S3Settings = {
  endpoint: "https://s3.cn-north-1.qiniucs.com",
  region: "cn-north-1",
  bucket: "local-lake-hebei",
  prefix: "workspace-default",
  accessKeyId: "ak-test",
  secretAccessKey: "sk-test",
  forcePathStyle: false,
};

/** 断言"被 IpcInputError 拒绝"并返回消息（一次调用，不重复触发副作用）。 */
function rejection(run: () => unknown): string {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(IpcInputError);
    return (error as Error).message;
  }
  throw new Error("预期抛出 IpcInputError，但没有抛");
}

function harness(initial: S3Settings | null) {
  let settings = initial;
  const warn = vi.fn();
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map(),
  } as unknown as IpcRegistrar;
  const store = {
    getS3Settings: () => settings,
    saveS3Settings: (next: S3Settings) => { settings = next; },
    getSyncSettings: () => ({ enabled: false, autoMode: "manual", autoIntervalMinutes: 15 }),
    logScopes: { s3: { warn } },
  };
  registerSyncIpc(ipc, {
    store: store as unknown as Deps["store"],
    quickNotes: {} as Deps["quickNotes"],
    runFullSync: async () => ({}),
    enqueueMaintenance: async (task) => task(),
    broadcastSyncProgress: () => {},
    restartGcTimers: () => {},
    restartSyncTimers: () => {},
  });
  return {
    warn,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
    current: () => settings,
  };
}

describe("SEC-02：S3 配置保存前校验", () => {
  it("明文 http（非本地）endpoint ⇒ 保存被拒，设置不变", () => {
    const h = harness(null);
    expect(rejection(() => h.call("save_s3_settings", { ...VALID, endpoint: "http://attacker.example" }))).toMatch(/HTTPS/);
    expect(h.current()).toBeNull();
  });

  it("非法 URL endpoint ⇒ 保存被拒", () => {
    const h = harness(null);
    for (const bad of ["not a url", "https://exa mple.com", "::::"]) {
      expect(rejection(() => h.call("save_s3_settings", { ...VALID, endpoint: bad }))).toMatch(/不是合法 URL/);
    }
    expect(h.current()).toBeNull();
  });

  it("https 合法 ⇒ 通过并落库；本机 http（开发）照旧放行", () => {
    const h = harness(null);
    h.call("save_s3_settings", { ...VALID });
    expect(h.current()).toMatchObject({ endpoint: VALID.endpoint, bucket: VALID.bucket });
    h.call("save_s3_settings", { ...VALID, endpoint: "http://127.0.0.1:9000" });
    expect(h.current()).toMatchObject({ endpoint: "http://127.0.0.1:9000" });
  });

  it("密文掩码回传 = 保留已存密钥（掩码本身能过非空校验）", () => {
    const h = harness({ ...VALID });
    h.call("save_s3_settings", { ...VALID, secretAccessKey: S3_SECRET_MASK, bucket: "local-lake-hebei" });
    expect(h.current()?.secretAccessKey).toBe("sk-test");
  });

  it("未配置时提交空 endpoint/密钥 ⇒ 被拒（不再静默存空配置）", () => {
    const h = harness(null);
    expect(rejection(() => h.call("save_s3_settings", { ...VALID, endpoint: "", secretAccessKey: "" }))).toMatch(/不能为空/);
    expect(h.current()).toBeNull();
  });

  it("保留既有字段长度限制（超长 / 类型错仍然拒）", () => {
    const h = harness(null);
    expect(rejection(() => h.call("save_s3_settings", { ...VALID, endpoint: "https://a.example/" + "x".repeat(3000) }))).toMatch(/endpoint 无效/);
    expect(rejection(() => h.call("save_s3_settings", { ...VALID, forcePathStyle: "false" }))).toMatch(/forcePathStyle 无效/);
  });

  it("endpoint 改向 ⇒ 记一条 log.s3.warn（不弹窗）；同目标只是写法不同不记", () => {
    const h = harness({ ...VALID });
    h.call("save_s3_settings", { ...VALID, endpoint: " https://s3.cn-north-1.qiniucs.com/ " });
    expect(h.warn).not.toHaveBeenCalled(); // 规范化后同一目标
    h.call("save_s3_settings", { ...VALID, endpoint: "https://evil.example" });
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(String(h.warn.mock.calls[0][0])).toContain("https://evil.example");
    expect(h.current()?.endpoint).toBe("https://evil.example");
  });
});
