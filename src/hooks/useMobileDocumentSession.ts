import { useState } from "react";
import type { NoteDocument } from "../lib/types";

/** 移动端页面（V5 Phase 4：App 只抽 hook 不重写——7 个 mobile 状态收拢）。 */
export type MobilePage = "library" | "document";

/**
 * 移动端文档会话状态集合：打开/页面/编辑/大纲/活动文档/草稿标题/草稿正文。
 * App 保留状态的所有权与业务逻辑，本 hook 只负责收拢声明，便于移动端复用与后续拆分。
 */
export function useMobileDocumentSession() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobilePage, setMobilePage] = useState<MobilePage>("library");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [mobileActive, setMobileActive] = useState<NoteDocument | null>(null);
  const [mobileDraftTitle, setMobileDraftTitle] = useState("");
  const [mobileDraftContent, setMobileDraftContent] = useState("");

  return {
    mobileOpen, setMobileOpen,
    mobilePage, setMobilePage,
    mobileEditing, setMobileEditing,
    mobileTocOpen, setMobileTocOpen,
    mobileActive, setMobileActive,
    mobileDraftTitle, setMobileDraftTitle,
    mobileDraftContent, setMobileDraftContent,
  };
}
