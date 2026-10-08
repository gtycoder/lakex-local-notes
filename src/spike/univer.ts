/**
 * Univer 技术验证 spike（分支 spike/univer-sheet）——独立页面，**不接入应用**。
 *
 * 目的：在真实 Chromium + 真实 CSP 下验证接入 Univer 的硬约束：
 *  1. 严格 CSP（script-src 无 unsafe-eval）下能渲染、零 securitypolicyviolation；
 *  2. JSON 快照 save() / createWorkbook() 往返（换 id）；
 *  3. 公式计算 + **删除行后重算**（FortuneSheet #650 的对照）；
 *  4. 主题 setTheme 切换；
 *  5. 同一 Univer 实例下多 workbook 数据隔离（替代 keep-alive 多组件挂载）。
 */
import { createUniver, LocaleType, mergeLocales, defaultTheme, darkBlueTheme } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";

type Violation = { directive: string; uri: string; sample: string };
const violations: Violation[] = [];
const errors: string[] = [];

window.addEventListener("securitypolicyviolation", (e) => {
  const ev = e as SecurityPolicyViolationEvent;
  violations.push({ directive: ev.effectiveDirective, uri: ev.blockedURI || "", sample: ev.sample || "" });
});
window.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message)));
window.addEventListener("unhandledrejection", (e) => errors.push(String((e as PromiseRejectionEvent).reason)));

/** A1=1, A2=10, C1==SUM(A1:A2)；删掉 A2 行后 C1 应重算为 1。 */
function demoWorkbook(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    sheetOrder: ["s1"],
    sheets: {
      s1: {
        id: "s1",
        name: "Sheet1",
        rowCount: 200,
        columnCount: 26,
        defaultColumnWidth: 88,
        defaultRowHeight: 24,
        cellData: {
          0: { 0: { v: 1 }, 2: { f: "=SUM(A1:A2)" } },
          1: { 0: { v: 10 } },
        },
      },
    },
  };
}

type RangeLike = { getValue: () => unknown; getFormula: () => string; setValue: (v: unknown) => unknown };
type Book = {
  getId: () => string;
  save: () => Record<string, unknown>;
  getActiveSheet: () => {
    getRange: (a1: string) => RangeLike;
    insertRows: (r: number, n: number) => unknown;
    deleteRows: (r: number, n: number) => unknown;
    getMaxRows: () => number;
  };
};

const books = new Map<string, Book>();

try {
  const { univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never) },
    theme: defaultTheme,
    presets: [UniverSheetsCorePreset({ container: "univer-root" })],
  });

  const first = univerAPI.createWorkbook(demoWorkbook("spike-1", "Spike1") as never) as unknown as Book;
  books.set("spike-1", first);

  const sheetOf = (id: string) => {
    const b = books.get(id);
    if (!b) throw new Error("no such workbook: " + id);
    return b.getActiveSheet();
  };
  const read = (id: string, a1: string) => sheetOf(id).getRange(a1).getValue();
  const formulaOf = (id: string, a1: string) => sheetOf(id).getRange(a1).getFormula();

  (window as unknown as Record<string, unknown>).__spike = {
    version: "univer-1.0.3",
    violations,
    errors,
    listBooks: () => Array.from(books.keys()),
    save: (id: string) => books.get(id)!.save(),
    value: (id: string, a1: string) => read(id, a1),
    formula: (id: string, a1: string) => formulaOf(id, a1),
    write: (id: string, a1: string, v: unknown) => { sheetOf(id).getRange(a1).setValue(v); return true; },
    writeFormula: (id: string, a1: string, f: string) => { sheetOf(id).getRange(a1).setValue({ f }); return true; },
    insertRow: (id: string, r: number) => { sheetOf(id).insertRows(r, 1); return sheetOf(id).getMaxRows(); },
    deleteRow: (id: string, r: number) => { sheetOf(id).deleteRows(r, 1); return sheetOf(id).getMaxRows(); },
    setTheme: (which: string) => { univerAPI.setTheme((which === "dark" ? darkBlueTheme : defaultTheme) as never); return which; },
    createBook: (id: string, name: string) => {
      const b = univerAPI.createWorkbook(demoWorkbook(id, name) as never) as unknown as Book;
      books.set(id, b);
      return b.getId();
    },
    loadSnapshot: (snap: unknown) => {
      // 换一个 unit id，避免与已存在的 workbook 冲突（Univer 的 unit id 必须唯一）。
      const clone = { ...(snap as Record<string, unknown>), id: String((snap as Record<string, unknown>).id) + "-reload" };
      const b = univerAPI.createWorkbook(clone as never) as unknown as Book;
      books.set(b.getId(), b);
      return b.getId();
    },
  };
  (window as unknown as Record<string, unknown>).__spikeReady = true;
} catch (err) {
  errors.push(String((err as Error)?.stack || err));
  (window as unknown as Record<string, unknown>).__spikeReady = false;
  (window as unknown as Record<string, unknown>).__spike = { violations, errors };
}
