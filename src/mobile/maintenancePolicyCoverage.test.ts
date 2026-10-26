/**
 * 移动端互斥域登记与调用点报告（F16）。
 *
 * 这里保留静态报告：判据表完整性、取锁类别/op 名与 I3 嵌套风险。
 * 「锁是否真的包住网络工作、不同域是否真的不交错」由 bridge/syncGc.test.ts 的
 * 真实操作时间线验证；静态扫描不能单独证明行为安全。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAINTENANCE_OPS, NONE_OPS, PRIORITY_OPS, WRITE_OPS, classifyOp } from "../core/maintenancePolicy.js";

const BRIDGE_FILE = "src/mobile/bridge.ts";
/** 域模块（C3-5）：bridge 用 `...xxxDomain` 展开，方法体也要一起扫（取锁点可能在域文件里）。 */
const DOMAIN_MODULES: Array<{ file: string; exportName: string }> = [
  { file: "src/mobile/bridge/assets.ts", exportName: "assetsDomain" },
  { file: "src/mobile/bridge/sync.ts", exportName: "syncDomain" },
  { file: "src/mobile/bridge/notes.ts", exportName: "notesDomain" },
  { file: "src/mobile/bridge/quickNotes.ts", exportName: "quickNotesDomain" },
  { file: "src/mobile/bridge/tree.ts", exportName: "treeDomain" },
  { file: "src/mobile/bridge/home.ts", exportName: "homeDomain" },
];

interface Method { name: string; file: string; from: number; to: number }

/** 解析 `export const xxx = { ... }` 的一级方法及其行范围（1-based）。 */
function parseObjectMethods(file: string, exportName: string): Method[] {
  const lines = readFileSync(path.join(process.cwd(), file), "utf8").split("\n");
  const start = lines.findIndex((l) => new RegExp("^export const " + exportName + " = \\{$").test(l));
  const out: Method[] = [];
  if (start < 0) return out;
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === start) { depth = 1; continue; }
    const hit = /^  (?:async )?([a-zA-Z_$][a-zA-Z0-9_$]*)\(/.exec(line);
    if (hit && depth === 1) out.push({ name: hit[1], file, from: i + 1, to: -1 });
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth <= 0) break;
  }
  out.forEach((m, i) => { m.to = i + 1 < out.length ? out[i + 1].from : lines.length + 1; });
  return out;
}

const bridgeSource = readFileSync(path.join(process.cwd(), BRIDGE_FILE), "utf8");
const METHODS: Method[] = parseObjectMethods(BRIDGE_FILE, "bridge");
for (const mod of DOMAIN_MODULES) {
  if (bridgeSource.includes("..." + mod.exportName)) METHODS.push(...parseObjectMethods(mod.file, mod.exportName));
}

const bodyOf = (m: Method): string => {
  const lines = readFileSync(path.join(process.cwd(), m.file), "utf8").split("\n");
  return lines.slice(m.from - 1, m.to - 1).join("\n");
};

/** 取方法体里的取锁调用点：runWrite("op" / runMaintenance("op" / runPriority("op"。 */
function lockSites(body: string): Array<{ fn: "runWrite" | "runMaintenance" | "runPriority"; op: string }> {
  const out: Array<{ fn: "runWrite" | "runMaintenance" | "runPriority"; op: string }> = [];
  const re = /(runWrite|runMaintenance|runPriority)\("([a-zA-Z_$][a-zA-Z0-9_$]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push({ fn: m[1] as "runWrite" | "runMaintenance" | "runPriority", op: m[2] });
  return out;
}

/** 取锁函数 → 判据类别。 */
const CLASS_OF_FN: Record<"runWrite" | "runMaintenance" | "runPriority", string> = {
  runWrite: "write",
  runMaintenance: "maintenance",
  runPriority: "priority",
};

/** op 名与方法名不同名的例外（附理由）。 */
const OP_NAME_EXCEPTIONS: Record<string, string> = {
  restoreTreeItem: "ensureTrashNoteAssets",
  // 261026 按需资产：打开文档时后台补拉该篇缺失媒体，语义同为「保证该篇资产本地化」。
  readNote: "ensureTrashNoteAssets",
};

describe("移动端互斥域登记与调用点报告（F16）", () => {
  it("判据表与 bridge 方法集合完全一致（新增/删除方法必须同时改判据）", () => {
    const policy = [...WRITE_OPS, ...MAINTENANCE_OPS, ...PRIORITY_OPS, ...NONE_OPS].sort();
    const names = METHODS.map((m) => m.name).sort();
    expect(names).toEqual(policy);
  });

  it("报告：取锁类别与判据一致，登记的写/维护类操作都有取锁调用点", () => {
    const locked = new Set<string>();
    for (const m of METHODS) {
      for (const site of lockSites(bodyOf(m))) {
        const expected = CLASS_OF_FN[site.fn];
        expect(classifyOp(site.op), `${m.name} 里 ${site.fn}("${site.op}") 与判据不符`).toBe(expected);
        locked.add(site.op);
      }
    }
    for (const op of [...WRITE_OPS, ...MAINTENANCE_OPS, ...PRIORITY_OPS]) {
      expect(locked.has(op), `操作 ${op} 登记为取锁，但源码里没有任何取锁调用点`).toBe(true);
    }
  });

  it("取锁调用的 op 名 = 所属方法名（唯一例外见 OP_NAME_EXCEPTIONS）", () => {
    for (const m of METHODS) {
      for (const site of lockSites(bodyOf(m))) {
        const expectedOp = OP_NAME_EXCEPTIONS[m.name] === site.op ? site.op : m.name;
        expect(site.op, `${m.name} 里的取锁操作名应为 ${expectedOp}`).toBe(expectedOp);
      }
    }
  });

  it("I3：同一方法体内同域只能有一个取锁调用点（KeyedAsyncQueue 无重入 ⇒ 嵌套必自锁）", () => {
    for (const m of METHODS) {
      const sites = lockSites(bodyOf(m));
      expect(sites.filter((s) => s.fn === "runWrite").length, `${m.name} 内有多个 runWrite（会自锁）`).toBeLessThanOrEqual(1);
      expect(sites.filter((s) => s.fn === "runMaintenance").length, `${m.name} 内有多个 runMaintenance（会自锁）`).toBeLessThanOrEqual(1);
      expect(sites.filter((s) => s.fn === "runPriority").length, `${m.name} 内有多个 runPriority（会自锁）`).toBeLessThanOrEqual(1);
    }
  });

  it("I3：已取锁的方法不得再调用同域的 bridge 方法（跨方法嵌套自锁）", () => {
    const classOf = new Map(METHODS.map((m) => [m.name, classifyOp(m.name)]));
    for (const m of METHODS) {
      const mine = classOf.get(m.name);
      if (mine !== "write" && mine !== "maintenance" && mine !== "priority") continue;
      const body = bodyOf(m);
      for (const callee of classOf.keys()) {
        if (callee === m.name || classOf.get(callee) !== mine) continue;
        const called = new RegExp(`bridge\\.${callee}\\s*\\(`).test(body);
        expect(called, `${m.name}（${mine}）内部调用了同域的 bridge.${callee} ⇒ 会自锁`).toBe(false);
      }
    }
  });
});
