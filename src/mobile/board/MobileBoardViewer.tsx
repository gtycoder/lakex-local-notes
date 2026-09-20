/**
 * 移动端画板查看器（kind=board，只读）。
 *
 * 与桌面 `src/features/board/BoardEditor.tsx` 同一套引擎（vendor `loadDrawnixBoardCore()` 懒加载器）：
 * - **只读**：`readOnly` ⇒ `board.options.readonly = true`，画布可平移/缩放但改不了内容；
 *   移动端不保存、不写库（`kind=board` 的正文 JSON 绝不喂给 Lake 编辑器 —— 那是毁正文的操作）。
 * - **只挂载一次**：首次可见才建实例（隐藏态量到 0 尺寸画不出来），之后 keep-alive。
 * - **fitOnInit**：移动端没有保存的视口时自动 fit 到内容，不然打开是一片空白。
 * - 分包：`DrawnixBoardCore-*.js` + `drawnix-*.js` 与桌面共用同一份懒加载 chunk，只在真的打开画板时请求。
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { loadDrawnixBoardCore } from "@dlient/lakex-doc-react";
import { parseBoardBody } from "../../core/boardDoc.js";

const DrawnixBoardCore = lazy(() => loadDrawnixBoardCore().then((m) => ({ default: m.default })));

export interface MobileBoardViewerProps {
  content: string;
  /** 该 tab 是否为当前活动 tab（未活动过就不建实例）。 */
  active: boolean;
}

export function MobileBoardViewer({ content, active }: MobileBoardViewerProps) {
  const [doc] = useState(() => parseBoardBody(content));
  const [everActive, setEverActive] = useState(active);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );

  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  if (!everActive) return <div className="mobile-board-viewer" />;
  return (
    <div className="mobile-board-viewer">
      <Suspense fallback={<div className="mobile-board-loading" />}>
        <DrawnixBoardCore
          value={{
            version: 2,
            engine: "drawnix",
            preset: doc.preset,
            plaitValue: doc.elements,
            ...(doc.viewport ? { plaitViewport: doc.viewport } : {}),
          }}
          locale="zh-CN"
          theme={theme}
          readOnly
          fitOnInit
        />
      </Suspense>
    </div>
  );
}

export default MobileBoardViewer;
