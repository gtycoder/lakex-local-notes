/**
 * 便携包行收窄助手（两端共用单一来源，261122 大统一）。
 *
 * 正向映射（src/mobile/portable/portableMapping.ts）与反向映射
 * （electron/portable/mobileToDesktopMapping.ts）共用这些收窄口径；
 * 反向映射由桌面主进程消费，而 R4 禁止 electron → src/mobile ⇒ 助手放 core。
 * 行形状各自归属：正向输出类型在 portableMapping（手机 schema），反向输出类型在
 * mobileToDesktopMapping（桌面 schema），输入统一为 RawRow（SELECT * 原始行，防御式读取）。
 */

export type RawRow = Record<string, unknown>;

/** 正文目录（包内 desktop/<dir>、mobile/files/<dir> 同构；导出收集与导入搬运共用）。 */
export const PORTABLE_BODY_DIRS = ["notes", "usheets", "bitables", "boards", "inks"] as const;

export const asText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const asTextOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

export const asInt = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

export const asBoolInt = (value: unknown): number => (value === true || value === 1 || value === "1" ? 1 : 0);
