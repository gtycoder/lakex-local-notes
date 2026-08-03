# Lake Notes Electron 交接文档（入口 / 完整交接）

> **给零上下文的新会话：先读本文，再读 `docs/CODEX-GUIDE.md`（Playwright 驱动真实 Electron
> 实测是本项目的正确姿势），然后按需读 `docs/PROGRESS.md` / `docs/ARCHITECTURE.md` 等。**
> 本文 = 文档索引 + **★ 最新交接（2026-08-03 会话）全记录**。修改代码前先读完相关文档。

---

## 项目一句话

**Lake Notes** 是一个 Electron + 语雀 Lake 编辑器（`lakex-editor-react-component` 封装的内核）的
**本地优先笔记应用**：`.lake` 文件存本地、SQLite 存元数据、S3 兼容备份同步、虚拟渲染优化大文档、
资源归一化（图片本地化）、支持多标签编辑、全文导出 Markdown。

## ★ 最新交接（2026-08-03 会话）：代码审计修复 + 体验优化 + MD 导出 + 发布准备

### 任务目标（本会话）

1. 阅读并独立复核 `docs/CODE-AUDIT-2026-08-03.md`（15 项问题 + 6 个复现重点 + 新增 8 项）
2. 在独立分支 `fix/audit-2026-08-03` 修复全部审计问题（**后 fast-forward 合入 master**）
3. 参考 4 个 Lake 相关仓库（lake-main / lake-editor-main / yuque-rich-text / am-editor），输出可借鉴点
4. 落地 P0+P1 体验优化（偏好设置/字号/段间距/TOC/工具栏/字数统计）
5. 全文导出 Markdown（用户核心需求：AI 输入场景）
6. 发布准备（应用图标、签名/公证教程、dev/打包 userData 隔离）
7. 修复用户实测发现的问题（暗黑编辑器背景、中文斜体失效、多 tab 隔离）

### 已完成内容

**① 代码审计 15 项 + 新增 8 项全部修复（分支 `fix/audit-2026-08-03` → 已合入 master）**
- **#1 同步清空资源清单（高）**：`electron/sync.ts` 资源清单每次同步恒重扫（正文 hash 未变也保留 assets）
- **#2 墓碑只保留一次同步（高）**：墓碑永久保留 + 下载 deleted 标记时 `rememberDeleted` 学习墓碑（设备接力保管）
- **#3/#17 目录穿越（高）**：`notePath`/资源文件名统一 `isSafePathSegment` 校验 + manifest 运行时 schema 校验
- **#4 远端资源完整性（高）**：下载缺失即中止 + size/sha256 校验
- **#5 SSRF（高）**：`ssrf.ts` 新增 `assertSafeRemoteHost`（DNS 解析逐地址校验）+ 下载层改用
  `net.request` + `followRedirect:false` 逐跳校验 + **彻底移除渲染层回退**（原回退是刻意绕过安全策略）
- **#6 IPC 来源（高）**：精确 URL + webContents 白名单 + `will-navigate`/`setWindowOpenHandler` 拦截
- **#7 自动保存覆盖（中偏高）**：App.tsx 加每笔记 revision 计数器，旧响应不覆盖新草稿
- **#9 树结构不变量（中）**：notebook 只能根层、note 不能作父、reorder 完整性校验
- **#10 FS/SQLite 非原子（中，删除高）**：deleteTreeNode DB-first、importRemoteNote staging 写入
- **#12 孤儿清理（低）**：失败保留记录可重试
- **#13 Worker（低）**：崩溃 terminate+替换 + 60s 任务超时
- **#14 附件大小（中低）**：非图片附件 25MiB 上限 + Data URL 解码前预检
- **#15 TOC 水合（低）**：裸函数修正（`lakeRuntime.ts:560-561`）+ 定时器统一清理 + `refreshTocSidebar` host 限定
- 新增：#16 资产服务 CORS Origin 门控、#18 move+reorder 原子 IPC、#19 schema 校验（随 #3）、
  #20 墓碑学习（随 #2）、#21 upload_resource IPC 大小预检、#22 detectOrphans 隔离、#23 beforeunload 兜底
- 额外：#8 移动端 viewer 旧快照（persistMobile）、#11 导入后按正文对账标记孤儿

**② 参考仓库评审（`docs/REFERENCE-REVIEW-2026-08-03.md`）**
- lake-editor-main（重点，同内核 `@alipay_lakex-doc`）：paragraphSpacing/defaultFontsize/toc 等内核 option 直接可用
- lake-main（lakelib 0.4.6 官方新版，不同代码线）：机制对照 + 功能差距清单
- yuque-rich-text（同内核 iframe 方案）：viewer/wordCount/HTML 互转参考，iframe 方案不采用
- am-editor（不同内核）：插件化 + yjs 协同，仅设计参考

**③ P0+P1 体验优化（`6e0f2f1`）**
- 偏好设置面板（状态栏齿轮）：**字号**（12-24 八档，内核 defaultFontsize）、**段间距**（CSS relax）、
  **TOC 显隐**（toc.enable）、**工具栏显隐**（disabledPlugins）——localStorage 持久化
- **字数统计**：状态栏实时显示当前文档字数
- ⏸ **深色模式已回滚**（`5e8e160`）：工具栏图标暗色对比度差、成本高收益小，用户决定不做
- ⏸ **纯文本粘贴已回滚**（`5e8e160`）：Cmd+Shift+V 在 Chromium 不触发 paste 事件，DOM 插入方案被
  Lake 文档模型重建清除，真修需内核插入 API 成本高，放弃

**④ 全文导出 Markdown（`fae79e8`）**
- 状态栏「MD」按钮 → `editor.getDocument("text/markdown")`（**内核原生支持，语雀同款**）→ 复制到剪贴板 + 提示
- EditorTab/LakeEditor 通过 `onEditorReady` 回调注册编辑器实例到 App（`editorsRef` noteId → editor）
- 实测输出质量高（标题/加粗/斜体/列表/引用/代码/链接全正确）
- 调研报告 `docs/MARKDOWN-EXPORT-REVIEW.md`：md 导入（`setDocument("text/markdown")`）、选区转 md、右键框架待做

**⑤ 发布准备（`3dae1a9`）**
- 应用图标 `build/icon.icns`（湖蓝渐变 + 文档页 + 波浪，程序化设计，全尺寸）+ electron-builder mac.icon 配置
- 发布教程 `docs/RELEASE.md`（Apple Developer 认证 → Developer ID 签名 → 公证 → 打包全流程）
- **userData 隔离**：dev 用 `lake-notes-dev`、打包版用 `lake-notes-electron`（main.ts app ready 前 setPath）
- Gitee：默认分支已切 master、main 已设保护分支

**⑥ 修复用户实测问题**
- **暗黑编辑器背景**：Lake 运行时注入 `.lakex-default-theme` 亮色变量 → 高优先级选择器
  `html[data-theme=dark] .lake-editor .ne-editor` 覆盖变量（后因用户决定不做深色而回滚）
- **中文斜体失效**（`2cd848d`）：根因 `font-synthesis: none` 禁止合成斜体（中文字体无 italic 变体）→
  改为 `font-synthesis: style weight`。验证：同内容中文 normal vs italic 截图像素差异 92.2%
- **多 tab 隔离**（`c93813a`）：hover 桥 `onMouseLeaveCapture` 补 `host.contains` 检查；实测内容/TOC/
  导出/设置/关闭 tab 全隔离

### 当前问题 / 已知限制

1. **应用未签名、未公证**：dmg 首次打开需右键→打开；用户按 `docs/RELEASE.md` 推进 Apple 认证（进行中）
2. **渲染包超大**：主 chunk ~9.4MB（Lake 本体 + slate + react），编辑器懒加载属 Lake 阶段
3. **表格 max-view 进出后工具栏定位偏移 ~28px**（自愈，Lake 内部问题，待 Lake 优化阶段）
4. **移动端/单编辑器路径未回归**：`resolveScrollNode` 仅 `.lake-editor-tab` 启用内部滚动，移动端待验证
5. **移动端 MD 导出未验证**：依赖 viewer 实例 getDocument（低频，后续确认）
6. **隐藏 tab 编辑器全量驻留内存**（最多 8 个，多标签即时切换设计使然）
7. **S3 对象累积回收（GC）待立项**：已同步图片删除后对象永久留存（思源式数据仓库瘦身方案）
8. **npm 私有镜像不可达**：装新依赖必须显式用 npmmirror registry

### 下一步计划（建议顺序）

1. **发布**：用户完成 Apple 认证（`docs/RELEASE.md`）→ 签名 + 公证 + 打包验证
2. **右键菜单框架 + 选区转 md**（已与用户讨论定方向）：右键 = 复制为 Markdown + 复制为纯文本
   + AI 占位；复制纯文本是 Cmd+Shift+V 做不了后的唯一干净入口
3. **md 导入**：`.md` 文件 → `setDocument("text/markdown")`（配合 AI 生成场景）
4. **外部变更检测**（AI 生成场景）：主进程 fs.watch + 自保存过滤（参考 lake-editor-main file-change-detector）
5. **Lake 优化阶段**（用户后续主导）：参考评审 P0/P1 项 + max-view 偏移 + 渲染包懒加载
6. **移动端路径回归**（scrollNode 回退分支 + TOC，随移动端一起）
7. 安卓端同步（复用同步协议）、S3 GC（独立阶段）

### 本会话踩过的坑（速览，细节见 docs/TROUBLESHOOTING.md H/I 节）

- **Chromium Cmd+Shift+V 不触发 paste 事件**（移除默认菜单项也不触发）；execCommand insertHTML/paste
  在 Lake 不可靠；合成 paste 被 Lake 拒绝（isTrusted 检查）
- **Lake 运行时注入 `<style>` 定义 `.lakex-default-theme` 亮色变量**，优先级高于 html 级变量定义
- **`font-synthesis: none` 导致中文斜体完全失效**（中文字体无 italic 变体，被禁止合成）
- **Chromium `net.fetch` 的 `redirect:"manual"` 直接抛 "Redirect was cancelled"**；逐跳校验必须用
  `net.request` + `followRedirect:false`；Referer 必须每跳用当前 URL（固定外部 Referer 被 Google 等拦截）
- **渲染层回退是刻意设计的 SSRF 绕过**（resourceUpload.ts 注释为证），安全错误绝不回退
- **vitest `mockRestore()` 后重新 mock 不生效**；**dist 构建缓存损坏**导致 `path is not defined` 假象（clean build 解决）
- **Playwright 环境不稳定**：后台窗口渲染暂停（getBoundingClientRect 全 0）、node_repl kernel 反复 reset、
  `querySelector(".ne-engine")` 多 tab 时取第一个隐藏 host（必须按 `data-note-id`/display 精确定位）
- **测试污染**：真实 Cmd+Shift+V 会把系统剪贴板内容粘进笔记（必须用隔离 userData + 测后恢复/清理）；
  Playwright 会话后必须清 last_opened_note_id 残留（否则启动报"笔记不存在"）
- **Lake 标记/API 速记**：斜体 = `ne-text[ne-italic="true"]`（em/i 会被 Lake 解析为此）；
  md 转换 = `getDocument("text/markdown")` / `setDocument("text/markdown", md)`；
  editor 实例通过 onEditorReady 回调获取（导出用）

---

## 参考资料解读经验（2026-08-03 沉淀：如何分析同类开源项目）

> 本次解读了 4 个 Lake 相关仓库（lake-main / lake-editor-main / yuque-rich-text / am-editor），
> 结论见 `docs/REFERENCE-REVIEW-2026-08-03.md`。以下是可复用的**方法**：

### 1. 先判内核血缘，决定参考深度
- **看依赖与内置资源**：项目用哪个内核？node_modules 里的 lakex 封装 vs 参考项目的 `media/editor/doc.umd.js`
  （@alipay_lakex-doc）——**同内核（语雀系）的参考价值最高**：option/API 可直接拿来用（如
  `paragraphSpacing`、`toc.enable`、`getDocument("text/markdown")`）。
- **lake-main（lakelib 0.4.6）是不同代码线**（官方新版，模块化重写）：机制可对照（虚拟渲染/TOC/工具栏
  的设计意图），但命名/API 不通用，**不能直接抄代码**。
- **am-editor 完全不同内核**（contenteditable + 插件体系）：只借鉴设计（插件化架构、yjs 协同），
  代码零复用。判断标准：**同内核 > 同 API 风格 > 纯设计参考**。

### 2. 抓"可直接复用"的资产，而非只读结论
- 参考项目的**编辑器初始化参数/配置项**是金矿（lake-editor-main 的 `src/webview/lake-preview/index.ts`：
  `paragraphSpacing: 'relax'`、`toc: { enable }`、`defaultFontsize`、`formatLake`）——同内核直接可用。
- 参考项目的**踩坑修复**（外部变更检测的 300ms 自保存过滤窗口、粘贴纯文本的实现路径）→ 直接启发
  我们的实现方案。

### 3. 验证 > 信任：源码说有，必须 Playwright 实测
- 看源码确认 API 存在（`registerReader("text/markdown", ...)`）→ **必须起真实应用实测**
  （`getDocument("text/markdown")` 输出质量、`editor.execCommand` 命令系统）。
- 实测手段：**临时暴露编辑器实例**（`window.__lakeEditor = editor`）→ 调 API 验证 → 测后移除。
- 多 tab 实测注意：`querySelector(".ne-engine")` 会取到第一个隐藏 host，必须按
  `data-note-id`/`display` 精确定位（本次踩过）。

### 4. 反推内核机制的三个技巧
- **CSS 变量是主题正解**：发现 Lake 用 `--lakex-editor-*` 变量（默认未定义、运行时注入
  `.lakex-default-theme`）→ 用更高优先级选择器在容器上覆盖变量，比逐选择器改样式可靠。
- **看序列化标记而非标准标签**：斜体是 `ne-text[ne-italic="true"]`（em/i 会被解析转换）；
  查自定义元素/属性比查标准 HTML 标签更能定位 Lake 的功能实现。
- **命令系统**：`editor.execCommand` + 命令 ID（如 `getSelectionContent`）是 Lake 扩展入口，
  比直接操作 DOM 更安全（DOM 操作会被 Lake 文档模型重建清除——纯文本粘贴的教训）。

### 5. 产出要有"可执行性"
- 每次解读输出：**功能差距清单 + 成本评估 + 建议实现顺序**（REFERENCE-REVIEW 的 P0/P1/P2 表），
  让后续会话能直接按表执行，而不是重新读一遍参考仓库。

### 6. 警惕参考项目自身的坑
- lake-editor-main 的 `pasteAsPlainText` 依赖编辑器命令（我们的内核没有同命令）；formatLake 的正则
  只在标签边界加换行（安全），但直接抄要验证目标内核的序列化格式是否兼容。
- vscode 扩展的上下文（菜单/命令系统）与 Electron 应用不同，映射到我们场景时要重新评估实现路径。

## 项目历史背景（简）

- **阶段 A**：资源归一化（图片本地化）、第三方图片下载（electronNet.fetch + Referer/UA）、粘贴拦截升级
- **阶段 B**：S3 备份同步（sync 引擎、墓碑、孤儿资源 UI）
- **阶段 C**：代码审计与优化（SSRF/IPC/并发/安全）
- **虚拟渲染**：大文档性能（首图 3.5s→88ms）、TOC 三问题、代码块粘贴、表格工具栏 hover、长大纲跟随
  （详见 `docs/PROGRESS.md` 历史部分 + `VIRTUAL-RENDERING-TEST.md`）

## 文档索引

| 文档 | 内容 | 优先级 |
|---|---|---|
| **docs/CODEX-GUIDE.md** | **Codex 自主开发指南**：Playwright 驱动真实 Electron（含启动模板）/ Computer Use / 应用内浏览器；推荐会话工作流；环境速查 | **动手前必读** |
| **docs/PROGRESS.md** | ★最新交接（含本次会话全记录 + 多 tab 评审）、经验总结、历史阶段、当前问题、下一步 | **先读** |
| **docs/CODE-AUDIT-2026-08-03.md** | 审计报告 15 项 + 二次审计判断 + 修复状态表 | 了解本次审计 |
| **docs/REFERENCE-REVIEW-2026-08-03.md** | 四个 Lake 参考仓库评审 + P0/P1/P2 可借鉴清单 | 体验优化参考 |
| **docs/MARKDOWN-EXPORT-REVIEW.md** | MD 导出/导入调研（内核原生支持、成本评估、实现顺序） | 做 md 功能前读 |
| **docs/RELEASE.md** | 发布教程：Apple 认证 → 签名 → 公证 → 打包 | 发布时读 |
| README.md | 项目概览/核心理念/技术栈/状态总览/仓库与分支 | 了解项目 |
| docs/DEVELOPMENT.md | 环境要求/开发/构建打包/测试（双 ABI）/依赖版本 | 动手前读 |
| docs/ARCHITECTURE.md | 进程结构/关键文件索引/图片数据流/数据与存储/S3 同步机制 | 改代码前读 |
| docs/TROUBLESHOOTING.md | 踩过的坑 A-I（打包/CDN/剪贴板/编辑器与 CSS/环境/S3/虚拟渲染/审计修复/斜体） | 遇坑查 |
| VIRTUAL-RENDERING-TEST.md | 虚拟渲染回归清单（逐项手测） | 动虚拟渲染相关代码前后跑 |

## 环境速查

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"   # Node 24（vite 8 必需）
export npm_config_registry=https://registry.npmmirror.com   # npm 私有镜像不可达
export npm_config_cache=/tmp/npm-cache-lake
node node_modules/vite/bin/vite.js build                    # 构建渲染层+主进程
npx vitest run                                              # 测试（先 bash scripts/setup-test-abi.sh）
bash scripts/setup-test-abi.sh                              # 装 Node ABI better-sqlite3（测试用）
```

- **当前分支**：`master`（最新 `c93813a`，已推送 Gitee；`fix/audit-2026-08-03` 分支保留在远程）
- **测试**：102 个 vitest 用例全绿
- **Playwright 启动模板**：见 `docs/CODEX-GUIDE.md`（静态服务器 serve dist/ + `_electron.launch`）
- **注意**：dev 用 `lake-notes-dev` userData（隔离），打包版用 `lake-notes-electron`；单实例锁（dev 与打包不能同时跑）；杀进程只 grep "lake-notes-electron"
