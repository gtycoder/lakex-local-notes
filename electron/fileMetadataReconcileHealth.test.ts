import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Store 模块加载会 import electron（secretCipher 的 safeStorage 分支），测试内给最小 mock。
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "./store.js";

/**
 * Batch4-B：对账报告的可读出口 = Settings→同步诊断（run_data_health_check → runDataHealthCheck）。
 * 体检自身只读；未启用/未跑过 = fileReconcile: null；注入了提供者 = 原样返回最近一次报告。
 */
describe("runDataHealthCheck 暴露 fileReconcile（只读）", () => {
  it("未注入 = null；注入后 = 最近报告；体检不写库/不跑对账", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-reconcile-health-"));
    try {
      const store = new Store(dir);
      const before = store.runDataHealthCheck();
      expect(before).toHaveProperty("fileReconcile", null);

      const report = { generatedAt: "2026-11-05T00:00:00.000Z", candidateCount: 2, candidates: [{ noteId: "x" }] };
      store.setFileReconcileReportProvider(() => report);
      expect(store.runDataHealthCheck().fileReconcile).toEqual(report);

      store.setFileReconcileReportProvider(null);
      expect(store.runDataHealthCheck().fileReconcile).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
