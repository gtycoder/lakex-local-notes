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
import { describe, expect, it } from "vitest";

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
const LAKE_NATIVE = read("src/mobile/native/lakeNativeContract.ts");

/** 域模块（C3-5）：bridge 用 `...xxxDomain` 展开，方法名需从域文件里一起解析。 */
const DOMAIN_MODULES: Array<{ file: string; exportName: string }> = [
  { file: "src/mobile/bridge/assets.ts", exportName: "assetsDomain" },
];

function objectMethodNames(source: string, exportName: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => new RegExp("^export const " + exportName + " = \\{$").test(l));
  const out: string[] = [];
  if (start < 0) return out;
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === start) { depth = 1; continue; }
    const hit = /^  (?:async )?([a-zA-Z_$][a-zA-Z0-9_$]*)\(/.exec(line);
    if (hit && depth === 1) out.push(hit[1]);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth <= 0) break;
  }
  return out;
}

/** 解析 bridge 的一级方法名 + 域模块展开的方法名。 */
function bridgeMethods(): string[] {
  const source = read("src/mobile/bridge.ts");
  const out = objectMethodNames(source, "bridge");
  for (const mod of DOMAIN_MODULES) {
    if (source.includes("..." + mod.exportName)) out.push(...objectMethodNames(read(mod.file), mod.exportName));
  }
  return out;
}

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
  "listDeletedNotesForSync", "readDeletedContent", "markTombstonesPublished", "isFolderPurged",
];

describe("契约面归属（bridge 每个方法都要有主）", () => {
  const methods = bridgeMethods();

  it("bridge 方法集合非空（护栏自身有效性）", () => {
    expect(methods.length).toBeGreaterThan(60);
  });

  it("每个方法至少有 T1/T2/T3 之一，否则必须在 TEST_SEAM（测试观测/播种口）里显式登记", () => {
    const unowned: string[] = [];
    const classes: Record<string, string[]> = { t1: [], t2: [], t3: [], pending: [] };
    for (const name of methods) {
      const t1 = anyMatch(MOBILE_UI, new RegExp("bridge\\." + name + "\\s*\\("));
      const t2 = anyMatch(SHARED, new RegExp("native\\." + name + "\\s*\\("));
      const t3 = anyMatch(SCRIPTS, new RegExp("\\." + name + "\\s*\\(")) || LAKE_NATIVE.includes(`"${name}"`);
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

  it("lakeNative 调试契约仍是 bridge 的子集（派生实现不得漂移）", () => {
    // 只取两个名字数组（整文件正则会误抓 `typeof x !== "function"` 这类字符串）
    const arrayOf = (name: string): string[] => {
      const m = new RegExp(name + "\\s*=\\s*\\[([\\s\\S]*?)\\]").exec(LAKE_NATIVE);
      return m ? [...m[1].matchAll(/"([a-zA-Z_$][a-zA-Z0-9_$]*)"/g)].map((x) => x[1]) : [];
    };
    const declared = [...arrayOf("LAKE_NATIVE_BRIDGE_METHODS"), ...arrayOf("LAKE_NATIVE_EXTRA_METHODS")];
    expect(declared.length).toBeGreaterThan(40);
    // 附加入口（runNativeSqliteSpike / migrateSnapshotToNativeSqlite）在 LAKE_NATIVE_EXTRA_METHODS
    // 里单独登记，本就不该是 bridge 方法 ⇒ 从子集断言里排除。
    const extras = ["runNativeSqliteSpike", "migrateSnapshotToNativeSqlite"];
    const missing = declared.filter((n) => !methods.includes(n) && !extras.includes(n));
    expect(missing, "lakeNative 声明了 bridge 上不存在的方法").toEqual([]);
  });
});
