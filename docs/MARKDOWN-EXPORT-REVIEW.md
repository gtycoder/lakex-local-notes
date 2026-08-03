# Markdown 导出/转换调研（2026-08-03）

> 目标：全文转 md（按钮）、选区转 md（选中右键）、md 导入；评估成本。
> 结论：**Lake 内核原生支持 md，全文转 md 成本极低（已验证完美）；选区/右键成本中等，建议做。**

---

## 1. 内核能力实测（Playwright 驱动真实应用）

### 全文转 md —— ✅ 已验证完美，成本极低
```js
const md = editor.getDocument("text/markdown");
```
实测输出（含标题/加粗/斜体/列表/引用/行内代码/链接的测试文档）：
```markdown
# 一级标题
正文段落 **加粗** 和 _斜体_

## 二级标题
+ 列表项一
+ 列表项二

> 引用内容
>

行内 `code` 和链接 [示例链接](https://example.com)
```
- 标题（#/##）、加粗（**）、斜体（_）、无序列表（+）、引用（>）、行内代码（`）、链接全部正确
- **实现**：一个按钮 → `editor.getDocument("text/markdown")` → 复制到剪贴板/下载 .md
- 内核依据：`registerReader("text/markdown", markdownReader)` + `registerWriter("text/markdown", markdownWriter)`（es.js 源码确认）

### md 导入 —— 大概率可用（待最终验证）
```js
editor.setDocument("text/markdown", mdContent);
```
markdownReader 已注册（lake-editor-main 就是用同内核实现 .md 编辑），预期可用。

### 选区转 md —— 内核有命令系统，需接 md 转换（成本中等）
- Lake 有**命令系统**：`editor.execCommand("getSelectionContent")`（源码确认命令存在：`wx.command.getSelectionContent`）
- 命令注册方式：`Object.defineProperty(命令类, "ID", { value: 命令 })`
- **待验证**：`execCommand("getSelectionContent")` 返回格式（预计是选区范围的 lake/html 片段），
  拿到后转 md 有两种路径：
  a) 若返回 lake 片段 → 临时用 `setDocument` 换入独立文档再 `getDocument("text/markdown")`（重，丢选区）
  b) 若返回 html → 用 turndown 等库转 md（轻，需配规则）
- 另：浏览器原生 Range + 选区 DOM → html → turndown 也可作为备选（不经 Lake API）

### 右键菜单 —— Lake 有 ContextMenu 系统（38 处引用），自建成本中等
- Lake 内部有右键菜单（卡片右键等），但**自定义文本选区右键需自建**：
  document contextmenu 捕获 → 判断选中文本/焦点 → 渲染自定义菜单（可复用现有 create-menu 样式）
- 用户已确认"右键功能最终也要做"——建议一次性搭右键菜单框架，后续扩展（md 转换、AI 操作等）

---

## 2. 成本评估

| 功能 | 成本 | 说明 |
|---|---|---|
| 全文转 md 按钮 | **低（半天内）** | 1 行 API + 按钮/复制 UI；已验证输出质量 |
| md 导入（.md → lake） | **低** | setDocument("text/markdown")，需实测确认 |
| 选区右键转 md | **中（1-2 天）** | 需验证 getSelectionContent 格式 + 接 md 转换（turndown）+ 自建右键菜单 |
| 右键菜单框架 | **中（1 天）** | 一次性投入，供 md 转换及未来扩展复用 |

## 3. 建议实现顺序

1. **全文转 md**（按钮）：工具栏/状态栏加「导出 Markdown」→ 复制到剪贴板 + 可选保存 .md —— 先做，收益直接
2. **md 导入**：把 .md 文件拖入/打开时用 setDocument("text/markdown") 载入 —— 配合 AI 生成场景
3. **选区右键转 md**：搭右键菜单框架 → 选中文字 → 「复制为 Markdown」（验证 getSelectionContent，或 html+turndown 兜底）

## 4. 风险与注意

- getSelectionContent 输出格式未最终验证（Playwright 环境反复不稳定，未完成该步实测）；备选方案（选区 DOM → html → turndown）不依赖 Lake 内部 API，更可控
- 全文转 md 已实测可用，无风险
- turndown 是成熟库（GPL/MIT 双许可？需确认许可——turndown 为 MIT），引入成本低
