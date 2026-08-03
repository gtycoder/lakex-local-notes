# 参考资料评审（2026-08-03）：四个 Lake 相关仓库的可借鉴点

> 目标：评估 4 个外部仓库对打磨本地 Lake（lake-notes-electron）的价值，输出可执行优化清单。
> 结论先行：**lake-editor-main 价值最高（同内核直接可借鉴），lake-main 用于机制对照，yuque-rich-text 参考 viewer/字数，am-editor 仅设计参考（不同内核）。**

---

## 1. lake-main（lakelib 0.4.6，官方开源新版 Lake）

**判断**：有价值，但**与我们用的不是同一代码线**。
- 我们用的是 `lakex-editor-react-component@0.1.2`（语雀内部旧内核，非开源，之前靠反编译 dist 理解机制）；
- lake-main 是 lakejs 官方全新开源版（模块化 ui/plugins/managers，MIT）。
- **对照用途**：虚拟渲染、TOC watcher、卡片工具栏、boundary popover 等我们踩过的机制，在新版源码里有官方实现可查证（虽然命名/结构不同，可佐证设计意图）。
- **功能差距清单**（新版有、需确认旧内核是否支持）：format-painter（格式刷）、highlight（荧光笔）、special-character（特殊字符）、markdown 语法输入、headless/readonly/multiple-editors 示例、slash 斜杠菜单。
- **长期**：若语雀旧内核维护停滞，可评估迁移到 MIT 的 0.4.x；但所有虚拟渲染/TOC/hover 修复都基于旧内核，迁移成本巨大，近期不推荐。

## 2. lake-editor-main（VSCode 中编辑 .lake/.md，重点 ✅）

**判断**：**价值最高**——与我们是**同一语雀 Lake 内核**（media/editor/doc.umd.js = @alipay_lakex-doc 0.09.05），它用到的内核 option/API 我们**直接可用**。

**直接可借鉴（同内核 option/API）**：
| 借鉴点 | 实现参考 | 对我们的价值 |
|---|---|---|
| 段间距 | `paragraphSpacing: 'relax'`（编辑器 option） | 阅读舒适度设置项，一行代码 |
| 默认字号 | `defaultFontSize` | 设置项，对齐语雀阅读体验 |
| TOC/工具栏开关 | `toc.enable` / 工具栏显隐 | 我们已有 tocEnabled，可做成用户设置 |
| 保存时格式化 .lake | `formatLake()`（XML 缩进） | 便于版本控制/阅读 .lake；需确认我们 doc 格式兼容 |
| 深色模式 | 跟随主题切换（webview + CSS 变量） | 我们目前仅亮色，值得做 |
| 外部变更检测 | `file-change-detector.ts`（onDidChange/Create/Delete + 300ms 防抖 + 自保存过滤） | 多窗口/多设备场景；我们单实例锁下价值中等 |
| 粘贴为纯文本 | `pasteAsPlainText()`（Cmd+Shift+V） | 富文本粘贴场景常用，我们可加 |
| .lakebook 树形浏览 | tar 解析 + 文档树 | 未来导入语雀知识库压缩包 |
| Markdown 互转 | .md ↔ .lake | 未来导出/导入/安卓端 |

**启发**：其 bug 修复清单（Markdown title 丢失、空文件、外部修改不提示）提示我们保存链路的边界场景。

## 3. yuque-rich-text-master（语雀 Lake 的 Vue3/React 组件）

**判断**：有价值（同内核，从 yuque-chrome-extension 提取），但采用 iframe 隔离方案，与我们主文档集成不同。

**可借鉴**：
- **Viewer 只读模式**（lake-rich-view）：我们移动端 viewer 可参考其只读渲染（避免重新实现）。
- **命令式 API**：`setContent/getContent/appendContent/wordCount`——**wordCount 字数统计**我们可能缺。
- **HTML interop**：Lake ↔ HTML，未来导出/复制增强。
- **slash-options**：斜杠菜单可配置化（语雀扩展里可自定义斜杠项）。
- **上传配置**：可配置上传 URL/回调——我们有本地+S3，参考价值小。
- **iframe 隔离**：不建议——我们的虚拟渲染/滚动补偿/TOC 都在主文档，迁移成本巨大。

## 4. am-editor-master（red-axe 新编辑器，contenteditable 基础）

**判断**：**仅设计参考**——完全不同内核（自定义渲染器 + 插件体系 + yjs 协同），代码不可复用。

**可借鉴（设计层面）**：
- **插件化架构**：mark/inline/block/卡片插件 + React/Vue 渲染插件 UI——我们 Lake 是内置卡片，插件化思路对未来扩展有启发。
- **协同编辑**：内置 yjs-server——未来安卓端/多设备实时协同的参考架构。
- **功能清单对照**（它有的、我们可能缺）：alignment、line-height、indent、paintformat、tasklist、mermaid、mention、math、status、mark-range（选区标记）、lightblock。
- **Markdown 语法输入**、**移动端适配**。

---

## 可执行优化清单（按价值排序）

### P0（同内核一行级，成本极低）
1. 段间距设置项（`paragraphSpacing: 'relax'` 开关）
2. 默认字号设置项（`defaultFontSize`）
3. 字数统计（wordCount，状态栏展示）

### P1（功能增强，中等成本）
4. 深色模式（跟随系统，CSS 变量 + Lake 主题）
5. 粘贴为纯文本快捷键（Cmd+Shift+V）
6. TOC/工具栏显隐做成设置项（现有 tocEnabled 固化）

### P2（未来阶段，随功能一起）
7. Markdown 导入导出（安卓端/数据迁移）
8. .lakebook 导入（语雀知识库迁移）
9. 外部变更检测（多窗口/多设备）
10. 保存时格式化 .lake（formatLake，先确认格式兼容性）

### 机制对照（随时可做，纯阅读）
- 用 lake-main 源码对照虚拟渲染/TOC watcher/卡片工具栏机制，验证我们反编译得出的修复方向。

### 不推荐
- 迁移 lakelib 0.4.x 内核（成本巨大，除非旧内核维护停滞且功能差距不可接受）
- am-editor 代码复用（不同内核）
- iframe 隔离方案（yuque-rich-text 方案，破坏现有虚拟渲染架构）
