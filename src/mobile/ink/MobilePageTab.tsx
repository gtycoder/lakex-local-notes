/**
 * 移动端「页签」入口（261104 二十六批四轮）：按钮在顶部悬浮导航里，编辑走移动端底部 Sheet。
 *
 * 为什么由移动层实现：共享层 InkPad 不发 mb-* 类名（跨端样式护栏要求共享组件类名两端都有样式），
 * 所以 InkPad 只通过 renderPageTab 注入「当前页数据 + 保存/清除」，按钮与 Sheet 都在这一层。
 * 表单本体 = features/ink/InkPageTabForm（与桌面弹层同一份逻辑）。
 * Pad（expanded）与手机走同一套外壳，所以自动兼容；不做平板专属分支。
 *
 * ⚠️ Sheet **不能**渲染在顶部胶囊里：胶囊是横向滚动容器（scrollWidth 会被撑大、且可能被裁），
 * 所以拆成两个组件：Button 挂在导航里，Sheet 由 MobileInkPad 作为兄弟节点渲染（不用 createPortal，
 * 仓内 createPortal 只允许 Overlay 原语白名单，见 uiPrimitives.test）。
 */
import { Bookmark } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { InkPageTabForm } from "../../features/ink/InkPageTabForm";

export interface MobilePageTabState {
  pageNumber: number;
  readOnly: boolean;
  note: string | undefined;
  onSave: (text: string) => void;
  onClear: () => void;
}

export function MobilePageTabButton({ state, onOpen }: { state: MobilePageTabState; onOpen: (state: MobilePageTabState) => void }) {
  const hasTab = state.note !== undefined;
  return (
    <button
      className={["ink-tool", hasTab ? "has-tab" : ""].join(" ")}
      onClick={() => onOpen(state)}
      aria-label="页签"
      title={hasTab ? "这一页有页签" : "给这一页加页签"}
      aria-haspopup="dialog"
    ><Bookmark size={16} /></button>
  );
}

export function MobilePageTabSheet({ state, open, onClose }: { state: MobilePageTabState | null; open: boolean; onClose: () => void }) {
  return (
    <MobileSheet open={open} ariaLabel="页签" onClose={onClose} bodyClassName="ink-page-tab-sheet">
      {state ? (
        <InkPageTabForm
          page={{ note: state.note }}
          pageNumber={state.pageNumber}
          readOnly={state.readOnly}
          onSave={(text) => { state.onSave(text); onClose(); }}
          onClear={() => { state.onClear(); onClose(); }}
          onCancel={onClose}
        />
      ) : null}
    </MobileSheet>
  );
}

/** 兼容旧引用：默认导出按钮（Sheet 由宿主另行渲染）。 */
export default MobilePageTabButton;
