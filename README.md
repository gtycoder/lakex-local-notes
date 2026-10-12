# Lake Notes（Electron）

本地优先的 Lake（语雀）编辑器笔记应用。**本文是项目总览入口；会话交接的唯一文档是** **`HANDOFF.md`。**

> 给完全没有上下文的后续会话：按 **README → HANDOFF → AGENTS** 阅读。README 提供项目概览；
> HANDOFF 记录当前状态/真正的待办/踩坑；AGENTS 是长期红线/机制/坑。之后按需读下面的开发/架构文档。
> **HANDOFF 只保留最新 §0 + 当前基线/待办/坑**；历史 dated handoff 已删除，只在 git 历史可查（`git log -p --follow HANDOFF.md`）。
> **当前主开发分支是** **`master`**（= Gitee 远程默认分支，已验证 `ls-remote --symref`；本地与远端同步）。

***

## 设计先决条件（所有开发 / 审计 / 重构的前置约束）

> 用户定稿（260909）。任何功能开发、代码审计、重构与性能决策都必须以本节为前提：
> **不为超出这些条件的场景做设计**（过度设计）；改动与本节冲突时先与用户讨论，不擅自变更语义。
> 与 `AGENTS.md` 冲突时：红线/机制以 AGENTS 为准，**量级与场景假设以本节为准**。

1. **本地优先 + 云端备份**：本地是唯一真相，S3 只是镜像/备份；云端绝不反噬本地。
2. **个人笔记、多端无并发**：单用户多设备轮换使用；不存在多设备同时编辑同一文档的对抗场景。
3. **先提交者为真、不解决冲突**：冲突时先提交者视为正确，被覆盖方的编辑以历史快照（`createHistorySnapshot`）归档留档，不做冲突合并。
4. **回收站是"有笔记本行为的系统容器"**：软删 = 移入回收站笔记本；墓碑权威、删除压编辑；恢复是唯一显式例外（`restore_pending_at` → local-wins）。
5. **数据量级基线：5000 文档 / 2万附件**（全库含附件 \~20GB，单文档可达数 MB）：性能、分批、内存与 SQL 参数预算均按此量级核算；AGENTS §1 的 10 万/100 万压测基线仅作长期参考，不作为设计前提。
6. **搜索单独立项**：搜索功能（FTS 索引/短词/增量等）将整体统一重构，常规审计与重构不含搜索优化项。

## 一、项目概览

- **形态**：Electron 44 桌面应用 + Capacitor 安卓端（正式端）。

## 二、核心设计理念（仿思源笔记资源管理）

1. 图片/附件按笔记分目录存储（`note-assets/{noteId}/`），文档与资源分离
2. 不做图片去重（冗余存储可接受）
3. 用 S3 做备份/同步（参照思源的 S3 同步思路）
4. 复制到第三方（微信）时图片能正常显示（webp→png 转换）
5. 本地资源完全离线可用（Lake 编辑器 CDN 依赖全量本地镜像）
6. **不弹"正在加载"之类的 toast**

## 三、技术栈

Electron 44.3 + React 18.3 + TypeScript 5.9 + better-sqlite3 13（N-API，无需 rebuild）+ Lake 编辑器
（`@dlient/lakex-doc-react` 上游源码 vendor（产物入库），内核 v1.99.0，已 pin、勿随意升级）+ Drawnix 画板（`lakex-drawnix@0.1.0`）+
sharp（图片转换）+ @aws-sdk/client-s3；移动端 = Vite + Capacitor（安卓）。准确版本以 `package.json` 为准。

## 四、仓库与分支

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

**在途 worktree / 本地分支清理现状**：属易过期事实，**以 `HANDOFF.md` §0 为准**（本文不维护）；开工前先跑 `git worktree list` + `git status` 核对。

**分支策略**：所有功能分支合入后删除；历史分支不重新启用，需要时从 git 历史或远端归档查看。

## 五、参考仓库（只读，勿修改）

| 仓库                                                   | 用途                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `/Users/admin/file/local-lake/yuque-developer-docs/` | 语雀开发者文档本地副本（**lakex 内核官方出处 / 检索第一顺位**，见 `AGENTS.md` §2）：`47 - 通用配置`、`08 - 命令列表`、`65 - 大纲（toc)` 等 |
| `/Users/admin/file/local-lake/siyuan-master/`        | 思源笔记 v3.8.0（**AGPL-3.0**，移植样式需留 NOTICE）：S3 同步/dejavu、资源管理、UI 视觉基准 |
| `/Users/admin/file/local-lake/lake-main/`            | lakejs 开源社区版内核（MIT）：**当"机制字典"读源码**，不是我们实际运行的 lakex 内核             |
| `/Users/admin/file/local-lake/lake-editor-main/`     | 第三方 VSCode yuque-editor 插件（参考价值低）                                 |
| `/Users/admin/file/local-lake/yuque-re/`            | **语雀逆向资料仓（证据仓，不是源码）**：安卓 RN/资源还原、web 文档编辑器·小记·多维表的运行时实测。**先读该目录的 `USAGE.md`**（查询器 `tools/qy.py`）；结论只作旁证，仲裁仍是 `AGENTS.md` §2 的三级检索 + 运行时实测 |

## 六、文档索引

| 文档                                           | 内容                                                              | 新会话优先级       |
| -------------------------------------------- | --------------------------------------------------------------- | ------------ |
| **HANDOFF.md**                               | 唯一交接文档（当前状态/待办/坑）；只保留最新 §0，历史在 git                            | **交接首读**    |
| **docs/CODEX-GUIDE.md**                      | Codex 自主开发指南（Playwright 驱动真实 Electron/Computer Use/浏览器）         | **动手前必读**    |
| docs/LAKEX-CONTRACT.md                       | 闭源 lakex 内核行为契约 + 调试速查表（会话知识库，编辑器相关先查）                          | 编辑器先读        |
| docs/DEVELOPMENT.md                          | 环境要求、开发/构建/打包命令、测试、依赖版本、提交历史                                    | 动手前读         |
| docs/SYNC-PROTOCOL.md · docs/S3-GC-DESIGN.md | 同步协议 / GC 与保留链（**改同步、GC 前必读**，配合 AGENTS §3 原则 11\~13）           | 动同步必读        |
| docs/STORAGE-LAYERS.md                       | 存储分层与「设备本地」契约（**新增持久化前必读**：哪些进 S3 / 哪些仅本地、三处同改规则）              | 加持久化前读       |
| docs/ARCHITECTURE.md                         | 进程结构、关键文件索引、图片数据流、数据与存储、S3 同步机制                                 | 改代码前读        |
| docs/TROUBLESHOOTING.md                      | 踩过的坑（打包/CDN/剪贴板/编辑器与 CSS/环境/S3 + 虚拟渲染新坑）                        | 遇坑查          |
| docs/PANEL-CONTRACT.md · docs/UI-PRIMITIVES-PHASE1-260926.md | 面板几何/层序契约、浮层原语规范 | 改 UI/外壳前读 |
| docs/RELEASE.md · docs/SYNC-RELIABILITY-VERIFY.md | 打包发布与同步可靠性验收 | 发布前读 |

