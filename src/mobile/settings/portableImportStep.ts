/**
 * 便携包导入的「分阶段进度」口径（261116 移动端加载动效 C）。
 *
 * 为什么不画百分比：runPortableImport 的进度回调只给 phase + detail，**没有字节数/总行数**；
 * 虚构百分比属于「装饰性信息」，这里只做**如实的阶段指示**：第 n/7 步。
 * 阶段顺序 = 导入管线真实执行顺序（见 portable/importPortable.ts 的 onProgress 调用点）；
 * 新增阶段必须同步本表，否则 UI 会少一格（测试卡住）。
 */
import type { PortableImportPhase } from "../portable/importPortable";

export const PORTABLE_IMPORT_PHASES: readonly PortableImportPhase[] = [
  "rollback-point",
  "copy-files",
  "read-rows",
  "write-rows",
  "baseline",
  "commit",
  "done",
];

export interface PortableImportStep {
  /** 1 起的阶段序号。 */
  step: number;
  total: number;
  /** 已完成序号（0..total；用于分段指示的填充格数）。 */
  done: number;
}

/** phase → 阶段序号；未知 phase（旧版/新增未登记）按第 1 步兜底，不抛错（导入不能因 UI 口径失败）。 */
export function portableImportStep(phase: PortableImportPhase): PortableImportStep {
  const total = PORTABLE_IMPORT_PHASES.length;
  const index = PORTABLE_IMPORT_PHASES.indexOf(phase);
  const step = index < 0 ? 1 : index + 1;
  return { step, total, done: step };
}
