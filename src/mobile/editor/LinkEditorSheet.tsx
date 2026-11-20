/**
 * 移动端「插入链接」浮窗（261120 用户点单：把 dock 面板里的内联编辑行换成**可上下拖动的底部浮窗**）。
 *
 * 为什么换：内联行挂在 dock 面板里，面板与软键盘是「二选一」的几何 ⇒ 键盘弹起后输入区被挤/被裁，
 * 观感也局促（用户原话「能不能搞好看一点，直接复用可上下拖拽的浮窗」）。
 * 现在 = `MobileSheet`（头部可拖拽调高 + 键盘稳定原语 `useKeyboardStableSheet`）+ `mb-*` 字段原语，
 * 与「文档引用」「打标签」等其它移动端弹层同一套观感。
 *
 * 语义不变：判定/选区还原/失败重试仍全部走共享 `features/editor/selectionToolbar/linkEditor.ts`
 *（桌面浮栏是同一份实现）；本组件只负责收集「文本 / 链接地址」两个值。
 */
import { useEffect, useState } from "react";
import { MobilePortal } from "../ui/MobilePortal";
import { MobileSheet } from "../ui/MobileSheet";
import { SheetFooter } from "../ui/SheetFooter";
import { isValidLink } from "../../features/editor/selectionToolbar/linkEditor";

export interface LinkEditorSheetProps {
  open: boolean;
  /** 打开时捕获的选中文字：作为「文本」初值（与桌面浮栏、内核链接编辑器同口径）。 */
  initialText: string;
  /** 确认：值已 trim；合法性由本组件保证（按钮禁用）。 */
  onConfirm: (value: { text: string; src: string }) => void;
  /** 取消 / 遮罩 / 返回键 / 右滑：统一退回编辑态（不动正文）。 */
  onCancel: () => void;
}

export function LinkEditorSheet({ open, initialText, onConfirm, onCancel }: LinkEditorSheetProps) {
  const [text, setText] = useState(initialText);
  const [src, setSrc] = useState("");
  // 每次打开都按当前选区重建表单（Sheet 常驻挂载，不能沿用上一次的草稿）。
  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setSrc("");
  }, [open, initialText]);
  const trimmed = src.trim();
  const invalid = trimmed.length > 0 && !isValidLink(trimmed);
  const canConfirm = trimmed.length > 0 && !invalid;
  /**
   * 回车 = 确定（与内核链接编辑器、桌面浮栏同口径）。也解决「键盘盖住底栏按钮」：
   * 移动端 Sheet 的键盘稳定口径是**不推弹窗**（键盘盖住下方内容），所以底栏在打字时可能不可见，
   * 回车提交是这条链路上最短的出口（用户也可先点标题区收键盘再点确定）。
   * 输入法组字期间不提交（中文候选态回车是选词）。
   */
  const onEnterConfirm = (event: { key?: string; preventDefault?: () => void; nativeEvent?: { isComposing?: boolean }; isComposing?: boolean }) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent?.isComposing || event.isComposing) return;
    event.preventDefault?.();
    if (canConfirm) onConfirm({ text, src: trimmed });
  };
  return (
    <MobilePortal>
      <MobileSheet
        open={open}
        title="插入链接"
        onClose={onCancel}
        bodyClassName="mb-sheet__body--form"
        footer={<SheetFooter
          cancel={{ label: "取消", onClick: onCancel }}
          confirm={{ label: "确定", disabled: !canConfirm, onClick: () => onConfirm({ text, src: trimmed }) }}
        />}
      >
        <div className="mb-set-items">
          <div className="mb-set-item mb-set-item--field">
            <div className="mb-set-item__main">
              <div className="mb-set-name">文本</div>
              <div className="mb-set-item__desc">没选中文字时，留空就用链接地址作为显示文字。</div>
            </div>
            <div className="mb-set-item__ctl">
              <span className="mb-input">
                <input value={text} aria-label="文本" placeholder="显示的文字" enterKeyHint="done"
                  onChange={(event) => setText(event.target.value)} onKeyDown={onEnterConfirm} />
              </span>
            </div>
          </div>
          <div className="mb-set-item mb-set-item--field">
            <div className="mb-set-item__main">
              <div className="mb-set-name">链接</div>
              {invalid && <div className="mb-set-item__error" role="alert">请输入正确的链接</div>}
            </div>
            <div className="mb-set-item__ctl">
              <span className="mb-input">
                <input
                  value={src}
                  aria-label="链接地址"
                  placeholder="https://"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onChange={(event) => setSrc(event.target.value)}
                  onKeyDown={onEnterConfirm}
                />
              </span>
            </div>
          </div>
        </div>
      </MobileSheet>
    </MobilePortal>
  );
}
