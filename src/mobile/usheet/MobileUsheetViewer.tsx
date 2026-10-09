/**
 * 移动端表格查看器（kind=usheet，只读）。
 *
 * 与桌面 `src/features/usheet/UniverSheetEditor.tsx` **同一套内核**（Univer），移动端只做**只读呈现**：
 * 不挂工具条 / 公式栏、`setEditable(false)`、**不保存、不写库**（正文是内部 JSON，绝不喂给 Lake 编辑器）。
 * - **首次可见才挂载**：隐藏容器量到 0 尺寸，canvas 引擎渲不出来；挂载后 keep-alive。
 * - **资源**：正文里图片 drawing 的 `source` 是资产 filename ⇒ 本机 AssetServer 的 canonical URL（带 token）。
 * - **分包**：Univer 运行时只随本模块按需请求，**绝不进移动端入口 chunk**（由 `mobileLazyChunks.test.ts` 卡住）。
 * - 与桌面共用纯核心：正文解析 = `core/usheetDoc.ts`，主题桥 = `features/usheet/univerTheme.ts`。
 */
import { useEffect, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales, type FUniver } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import drawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import { buildUniverTheme } from "../../features/usheet/univerTheme";
import { emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody } from "../../core/usheetDoc.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";

/** 是否带 URL scheme（data:/blob:/http(s): 原样；裸文件名才是我们的资产）。 */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** 正文里的图片 source（资产 filename）→ 本机 AssetServer canonical URL（带 token）；已是 URL 的原样。 */
export function usheetImageSrc(src: string, noteId: string): string {
  if (HAS_SCHEME_RE.test(src)) return src;
  return withAssetAccessToken(localAssetHttpUrl(noteId, src));
}

export interface MobileUsheetViewerProps {
  noteId: string;
  content: string;
  /** 该 tab 是否为当前活动 tab（未活动过就不建实例）。 */
  active: boolean;
}

export function MobileUsheetViewer({ noteId, content, active }: MobileUsheetViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [everActive, setEverActive] = useState(active);
  const [ready, setReady] = useState(false);
  const containerId = "mobile-usheet-" + noteId;

  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  // 首次可见 + 容器有高度后才挂载（隐藏容器 0 尺寸 ⇒ canvas 引擎渲不出来）
  useEffect(() => {
    if (!everActive || ready || !active) return;
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const measure = () => {
      if (host.clientHeight === 0) { raf = window.requestAnimationFrame(measure); return; }
      setReady(true);
    };
    measure();
    return () => { if (raf) window.cancelAnimationFrame(raf); };
  }, [everActive, ready, active]);

  // 只读挂载（一次）；主题变化只重设 Theme，不重建实例。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const workbook = parseUsheetBody(content)?.workbook ?? emptyUsheetWorkbook();
    mapUsheetImageSources(workbook, (src) => usheetImageSrc(src, noteId));
    let created: { univer: { dispose: () => void }; univerAPI: FUniver } | null = null;
    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never, drawingZhCN as never) },
        theme: buildUniverTheme() as never,
        presets: [
          // 移动端只读：不挂工具条与公式栏（没有编辑入口）
          UniverSheetsCorePreset({ container: containerId, disableAutoFocus: true, toolbar: false, formulaBar: false }),
          UniverSheetsDrawingPreset(),
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never) as unknown as { setEditable: (value: boolean) => unknown };
      book.setEditable(false);
      created = { univer, univerAPI };
    } catch (error) {
      console.error("移动端表格挂载失败", error);
    }
    const observer = new MutationObserver(() => {
      try { created?.univerAPI.setTheme(buildUniverTheme() as never); } catch { /* ignore */ }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      try { created?.univer.dispose(); } catch { /* ignore */ }
    };
  }, [ready, noteId]);

  return (
    <div className="mobile-usheet" ref={hostRef}>
      {ready ? <div id={containerId} className="mobile-usheet-root" /> : <div className="mobile-empty">正在加载表格…</div>}
    </div>
  );
}

export default MobileUsheetViewer;
