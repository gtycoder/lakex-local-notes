/**
 * 底栏「页签」按钮（261104 二十六批二轮）：页签编辑从「页面」面板的大纲里挪出来，成为底栏独立入口。
 * 表单本体 = InkPageTabForm（与移动端 Sheet 共用同一份逻辑/语义）；
 * 本文件只负责：触发按钮、弹层开合、自适应左右展开（避免被面板/窗口裁）、点外部/Esc 关闭。
 *
 * 桌面专属控件，单独成文件（跨端样式护栏只扫 SHARED 名单里的组件）。
 */
import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import type { InkPage } from "../../core/inkDoc.js";
import { InkPageTabForm } from "./InkPageTabForm.js";

export interface InkPageTabButtonProps {
  page: Pick<InkPage, "note"> | undefined;
  pageNumber: number;
  readOnly: boolean;
  onSave: (text: string) => void;
  onClear: () => void;
}

export function InkPageTabButton({ page, pageNumber, readOnly, onSave, onClear }: InkPageTabButtonProps) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<"left" | "right">("right");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const POPOVER_WIDTH = 260;
  const hasTab = page?.note !== undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="ink-page-tab" ref={rootRef}>
      <button
        className={["ink-tool", open ? "is-active" : "", hasTab ? "has-tab" : ""].join(" ")}
        onClick={() => {
          // 自适应：按钮右边放不下弹层 ⇒ 向左展开；否则向右（不会被面板/窗口裁掉）
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) setAlign(window.innerWidth - rect.left - 12 < POPOVER_WIDTH ? "right" : "left");
          setOpen((value) => !value);
        }}
        aria-label="页签"
        title={hasTab ? "这一页有页签" : "给这一页加页签"}
        aria-expanded={open}
      ><Bookmark size={16} /></button>
      {open && (
        <div className={"ink-page-tab__popover is-align-" + align} role="dialog" aria-label="页签" data-ink-page-tab>
          <InkPageTabForm
            page={page}
            pageNumber={pageNumber}
            readOnly={readOnly}
            autoFocus
            onSave={(text) => { onSave(text); setOpen(false); }}
            onClear={() => { onClear(); setOpen(false); }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

export default InkPageTabButton;
