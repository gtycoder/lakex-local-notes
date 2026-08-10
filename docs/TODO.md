# 待办清单

## 视觉/体验
- [ ] **多标签（tab）宽度与间距**：`padding: 12px→8px` 后短标签的关闭键仍觉得离右侧有空间，需要重新审视 tab 布局（flex 拉伸 / padding / gap），目标是短标签紧贴内容、长标签封顶截断（当前 `max-width: 186px`）。
- [ ] Word / PDF 导出：收口导出已预留（`electron/export.ts` 的 `docx`/`pdf`），待实现（可走 HTML → docx/PDF 链路）。
- [ ] 全文搜索 2 字以内查询回退：trigram 最小 3 字符，"回收/快照"等两字词需 LIKE 回退或提示（实现时处理）。

## 架构/技术债
- [ ] 锁定态（Viewer）文档的文本缓存：Viewer 的 `getDocument` 若不可用则无缓存，搜索/导出覆盖不到，需确认或补路径。
