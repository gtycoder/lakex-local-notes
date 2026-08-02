# Lake Notes（Electron）

本地优先的 Lake（语雀）编辑器笔记应用。**本文是项目的主交接文档入口。**

> 给完全没有上下文的后续会话：先读 **docs/PROGRESS.md 的「★ 最新交接」**（最近一次会话
> 的任务目标/已完成/当前问题/下一步/踩坑），再按需读下面的开发/架构/踩坑文档。
> **当前主开发分支是 `master`**（Gitee 远程 master 已同步）。

---

## 一、项目概览

- **形态**：Electron 33 桌面应用（已替代 Tauri/trui 版成为正式版，路线验证完成）
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

Electron 33.4 + React 18.3 + TypeScript + better-sqlite3 11 + Lake 编辑器
（`lakex-editor-react-component@0.1.2` ESM）+ Drawnix 画板（`lakex-drawnix@0.1.0`）+
sharp（图片转换）+ @aws-sdk/client-s3。详细版本见 docs/DEVELOPMENT.md。

## 四、当前状态总览

| 项 | 状态 |
|---|---|
| 路线验证（Electron 替代 Tauri） | ✅ 完成 |
| 阶段 A：资源归一化 + 第三方图片下载/复制修复 | ✅ 完成（用户验证通过） |
| 阶段 B：S3 备份同步（七牛云） | ✅ 完成（真实同步验证通过） |
| 打包发布：dmg | ✅ 完成并冒烟验证（未签名、默认图标） |
| 阶段 C：代码审计 + 优化 + 单测 | 🚧 进行中（**82 个 vitest 用例全绿**） |
| 大文档性能 + 虚拟渲染 | ✅ 试验完成并**已合入 master**：首图 3.5s→88ms、TOC 三问题/代码块粘贴/表格工具栏/长大纲跟随全部修复 |
| 远程仓库 | ✅ 已推送 Gitee `master`（2026-08-02） |

## 五、仓库与分支

**本地仓库**：`/Users/admin/file/local-lake/lake-notes-electron`（独立 git 仓库）
**当前分支**：`master`（主开发分支；audit/code-optimization、experiment/virtual-rendering 已合入）
**远程**：
```
origin  https://gitee.com/gtycoder/local-lake.git
```
- Gitee `master` = Electron 正式版（当前最新）
- Gitee `main` = 旧 Tauri（trui）版，保留未动（如需让 master 成为默认分支，需在 Gitee 后台设置）

**推送方式**：本机 SSH key 未注册 Gitee，**必须用 HTTPS**（macOS 钥匙串已缓存凭据）：
```bash
git push origin master:master
```

**历史分支**（均已合入/过时，勿基于它们开发）：`audit/code-optimization`、
`experiment/virtual-rendering`、`feature/electron`、`asset-server-poc`、`main`（旧 Electron 快照）。

## 六、参考仓库（只读，勿修改）

| 仓库 | 用途 |
|---|---|
| `/Users/admin/file/local-lake/lake-notes-tauri-poc/` | Tauri 版源码：Rust 后端下载逻辑参考、**CSS 基准** |
| `/Users/admin/file/local-lake/siyuan/` | 思源笔记：S3 同步、资源管理、TLS 指纹方案参考 |
| `/Users/admin/file/local-lake/local-lake-notes-devlop/` | GitHub 上 devlop 分支的开发版（历史） |

## 七、文档索引

| 文档 | 内容 | 新会话优先级 |
|---|---|---|
| **docs/PROGRESS.md** | ★最新交接（最近会话全记录）、已完成（阶段 A/B/C/虚拟渲染）、当前问题、下一步计划 | **先读** |
| docs/DEVELOPMENT.md | 环境要求、开发/构建/打包命令、测试（双 ABI）、依赖版本、提交历史 | 动手前读 |
| docs/ARCHITECTURE.md | 进程结构、关键文件索引、图片数据流、数据与存储、S3 同步机制 | 改代码前读 |
| docs/TROUBLESHOOTING.md | 踩过的坑（打包/CDN/剪贴板/编辑器与 CSS/环境/S3 + 虚拟渲染新坑） | 遇坑查 |
| VIRTUAL-RENDERING-TEST.md | 虚拟渲染回归清单（逐项手测） | 动虚拟渲染相关代码前后跑 |
