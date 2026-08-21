# Lake Notes Electron 会话交接文档

> 更新时间：2026-08-21（V5 Phase 0 收尾合并）｜ 写给：完全没有上下文的新会话
> 开工前必读：本文件 + `AGENTS.md`（项目长期记忆/规则）+ `docs/SYNC-PROTOCOL.md`（同步协议）+ 外部 `/Users/admin/file/local-lake/lake-notes-refactor-plan-v5-2026-08-21.md`（当前有效执行方案）。
> 代码基线：`master` @ `e138555`（已推送 gitee `gtycoder/local-lake`），测试基线 358 passed。

---

## 0. 项目是什么

- 本地优先笔记应用：Electron + React + better-sqlite3 + 语雀 Lake 内核 + 七牛 S3 同步。
- **本地是真相，S3 只是镜像**；单用户、无并发提交、先提交云端者胜（产品前提，见 SYNC-PROTOCOL.md）。
- 删除/恢复语义已定稿：墓碑权威（删除压编辑）+ 恢复是唯一显式例外 + **小记不备份**——不要重新争论。

## 1. 任务目标（当前主线）

重构分两条线（V5 方案）：
1. **Phase 0 正确性与安全止血** —— **已完成**（本次合入 master 的 10 个提交）；
2. **移动端打基础**（Phase 1-4：lake-core 纯逻辑抽取 / 适配器注入点 / 契约接口 / 渲染层 hook）—— **尚未开始**，这是用户确认的目标主线。

移动端：**近期启动**，但技术栈未定（Tauri 2 路线已实验并否决）；Tauri POC 在 `/Users/admin/file/local-lake/lake-notes-tauri-poc`（含移动端 UI 雏形 `src/App.tsx` + `MobileLibrary.tsx`，用户可能在找某个 HTML 雏形）。

## 2. 分支与提交状态

```text
master（本地=远程 gitee origin/master）= e138555，工作区干净
历史分支 hardening/sync-correctness 已合并，可删除
stash@{0}：Codex 版 Electron-HANDOFF.md（旧交接，保留备用，非本任务内容）
```

**10 个提交内容**（均为本次 Phase 0 工作）：

| 提交 | 内容 |
|---|---|
| 41d942a | §5.1 group-only 早退判定 + markFolderSynced 归位；§5.2 本地同步快照保护（markSyncedIfUnchanged） |
| 1e2e764 | §5.3 Quick Notes save 轻量 staging + meta.json 恢复 |
| 49b3e0c | §5.4 import_remote 4 态 journal + 启动恢复 |
| 93ecbe2 | §5.5 远端对象缺失 B 方案（跳过+warnings）+ 墓碑原子写 |
| 7df3441 | §5.6 S3 单对象上限 / endpoint https / CDP 端口覆盖 / multidev 修正；§5.7 FTS 启动耗时日志 |
| bc91888 | R8 FTS 转义（含修 1 字符 LIKE 缺 ESCAPE）+ R9 recoverConversions 四组测试 |
| 18d41a1 | SYNC-PROTOCOL.md 协议定稿 + ARCHITECTURE.md v2→v4 漂移修正 |
| 6730e8a | CSP 收紧（dev/prod 双 CSP）+ **195 个 alipay 资源全本地化**（真机验证：CSP 零违规） |
| e138555 | 轻量 vendor lakex（闭源依赖固化 + 项目 postinstall 打 mindmap 补丁） |

**质量门槛全过**：tsc / 358 tests（原 334 +24）/ build / git diff --check / 3 个 UI smoke（test:ui / sidebar / tab-switch）。

## 3. 当前问题与风险

1. **未做项**：R10（CANCELLED 不弹 toast，依赖 Phase 3 错误码）；Phase 1-4 全部；customCard 原型卡片；移动端。
2. **双 React（18 + 19 via @xiangfa/mindmap）/ 双 mermaid**：登记为已知风险，不强行升级（V5 红线）。
3. **lakex 闭源冻结**（0.1.2，2026-07-21 后无更新）：已 vendor 固化 + 资源本地化，防 registry 撤包；若未来要深度定制编辑器，先验证 `LakexEditorConfig.customCard` 扩展点（做新卡片不需要 fork）。
4. **FTS 启动耗时**：store.ts:199 已加耗时日志，尚未按 100/1000/5000/10000 篇梯度实测（§5.7）。
5. **同步语义**：单写者前提（无 Manifest CAS）、对象缺失 B 方案（跳过+warnings，损坏仍拒绝）——详见 SYNC-PROTOCOL.md，不要重新争论。

## 4. 下一步计划（按序）

1. **Phase 1：lake-core 纯逻辑抽取**（零风险，桌面行为零变化）——V5 §6 清单（tree/tabLimit/concurrency/quickNoteModel/同步决策纯函数等 + check-core-boundaries.mjs 边界检查）；
2. **customCard 原型卡片**（验证 Lake 扩展点够不够用，决定是否完整 fork lakex）；
3. **Phase 2-4**（适配器注入点 / 契约接口 / App hook 拆分）；
4. **R10 + 错误码**（Phase 3）；
5. **移动端**（技术栈确定后：pnpm workspace 建议此时切换、lake-core 共享、WebView 复用 bundle 则 vendor lakex 就绪）。

**分支策略**：用户原则「未验收不合并」——大改动在独立分支，质量门槛全过 + 用户确认后才合 master；不要擅自提交/推送。

## 5. 踩过的坑（本会话经验，最值得继承）

1. **npm 11 `allow-scripts` 默认阻止依赖 postinstall**：lakex 的 postinstall（patch-package 修补 mindmap `disableAutoFit`）会被静默跳过——必须项目级 `postinstall: patch-package --patch-dir vendor/npm/lakex-editor-react-component/patches` 显式接管（已验证全新安装自动打补丁）。
2. **`.gitignore` 的 `dist` 规则会忽略 vendor 包内 dist**：vendor 化的包要加 `!vendor/npm/lakex-editor-react-component/dist/` 例外，否则 23M 编辑器代码不入库、新环境崩溃。
3. **CSP 收紧暴露隐藏外链**：Lake 编辑器 CSS/JS 内有 195 个 `gw.alipayobjects.com` 引用（60 字体 + 135 图标，未镜像）——已全下载到 `public/vendor/lakex/alipay/`，vite 插件 `lakexAlipayLocal`（vite.config.ts）在 dev/build 统一重写 URL。
4. **vite 插件 transform 对 JS 模块 id 带 `?v=` query**：`id.endsWith(".js")` 不匹配带 query 的 id——先 `id.split("?")[0]` 再判断扩展名。
5. **CSP 配置不能放 `.env`**（被 gitignore 忽略）：用 vite 插件 `transformIndexHtml` 按 `ctx.mode` 注入 dev/prod 双 CSP。
6. **npm file: 依赖是符号链接**：`node_modules/lakex → ../vendor/npm/lakex`，改 vendor 即生效（单一来源）。
7. **快照保护必须比对锁字段**：`applyRemoteLock`/`setNoteLocked` 不改 `notes.updated_at`——只用 updated_at 条件会漏锁变更，metadata 比对需含 isLocked/lockedAt（§5.2）。
8. **对象缺失「缺失」vs「损坏」区分**：缺失（对象不存在）→ 跳过 + warnings（B 方案）；损坏（size/sha256 不符）→ 仍中止。
9. **Quick Notes journal 4 态**（prepared→db_committed→files_promoted→completed）：先提交为确定 → 恢复只补做不撤销，无 rolled_back。
10. **group 归位是早退修复的必配**：个人笔记本初始 sync_state='local'，group-only 早退查询上线后必须 markFolderSynced 归位，否则永不早退。
11. **多行提交信息**用 `git commit -F file`（命令行 -m 多行易出错）。
12. **改 TS 代码里的长字符串/模板**用 write 写脚本文件再执行（run_code 内嵌数组易踩引号/反引号解析坑）。

## 6. 环境与命令

```bash
# Node 24（不要动全局/公司 Node 18）
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

# 开发实例（带 CDP，真机验证用）
cd /Users/admin/file/local-lake/lake-notes-electron
export LAKE_USER_DATA="$HOME/Library/Application Support/lake-notes-dev"
export LAKE_CDP_PORT=9222
npm run dev   # vite 拉起 electron

# 质量门槛（每阶段合并前）
npm test -- --run  /  npx tsc --noEmit  /  node node_modules/vite/bin/vite.js build  /  git diff --check
LAKE_CDP_PORT=9222 npm run test:ui   # 依赖活体 dev 实例
LAKE_CDP_PORT=9222 npm run test:sidebar-interaction
LAKE_CDP_PORT=9222 npm run test:tab-switch

# CDP 检查脚本（本会话建的）
node /tmp/cdp-csp.mjs        # CSP 违规 + 资源清单
node /tmp/cdp-final2.mjs     # reload 后零违规验证
```

- 数据：开发 `~/Library/Application Support/lake-notes-dev`（可重建）；正式 `lake-notes-electron`（禁碰）。
- 杀进程用具体 PID，禁 `pkill -f Electron`（机器有 Trae/SiYuan/VSCode）。
- 远程：gitee `gtycoder/local-lake`。

## 7. 关键文档索引

```text
/Users/admin/file/local-lake/lake-notes-refactor-plan-v5-2026-08-21.md   ★ 唯一有效执行方案（综合所有审计/GPT 意见）
/Users/admin/file/local-lake/lake-notes-audit-2026-08-21.md              8 领域问题清单
/Users/admin/file/local-lake/lake-notes-scope-review-2026-08-21.md      过度设计裁决（场景约束）
/Users/admin/file/local-lake/lake-notes-gpt-review-verdict-2026-08-21.md  GPT 64 条意见处置总表
/Users/admin/file/local-lake/_archive/                                  历史方案/复核原文
docs/SYNC-PROTOCOL.md                                                   同步协议定稿（本 repo）
AGENTS.md                                                              项目长期记忆/规则
```

## 8. 记录

本交接取代 Codex 版（其内容 stash 于 stash@{0} 备用）。Phase 0 全部完成并合入 master，测试基线 358。