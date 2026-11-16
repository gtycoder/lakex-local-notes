import { describe, expect, it } from "vitest";
import { PORTABLE_IMPORT_PHASES, portableImportStep } from "./portableImportStep";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 便携包导入的阶段指示口径（261116 C）：只画如实阶段，不虚构百分比。 */
describe("portableImportStep", () => {
  it("阶段顺序 = 导入管线的真实执行顺序，序号 1 起", () => {
    expect(PORTABLE_IMPORT_PHASES).toEqual(["rollback-point", "copy-files", "read-rows", "write-rows", "baseline", "commit", "done"]);
    expect(portableImportStep("rollback-point")).toEqual({ step: 1, total: 7, done: 1 });
    expect(portableImportStep("write-rows")).toEqual({ step: 4, total: 7, done: 4 });
    expect(portableImportStep("done")).toEqual({ step: 7, total: 7, done: 7 });
  });

  it("未知阶段兜底第 1 步（不因 UI 口径抛错）", () => {
    expect(portableImportStep("not-a-phase" as never).step).toBe(1);
  });

  it("importPortable 里实际发出的 phase 全部登记在本表（新增阶段必须同步）", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.resolve(here, "../portable/importPortable.ts"), "utf8");
    const emitted = new Set([...source.matchAll(/phase:\s*"([a-z-]+)"/g)].map((match) => match[1]));
    expect(emitted.size).toBeGreaterThan(0);
    for (const phase of emitted) expect(PORTABLE_IMPORT_PHASES).toContain(phase as (typeof PORTABLE_IMPORT_PHASES)[number]);
  });
});
