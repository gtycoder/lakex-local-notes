import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

// 默认门禁只跑 500/2000 两档；5000 仅通过 env 显式加入（opt-in，不进日常门禁）。
// 20,000 档见 perf.big.integration.test.ts（S3V3_PERF_BIG=1，同样不进默认门禁）。
const SIZES = (process.env.S3V3_PERF_SIZES || "500,2000").split(",").map(Number);
const GATE_SIZES = new Set([500, 2000, 5000]);
for (const n of SIZES) {
  if (!GATE_SIZES.has(n)) throw new Error("S3V3_PERF_SIZES 不支持 " + n + "；门禁档 = 500/2000（可选 5000），2 万档用 perf.big.integration.test.ts");
}

// 参考基线（261027 审计 §SD-12 的较慢一轮 + 261028 本机复跑，取较慢者），单位 ms。
// 全量 `vitest run` 里本文件与 470+ 文件并行，实测同一阶段可慢 3–5× ⇒ 默认绝对上界取
// 3.5× 基线 + 100ms，作灾难兜底（不误红）；定向门禁用 S3V3_PERF_STRICT=1 收紧到 1.8× + 20ms。
// 另加同轮/跨档比值断言（不依赖机台绝对速度）。口径见本文件头注释与 docs/SYNC-PROTOCOL.md §8.5（原 S3-V3-DATA-PERF §6 已删）。
const STRICT = process.env.S3V3_PERF_STRICT === "1";
const MODE = STRICT ? "strict" : "default";
type PerfBaseline = { initMs: number; noopMs: number; editMs: number; phases: Record<string, number> };
const BASELINE: Record<number, PerfBaseline> = {
  500: { initMs: 502, noopMs: 114, editMs: 296, phases: { "load-state": 127, "publish-save-state": 36, "publish-lock": 42, "publish-index": 7, "publish-finalize": 31, "pending": 25 } },
  2000: { initMs: 2726, noopMs: 199, editMs: 336, phases: { "load-state": 159, "publish-save-state": 53, "publish-lock": 42, "publish-index": 8, "publish-finalize": 41, "pending": 30 } },
  5000: { initMs: 2174, noopMs: 217, editMs: 405, phases: { "load-state": 133, "publish-save-state": 93, "publish-lock": 43, "publish-index": 11, "publish-finalize": 65, "pending": 61 } },
};
const totalCap = (ms: number) => Math.round(ms * (STRICT ? 1.8 : 3.5) + (STRICT ? 20 : 100));
const initCap = (ms: number) => Math.round(ms * (STRICT ? 2.5 : 5) + (STRICT ? 20 : 100));
const phaseCap = (ms: number) => Math.round(ms * (STRICT ? 1.8 : 3.5) + (STRICT ? 20 : 100));
const PHASES = ["load-state", "publish-save-state", "publish-lock", "publish-index", "publish-finalize", "pending"] as const;
type PerfResult = { docs: number; initMs: number; noopMs: number; noopPhases: Record<string, number>; editMs: number; editPhases: Record<string, number> };

describe("增量同步性能（桌面 Store 真实数据，假 S3）", () => {
  it("N 文档：初始/空跑/改 10 篇 的阶段耗时（默认门禁 500/2000）", async () => {
    const out: PerfResult[] = [];
    for (const n of SIZES) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-perf-" + n + "-"));
      const store = new Store(root);
      store.bootstrap();
      const nb = store.createNotebook("NB");
      for (let i = 0; i < n; i++) store.createNoteInAtTopWithContent(nb.id, "Doc " + i, "<p>body-" + i + "-" + "x".repeat(400) + "</p>", [], "perf" + i);
      const remote = new MemoryRemote();
      const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
      await device.init();
      let phases: Record<string, number> = {};
      const engine = new S3v3SyncEngine({ remote, device, deviceId: "perf", onPhase: (phase, ms) => { phases[phase] = (phases[phase] ?? 0) + ms; } });
      let t = Date.now();
      await engine.sync({ onEmptyCloud: "upload" });
      const initMs = Date.now() - t;
      phases = {};
      t = Date.now();
      await engine.sync();
      const noopMs = Date.now() - t;
      const noopPhases = { ...phases };
      for (let i = 0; i < 10; i++) store.saveNote("perf" + i, "Doc " + i, "<p>edited-" + i + "-" + "y".repeat(400) + "</p>");
      phases = {};
      t = Date.now();
      await engine.sync();
      const editMs = Date.now() - t;
      const editPhases = { ...phases };
      out.push({ docs: n, initMs, noopMs, noopPhases, editMs, editPhases });
      console.log("PERF " + JSON.stringify(out[out.length - 1]));
    }
    expect(out.length).toBe(SIZES.length);

    // ---- 门禁断言：绝对上界（防 2× 退化）+ 同轮/跨档比值（跨机台可比） ----
    const bySize = new Map<number, PerfResult>(out.map((r) => [r.docs, r]));
    for (const r of out) {
      const base = BASELINE[r.docs];
      if (!base) throw new Error("缺少 " + r.docs + " 档基线");
      expect(r.initMs).toBeLessThanOrEqual(initCap(base.initMs));
      expect(r.noopMs).toBeLessThanOrEqual(totalCap(base.noopMs));
      expect(r.editMs).toBeLessThanOrEqual(totalCap(base.editMs));
      for (const phase of PHASES) {
        expect(r.editPhases[phase] ?? 0).toBeLessThanOrEqual(phaseCap(base.phases[phase] ?? 0));
      }
      // 改 10 篇实测为空跑的 2–4×；load-state 两轮同量级（实测 ≤1.2×）。超过即退化。
      expect(r.editMs).toBeLessThanOrEqual(r.noopMs * (STRICT ? 8 : 10) + (STRICT ? 200 : 300));
      expect(r.editPhases["load-state"] ?? 0).toBeLessThanOrEqual((r.noopPhases["load-state"] ?? 0) * (STRICT ? 2 : 3) + (STRICT ? 100 : 150));
      console.log("PERF-GATE " + JSON.stringify({
        mode: MODE,
        docs: r.docs,
        caps: { initMs: initCap(base.initMs), noopMs: totalCap(base.noopMs), editMs: totalCap(base.editMs), phase: phaseCap(base.phases["load-state"] ?? 0) },
      }));
    }
    // 文档数 ×4 时阶段耗时不应超线性（实测 noop 1.2–3.6×、edit 1.0–2.2×）
    const r500 = bySize.get(500);
    const r2000 = bySize.get(2000);
    const r5000 = bySize.get(5000);
    if (r500 && r2000) {
      expect(r2000.noopMs).toBeLessThanOrEqual(r500.noopMs * (STRICT ? 5 : 8) + (STRICT ? 100 : 200));
      expect(r2000.editMs).toBeLessThanOrEqual(r500.editMs * (STRICT ? 3 : 5) + (STRICT ? 150 : 200));
    }
    if (r2000 && r5000) {
      expect(r5000.noopMs).toBeLessThanOrEqual(r2000.noopMs * (STRICT ? 3 : 5) + (STRICT ? 100 : 200));
      expect(r5000.editMs).toBeLessThanOrEqual(r2000.editMs * (STRICT ? 3 : 4) + (STRICT ? 150 : 200));
    }
  }, 600_000);
});
