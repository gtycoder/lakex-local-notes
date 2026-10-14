/**
 * 首页「＋」的**新建面板**（261014 用户点单；形态照语雀 App 图 3）：
 *   新建小记：空白小记 / 拍摄 / 图片 / 待办
 *   新建文档知识库：空白文档 / 知识库
 *
 * 两条明确的"不做"（用户定稿）：
 *   · **不做模板**；
 *   · **不做 OCR 识图** —— 我们没有该能力：src 里零 OCR 引用、Android 原生只有 9 个插件（无相机/OCR View）、
 *     Capacitor 只装了 sqlite/app/filesystem、移动端也没有 AI 通道。按用户口径「没有就不做」。
 *
 * 表面复用浮层原语 `.mb-sheet`（floating.css 唯一来源），不新造第二套弹层；
 * 配色走移动端自身令牌（**只用一个强调色**，261012 用户定），不给每个格子配品牌色。
 */
import { useEffect, useRef } from "react";
import { BookMarked, Camera, Feather, FileText, Image as ImageIcon, ListTodo, type LucideIcon } from "lucide-react";
import { pushBackHandler } from "./backStack";
import { useSwipeToClose } from "./useSwipeToClose";

export type CreateActionId = "blank-quick" | "camera" | "image" | "todo" | "blank-doc" | "notebook";

interface CreateTile {
  id: CreateActionId;
  label: string;
  Icon: LucideIcon;
}

/** 面板内容（唯一来源；测试按 id 顺序卡住）。 */
export const CREATE_SECTIONS: Array<{ title: string; tiles: CreateTile[] }> = [
  {
    title: "新建小记",
    tiles: [
      { id: "blank-quick", label: "空白小记", Icon: Feather },
      { id: "camera", label: "拍摄", Icon: Camera },
      { id: "image", label: "图片", Icon: ImageIcon },
      { id: "todo", label: "待办", Icon: ListTodo },
    ],
  },
  {
    title: "新建文档知识库",
    tiles: [
      { id: "blank-doc", label: "空白文档", Icon: FileText },
      { id: "notebook", label: "知识库", Icon: BookMarked },
    ],
  },
];

export interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  onAction: (id: CreateActionId) => void;
}

export function CreateSheet({ open, onClose, onAction }: CreateSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useSwipeToClose(sheetRef, onClose, open);
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="mb-scrim" data-prevent-swipe onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="mb-sheet mb-sheet--create" role="dialog" aria-modal="true" aria-label="新建" data-prevent-swipe>
        {CREATE_SECTIONS.map((section) => (
          <section className="mb-create" key={section.title}>
            <h2 className="mb-create__title">{section.title}</h2>
            <div className="mb-create__grid">
              {section.tiles.map(({ id, label, Icon }) => (
                <button key={id} type="button" className="mb-create__tile" onClick={() => onAction(id)}>
                  <span className="mb-create__icon" aria-hidden="true"><Icon size={22} /></span>
                  <span className="mb-create__label">{label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
