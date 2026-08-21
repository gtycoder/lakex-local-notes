/**
 * EditorHost 窄端口（lake-core，V5 Phase 4）：仅接口，不搬实现。
 * 桌面实现收敛 scrollMemory / 画板滚动守卫 / 自愈 observer（见 features/editor/EditorTab.ts）；
 * RN/WebView 实现留移动端。
 */

/** 编辑器文档适配器：对宿主暴露「文档读写 + 缓存」最小面。 */
export interface EditorDocumentAdapter {
  read(id: string): Promise<{ title: string; content: string }>;
  /** 保存正文；caches 为可选派生缓存（markdown/plain）。 */
  save(id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }): Promise<{ title: string; content: string; updatedAt: string }>;
  getDigest(id: string): Promise<{ title: string; updatedAt: string; deleted: boolean } | null>;
}

/** 编辑器视口适配器：滚动记忆 / 搜索定位 / 自愈观察的宿主接口。 */
export interface EditorViewportAdapter {
  /** 记录文档滚动位置（编辑会话期间）。 */
  saveScrollPosition(noteId: string, scrollTop: number): void;
  /** 恢复文档滚动位置；返回 true 表示已恢复。 */
  restoreScrollPosition(noteId: string, element: unknown): boolean;
  /** 定位编辑器内搜索命中（高亮 + 滚动到命中）。 */
  locateSearchHit(element: unknown, hit: { start: number; end: number }): boolean;
  /** 隐藏 tab 后断开观察者（自愈 observer 收敛）。 */
  disconnectObserver(noteId: string): void;
}
