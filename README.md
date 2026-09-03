# Lake Notes（Electron）

本地优先的 Lake（语雀）编辑器笔记应用。**本文是项目总览入口；会话交接的唯一文档是 `HANDOFF.md`。**

> 给完全没有上下文的后续会话：先读 **HANDOFF.md（唯一交接文档：当前状态 / 真正的待办 / 踩坑）**，再读
> **AGENTS.md（项目长期记忆 / 红线，每次自动加载）**，然后按需读下面的开发/架构/踩坑文档与 `docs/TODO.md`。
> **当前主开发分支是 `master`**（= Gitee 远程默认分支，已验证 `ls-remote --symref`；本地与远端同步）。

---

## 一、项目概览

- **形态**：Electron 43 桌面应用 + Capacitor 安卓端（已替代 Tauri/trui 版成为正式版，路线验证完成）
- **为什么从 Tauri 换到 Electron**：
  - Tauri 在 macOS 强制 WKWebView，无法渲染 SVG foreignObject 文字（画板、复杂排版 bug 频发）
  - Lake 编辑器是 Web 组件，Chromium 是它的原生环境（语雀跑在 Chrome 上）
  - Electron 有完整 DevTools；思源笔记（同类型产品）也是 Electron

## 二、核心设计理念（仿思源笔记资源管理）

1. 图片/附件按笔记分目录存储（`note-assets/{noteId}/`），文档与资源分离
2. 不做图片去重（冗余存储可接受）
3. 用 S3 做备份/同步（参照思源的 S3 同步思路）
4. 复制到第三方（微信）时图片能正常显示（webp→png 转换）
5. 本地资源完全离线可用（Lake 编辑器 CDN 依赖全量本地镜像）
6. **不弹"正在加载"之类的 toast**

## 三、技术栈

Electron 43.4 + React 18.3 + TypeScript 5.9 + better-sqlite3 13（N-API，无需 rebuild）+ Lake 编辑器
（`lakex-editor-react-component@0.1.2` ESM，vendor 已 pin、勿随意升级）+ Drawnix 画板（`lakex-drawnix@0.1.0`）+
sharp（图片转换）+ @aws-sdk/client-s3；移动端 = Vite + Capacitor（安卓）。准确版本以 `package.json` 为准。

## 四、已完成里程碑（事实性，不含当前进度）

| 项 | 状态 |
|---|---|
| 路线验证（Electron 替代 Tauri） | ✅ 完成 |
| 资源归一化 + 第三方图片下载/复制 | ✅ 完成（用户验证通过） |
| S3 备份同步 + 对象 GC（七牛 Kodo） | ✅ 完成（真实云同步/GC 验证通过） |
| 打包发布：dmg | ✅ 完成并冒烟验证（未签名、默认图标） |
| 大文档性能 + 虚拟渲染 | ✅ 已合入 master（首图 3.5s→88ms、TOC/代码块粘贴/表格工具栏/长大纲跟随修复） |
| 代码审计 + 优化 + 单测、Electron 43 升级、S3 同步差集化 | ✅ 已完成并合入 master |
| 安卓端（Capacitor） | ✅ 可用；编辑遗留见 HANDOFF §3 |

> **本文不维护当前进度、测试计数、commit hash**（必然过期）。当前基线 / 本轮已完成 / 真正的待办 → **`HANDOFF.md` §0 / §2 / §3**。

## 五、仓库与分支

**本地仓库**：`/Users/admin/file/local-lake/lake-notes-electron`（独立 git 仓库）
**当前分支**：`master`（主开发分支 = Gitee 默认分支）
**远程**：
```
origin  git@gitee.com:gtycoder/local-lake.git
```
- Gitee `master` = 当前主干；Gitee `main` = 旧 Tauri（trui）版，保留未动
- SSH key 已在 Gitee 可用（`git ls-remote` / `git push` 走 SSH 均通过）；HTTPS 备援地址
  `https://gitee.com/gtycoder/local-lake.git`（macOS 钥匙串亦缓存凭据）

**推送**：`git push origin master`

**在途 worktree**：`/Users/admin/file/local-lake/lake-notes-wt-android`（分支 `feat/android-mobile-editing`，
安卓编辑改动，可能含未提交 WIP——开工前先 `git worktree list` + 进该目录 `git status`）。

**历史分支**（均已合入/删除，勿基于它们开发）：`feat/electron-43-upgrade`、`perf/s3-sync-asset-dedup`、
`fix/bookmark-paste-crash`、`audit/code-optimization`、`experiment/virtual-rendering`、`feature/electron`、
`asset-server-poc`、`main`（旧 Electron 快照）。

## 六、参考仓库（只读，勿修改）

| 仓库 | 用途 |
|---|---|
| `/Users/admin/file/local-lake/lake-notes-tauri-poc/` | Tauri 版源码：Rust 后端下载逻辑参考、**CSS 基准** |
| `/Users/admin/file/local-lake/siyuan-master/` | 思源笔记 v3.8.0（**AGPL-3.0**，移植样式需留 NOTICE）：S3 同步/dejavu、资源管理、UI 视觉基准 |
| `/Users/admin/file/local-lake/lake-main/` | lakejs 开源社区版内核（MIT）：**当"机制字典"读源码**，不是我们实际运行的 lakex 内核 |
| `/Users/admin/file/local-lake/lake-editor-main/` | 第三方 VSCode yuque-editor 插件（参考价值低） |
| `/Users/admin/file/local-lake/drawnix-develop/` | Drawnix 画板源码参考 |

## 七、文档索引

| 文档 | 内容 | 新会话优先级 |
|---|---|---|
| **HANDOFF.md** | 唯一交接文档（当前状态/待办/坑） | **先读** |
| **docs/CODEX-GUIDE.md** | Codex 自主开发指南（Playwright 驱动真实 Electron/Computer Use/浏览器） | **动手前必读** |
| docs/PROGRESS.md | 历史会话全记录 + **经验总结（方法论/深层认识/工程实践）**（**过程记录**：当前状态/待办以 HANDOFF 为准） | 考古/复盘用 |
| docs/DEVELOPMENT.md | 环境要求、开发/构建/打包命令、测试、依赖版本、提交历史 | 动手前读 |
| docs/SYNC-PROTOCOL.md · docs/S3-GC-DESIGN.md | 同步协议 / GC 与保留链（**改同步、GC 前必读**，配合 AGENTS §3 原则 11~13） | 动同步必读 |
| docs/TODO.md | 历史待办总表（**可能过期**，权威待办 = HANDOFF §3） | 按需 |
| docs/ARCHITECTURE.md | 进程结构、关键文件索引、图片数据流、数据与存储、S3 同步机制 | 改代码前读 |
| docs/TROUBLESHOOTING.md | 踩过的坑（打包/CDN/剪贴板/编辑器与 CSS/环境/S3 + 虚拟渲染新坑） | 遇坑查 |
| VIRTUAL-RENDERING-TEST.md | 虚拟渲染回归清单（逐项手测） | 动虚拟渲染相关代码前后跑 |
