/**
 * Univer 技术验证 spike（分支 spike/univer-sheet）——独立页面，**不接入应用**。
 *
 * 覆盖目标里的硬约束：
 *  1. 严格 CSP（script-src 无 unsafe-eval）下渲染、零 securitypolicyviolation；
 *  2. JSON 快照 save()/createWorkbook() 往返；
 *  3. 公式计算 + 删行/改值重算；
 *  4. **--lake-* 三主题令牌 → Univer Theme 桥**（light/warm/dark 跟随 data-theme）；
 *  5. 只读 setEditable(false)；
 *  6. 单实例多 workbook + focusUnit 切换（多标签 keep-alive 的引擎模型）。
 */
import { createUniver, LocaleType, mergeLocales, defaultTheme, IUniverInstanceService } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import workerURL from "./univer-worker?worker&url";
import "@univerjs/preset-sheets-core/lib/index.css";
import "../styles/themes/base.css";
import "../styles/themes/light.css";
import "../styles/themes/dark.css";
import "../styles/themes/warm.css";

type Violation = { directive: string; uri: string; sample: string };
const violations: Violation[] = [];
const errors: string[] = [];
window.addEventListener("securitypolicyviolation", (e) => {
  const ev = e as SecurityPolicyViolationEvent;
  violations.push({ directive: ev.effectiveDirective, uri: ev.blockedURI || "", sample: ev.sample || "" });
});
window.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message)));
window.addEventListener("unhandledrejection", (e) => errors.push(String((e as PromiseRejectionEvent).reason)));

/** 参与映射的 --lake-* 令牌（主题桥只认这些，缺省回退 defaultTheme）。 */
const TOKENS = [
  "accent", "accent-ink", "accent-ink-press", "accent-tint",
  "bg-panel", "bg-subtle", "bg-block", "bg-canvas",
  "border-1", "border-strong",
  "text-1", "text-2", "text-3", "text-4",
  "status-error", "status-ok", "status-pending",
] as const;

function readTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const t of TOKENS) out[t] = cs.getPropertyValue("--lake-" + t).trim();
  return out;
}

/** 用我们的令牌覆盖 Univer defaultTheme 的调色板（保留其余键，Theme 形状必须完整）。 */
function buildUniverTheme(): unknown {
  const tk = readTokens();
  const theme = structuredClone(defaultTheme) as unknown as Record<string, Record<string, unknown>>;
  const set = (pal: string, shade: string, v: string) => {
    if (theme[pal] && v) theme[pal][shade] = v;
  };
  set("primary", "50", tk["accent-tint"]); set("primary", "100", tk["accent-tint"]);
  set("primary", "200", tk["accent"]); set("primary", "300", tk["accent"]);
  set("primary", "400", tk["accent"]); set("primary", "500", tk["accent"]);
  set("primary", "600", tk["accent-ink"]); set("primary", "700", tk["accent-ink-press"]);
  set("primary", "800", tk["accent-ink-press"]); set("primary", "900", tk["accent-ink-press"]);
  set("gray", "0", tk["bg-panel"]); set("gray", "50", tk["bg-subtle"]); set("gray", "100", tk["bg-block"]);
  set("gray", "200", tk["border-1"]); set("gray", "300", tk["border-strong"]);
  set("gray", "400", tk["text-4"]); set("gray", "500", tk["text-3"]); set("gray", "600", tk["text-2"]);
  set("gray", "700", tk["text-2"]); set("gray", "800", tk["text-1"]); set("gray", "900", tk["text-1"]); set("gray", "1000", tk["text-1"]);
  set("blue", "500", tk["accent"]);
  set("red", "500", tk["status-error"]);
  set("green", "500", tk["status-ok"]);
  set("orange", "500", tk["status-pending"]);
  return theme;
}

function demoWorkbook(id: string, name: string): Record<string, unknown> {
  return {
    id, name, sheetOrder: ["s1"],
    sheets: {
      s1: {
        id: "s1", name: "Sheet1", rowCount: 200, columnCount: 26,
        defaultColumnWidth: 88, defaultRowHeight: 24,
        cellData: { 0: { 0: { v: 1 }, 2: { f: "=SUM(A1:A2)" } }, 1: { 0: { v: 10 } } },
      },
    },
  };
}

type Book = {
  getId: () => string;
  save: () => Record<string, unknown>;
  setEditable: (v: boolean) => unknown;
  getActiveSheet: () => {
    getRange: (a1: string) => { getValue: () => unknown; getFormula: () => string; setValue: (v: unknown) => unknown };
    insertRows: (r: number, n: number) => unknown;
    deleteRows: (r: number, n: number) => unknown;
    getMaxRows: () => number;
  };
};

const books = new Map<string, Book>();

try {
  /** 可选 worker 路径：?worker=1 时走 UniverRPC 主/worker 线程（CSP worker-src 'self' blob:）。 */
  const useWorker = new URLSearchParams(location.search).has("worker");
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never) },
    theme: defaultTheme,
    presets: [UniverSheetsCorePreset({ container: "univer-root", ...(useWorker ? { workerURL } : {}) })],
  });

  const first = univerAPI.createWorkbook(demoWorkbook("spike-1", "Spike1") as never) as unknown as Book;
  books.set("spike-1", first);
  univerAPI.setTheme(buildUniverTheme() as never);

  const sheetOf = (id: string) => {
    const b = books.get(id);
    if (!b) throw new Error("no such workbook: " + id);
    return b.getActiveSheet();
  };
  const instanceService = univer.__getInjector().get(IUniverInstanceService) as unknown as {
    focusUnit: (id: string | null) => void;
  };

  (window as unknown as Record<string, unknown>).__spike = {
    version: "univer-1.0.3",
    worker: useWorker,
    violations,
    errors,
    listBooks: () => Array.from(books.keys()),
    save: (id: string) => books.get(id)!.save(),
    value: (id: string, a1: string) => sheetOf(id).getRange(a1).getValue(),
    formula: (id: string, a1: string) => sheetOf(id).getRange(a1).getFormula(),
    write: (id: string, a1: string, v: unknown) => { sheetOf(id).getRange(a1).setValue(v); return true; },
    deleteRow: (id: string, r: number) => { sheetOf(id).deleteRows(r, 1); return sheetOf(id).getMaxRows(); },
    createBook: (id: string, name: string) => {
      const b = univerAPI.createWorkbook(demoWorkbook(id, name) as never) as unknown as Book;
      books.set(id, b);
      return b.getId();
    },
    loadSnapshot: (snap: unknown) => {
      const clone = { ...(snap as Record<string, unknown>), id: String((snap as Record<string, unknown>).id) + "-reload" };
      const b = univerAPI.createWorkbook(clone as never) as unknown as Book;
      books.set(b.getId(), b);
      return b.getId();
    },
    // ---- 主题桥 ----
    setAppTheme: (name: string) => {
      document.documentElement.setAttribute("data-theme", name);
      univerAPI.setTheme(buildUniverTheme() as never);
      return readTokens();
    },
    tokens: () => readTokens(),
    // ---- 只读 ----
    setEditable: (id: string, v: boolean) => { books.get(id)!.setEditable(v); return v; },
    // ---- 多 workbook 切换 ----
    focusBook: (id: string) => { instanceService.focusUnit(id); return univerAPI.getActiveWorkbook()?.getId() ?? null; },
    activeBook: () => univerAPI.getActiveWorkbook()?.getId() ?? null,
  };
  (window as unknown as Record<string, unknown>).__spikeReady = true;
} catch (err) {
  errors.push(String((err as Error)?.stack || err));
  (window as unknown as Record<string, unknown>).__spikeReady = false;
  (window as unknown as Record<string, unknown>).__spike = { violations, errors };
}
