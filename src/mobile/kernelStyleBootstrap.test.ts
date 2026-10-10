/**
 * 移动端内核样式护栏：**懒加载入口若会挂内核，必须自带内核样式**。
 *
 * 依据（真实缺陷，261009）：小记编辑器作为冷启动后**第一个**内核消费者时，渲染成大图标 + 原生 `<input type=file>` ——
 * 根因是内核样式表只由**文档编辑器**模块 import：先开文档就正常、先开小记就崩。事后在小记侧补了 import。
 * 261010 复查同类路径时又发现一处：**`TrashPreviewPage`（设置 → 回收站 → 预览，懒加载）挂了 `LakeEditor` 但没有内核样式**——
 * 冷启动直接走这条路径同样是"第一个内核消费者"。本测试把这条规则固化。
 *
 * 规则：对每个 `lazy(() => import("m"))` 入口模块 m，若 {m 自身 + m 的直接相对 import} 里出现内核挂载点
 * （`LakeEditor` / `lakeRuntime` / `createOpenEditor` / `createLakeDocument`），则该集合里必须出现内核样式
 * （`@dlient/lakex-doc-react/style.css`）。**直接 import 一层即可**（懒入口的子树由打包器一并加载）。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(path.join(ROOT, p), "utf8");

/** 递归收集 src/mobile 下的 tsx/ts。 */
function walk(dir: string, out: string[] = []): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.posix.join(dir, name);
    const abs = path.join(ROOT, rel);
    if (statSync(abs).isDirectory()) walk(rel, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(rel);
  }
  return out;
}

const MOBILE_FILES = walk("src/mobile");

/** 把相对 import specifier 解析成仓库内文件（试 .tsx/.ts/index）。 */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.posix.join(path.posix.dirname(fromFile), spec);
  for (const cand of [base + ".tsx", base + ".ts", path.posix.join(base, "index.tsx"), path.posix.join(base, "index.ts")]) {
    if (existsSync(path.join(ROOT, cand))) return cand;
  }
  return null;
}

function relativeImports(file: string): string[] {
  const src = read(file);
  const specs = [...src.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
  return specs.map((s) => resolveImport(file, s)).filter((x): x is string => x !== null);
}

const MOUNT_MARKERS = ["LakeEditor", "lakeRuntime", "createOpenEditor", "createLakeDocument"];
const CSS_MARKER = "@dlient/lakex-doc-react/style.css";
const mentions = (file: string, markers: string[]): boolean => {
  const src = read(file);
  return markers.some((m) => src.includes(m));
};

/** 所有 lazy 入口（懒加载模块本身）。 */
function lazyEntries(): string[] {
  const out = new Set<string>();
  for (const file of MOBILE_FILES) {
    const src = read(file);
    for (const m of src.matchAll(/lazy\(\(\)\s*=>\s*import\("(\.[^"]+)"\)/g)) {
      const resolved = resolveImport(file, m[1]);
      if (resolved) out.add(resolved);
    }
  }
  return [...out];
}

describe("移动端内核样式：懒加载入口自带（261009/261010 缺陷类）", () => {
  const entries = lazyEntries();

  it("至少能识别出懒加载入口（护栏自身有效性）", () => {
    expect(entries.length).toBeGreaterThanOrEqual(3);
  });

  it("会挂内核的懒入口必须带内核样式（自身或直接 import 层）", () => {
    const offenders: string[] = [];
    for (const entry of entries) {
      const subtree = [entry, ...relativeImports(entry)];
      const mountsKernel = subtree.some((f) => mentions(f, MOUNT_MARKERS));
      if (!mountsKernel) continue;
      const hasCss = subtree.some((f) => read(f).includes(CSS_MARKER));
      if (!hasCss) offenders.push(entry);
    }
    expect(offenders, "这些懒入口会挂内核但没有内核样式：" + offenders.join(", ")).toEqual([]);
  });
});
