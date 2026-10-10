/**
 * 移动端互斥域护栏（F16）：把 src/mobile/bridge.ts 的调用点钉在判据表上。
 *
 * 卡住三件事（任一条被破坏都会让 F16 复发或直接自锁）：
 *  1. 判据表完整性：bridge 的每个方法都必须在 src/core/maintenancePolicy.ts 里登记；
 *  2. 调用点与判据一致：runWrite 只接 write 类、runMaintenance 只接 maintenance 类，
 *     且每个 write/maintenance 类操作都真的取锁（不许"登记了却不锁"）；
 *  3. I3 无同域嵌套：同一方法体内同域只能有一个调用点，且已取锁的方法不得再调同类的
 *     bridge 方法 —— KeyedAsyncQueue 无重入，嵌套获取同域会**自锁**。
 *
 * 用源码解析而非 import：bridge 是静态对象字面量，源码即权威；也免去 Capacitor 的 mock 铺陈。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAINTENANCE_OPS, NONE_OPS, WRITE_OPS, classifyOp } from "../core/maintenancePolicy.js";

const SOURCE = readFileSync(path.join(process.cwd(), "src/mobile/bridge.ts"), "utf8");
const LINES = SOURCE.split("\n");

interface Method { name: string; from: number; to: number }

/** 解析 export const bridge = { ... } 的一级方法及其行范围（1-based）。 */
function parseBridgeMethods(): Method[] {
  const start = LINES.findIndex((l) => /^export const bridge = \{$/.test(l));
  const out: Method[] = [];
  let depth = 0;
  for (let i = start; i < LINES.length; i += 1) {
    const line = LINES[i];
    if (i === start) { depth = 1; continue; }
    const hit = /^  (?:async )?([a-zA-Z_$][a-zA-Z0-9_$]*)\(/.exec(line);
    if (hit && depth === 1) out.push({ name: hit[1], from: i + 1, to: -1 });
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth <= 0) break;
  }
  out.forEach((m, i) => { m.to = i + 1 < out.length ? out[i + 1].from : LINES.length; });
  return out;
}

const METHODS = parseBridgeMethods();
const bodyOf = (m: Method): string => LINES.slice(m.from - 1, m.to - 1).join("\n");

/** 取方法体里的取锁调用点：runWrite("op" / runMaintenance("op"。 */
function lockSites(body: string): Array<{ fn: "runWrite" | "runMaintenance"; op: string }> {
  const out: Array<{ fn: "runWrite" | "runMaintenance"; op: string }> = [];
  const re = /(runWrite|runMaintenance)\("([a-zA-Z_$][a-zA-Z0-9_$]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push({ fn: m[1] as "runWrite" | "runMaintenance", op: m[2] });
  return out;
}

/** op 名与方法名不同名的例外（附理由）。 */
const OP_NAME_EXCEPTIONS: Record<string, string> = {
  restoreTreeItem: "ensureTrashNoteAssets",
};

describe("移动端互斥域护栏（F16）", () => {
  it("判据表与 bridge 方法集合完全一致（新增/删除方法必须同时改判据）", () => {
    const policy = [...WRITE_OPS, ...MAINTENANCE_OPS, ...NONE_OPS].sort();
    const names = METHODS.map((m) => m.name).sort();
    expect(names).toEqual(policy);
  });

  it("调用点类别与判据一致，且写/维护类操作都真的取锁", () => {
    const locked = new Set<string>();
    for (const m of METHODS) {
      for (const site of lockSites(bodyOf(m))) {
        const expected = site.fn === "runWrite" ? "write" : "maintenance";
        expect(classifyOp(site.op), `${m.name} 里 ${site.fn}("${site.op}") 与判据不符`).toBe(expected);
        locked.add(site.op);
      }
    }
    for (const op of [...WRITE_OPS, ...MAINTENANCE_OPS]) {
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
    }
  });

  it("I3：已取锁的方法不得再调用同域的 bridge 方法（跨方法嵌套自锁）", () => {
    const classOf = new Map(METHODS.map((m) => [m.name, classifyOp(m.name)]));
    for (const m of METHODS) {
      const mine = classOf.get(m.name);
      if (mine !== "write" && mine !== "maintenance") continue;
      const body = bodyOf(m);
      for (const callee of classOf.keys()) {
        if (callee === m.name || classOf.get(callee) !== mine) continue;
        const called = new RegExp(`bridge\\.${callee}\\s*\\(`).test(body);
        expect(called, `${m.name}（${mine}）内部调用了同域的 bridge.${callee} ⇒ 会自锁`).toBe(false);
      }
    }
  });
});
