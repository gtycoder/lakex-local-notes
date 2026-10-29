/**
 * 契约面「归属」护栏（261010：把 bridge 从"71 个方法没人知道谁在用"改成"每个都有归属"）。
 *
 * 背景：`src/mobile/bridge.ts` 是**共享契约 window.lakeNative 的移动端实现**（`src/lib/native.ts` 是类型面，
 * 共享组件用 `native.X()` 调），同时也是移动端 UI 的内部 API。方法只增不减、没人知道哪个还有人用 ——
 * 这就是"上帝对象"的真实成因（不是文件行数）。本护栏要求**每个方法至少有一类归属**：
 *
 *  · T1 移动端 UI 直接调：`src/mobile/**`（非测试）里出现 `bridge.X(`
 *  · T2 共享契约：`src/**`（非 mobile、非测试）里出现 `native.X(` —— 共享组件两端都跑，移动端**必须实现**
 *  · T3 自动化/调试契约：`scripts/**` 里出现 `.X(`，或该方法登记在 `lakeNativeContract.ts` 的名字清单里
 *
 * 三条都没有 ⇒ 只允许是 `TEST_SEAM`（**测试观测/播种口**：现存单测借它播种并观测真实行为，显式登记、只许变小）。
 * 新方法若不登记用途，本测试直接红 —— 从机制上阻止契约面无声增长。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./native/nativeSqliteDb.js", async () =>
  (await import("./native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);
vi.mock("./native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

import { bridge } from "./bridge";
import {
  LAKE_NATIVE_BRIDGE_METHODS,
  LAKE_NATIVE_EXTRA_METHODS,
  LAKE_NATIVE_METHODS,
  buildLakeNative,
} from "./native/lakeNativeContract";
import * as nativeSqlite from "./native/nativeSqlite";

const ROOT = process.cwd();
const read = (f: string): string => readFileSync(path.join(ROOT, f), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (name === "node_modules") continue;
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const SRC = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
const SCRIPTS = walk("scripts").filter((f) => /\.(mjs|ts|js)$/.test(f));
const MOBILE_UI = SRC.filter((f) => f.startsWith("src/mobile/") && f !== "src/mobile/bridge.ts" && !/\.test\./.test(f));
const SHARED = SRC.filter((f) => !f.startsWith("src/mobile/") && !/\.test\./.test(f));

const anyMatch = (files: string[], re: RegExp): boolean => files.some((f) => re.test(read(f)));

/**
 * 显式登记的"暂无归属"方法（只许变小）。
 * 这些目前只被单测引用、既不在移动端 UI 路径、也不在共享契约、也不在自动化契约里：
 * 属**已登记的待定/待清**，不是"忘了管"。下次动这一带时逐个定：接进 UI、登记进 lakeNative 契约、或删除。
 */
const TEST_SEAM: string[] = [
  // 移动端 GC 账本 / 墓碑三族：**生产走的是 gcRepository 直调与 dbPort**（见 bridge.ts L902/950/954/963、L1009-1012），
  // 这几个只是把它们再暴露一份；现存单测用它们做「播种 + 观测」来验证真实行为（GC 分批删除 / 维护队列 / 墓碑发布 / folder 防复活）。
  "addS3GcPending", "removeS3GcPending", "recordS3GcLog",
  // 261028：桌面端 s3_gc_pending 链路已删；移动端保留（资源管理诊断显示 gcPendingCount 走
  // diagnosticsRepository 直读，桥方法仅单测/预留），因此登记为 test seam。
  "listS3GcPending",
  "listDeletedNotesForSync", "readDeletedContent", "isFolderPurged",
];

describe("契约面归属（bridge 每个方法都要有主）", () => {
  const methods = Object.keys(bridge);

  it("bridge 方法集合非空（护栏自身有效性）", () => {
    expect(methods.length).toBeGreaterThan(60);
  });

  it("每个方法至少有 T1/T2/T3 之一，否则必须在 TEST_SEAM（测试观测/播种口）里显式登记", () => {
    const unowned: string[] = [];
    const classes: Record<string, string[]> = { t1: [], t2: [], t3: [], pending: [] };
    for (const name of methods) {
      const t1 = anyMatch(MOBILE_UI, new RegExp("bridge\\." + name + "\\s*\\("));
      const t2 = anyMatch(SHARED, new RegExp("native\\." + name + "\\s*\\("));
      const t3 = anyMatch(SCRIPTS, new RegExp("\\." + name + "\\s*\\("))
        || (LAKE_NATIVE_BRIDGE_METHODS as readonly string[]).includes(name)
        || (LAKE_NATIVE_EXTRA_METHODS as readonly string[]).includes(name);
      if (t1) classes.t1.push(name);
      else if (t2) classes.t2.push(name);
      else if (t3) classes.t3.push(name);
      else { classes.pending.push(name); unowned.push(name); }
    }
    // 只被单测引用的必须已在 TEST_SEAM 登记；登记了但已获得归属的必须从清单移除（清单只许变小）
    expect(unowned.sort(), "无归属方法必须显式登记在 TEST_SEAM（测试观测/播种口）").toEqual([...TEST_SEAM].sort());
    expect(classes.t1.length, "T1 移动端 UI 直接调").toBeGreaterThan(40);
  });

  it("TEST_SEAM 里没有已被删除/已获得归属的方法（清单只许变小）", () => {
    const stale = TEST_SEAM.filter((n) => !methods.includes(n));
    expect(stale, "TEST_SEAM 里的方法已不存在，请删掉条目").toEqual([]);
  });

  it("lakeNative 契约从真实 bridge / extra 导出派生，声明的方法必须可调用", () => {
    const extra = nativeSqlite as unknown as Record<string, unknown>;
    expect(Object.keys(buildLakeNative({ bridge, extra })).sort()).toEqual([...LAKE_NATIVE_METHODS].sort());
    expect(LAKE_NATIVE_BRIDGE_METHODS.filter((name) => typeof bridge[name as keyof typeof bridge] !== "function")).toEqual([]);
    expect(LAKE_NATIVE_EXTRA_METHODS.filter((name) => typeof extra[name] !== "function")).toEqual([]);
  });
});
