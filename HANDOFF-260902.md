# HANDOFF-260902 · 会话交接：备份完整性审计 + 正确性小改（W-2/W-7/W-6/A）

> 写给零上下文的新会话。先读 `AGENTS.md`（长期记忆）再读本文。
> 本文是「同步/备份数据完整性」线的最新交接；UI 打磨线见 `HANDOFF-260901-UI.md`，性能主线见 `HANDOFF-260901.md`，评审方案见 `AUDIT-260828.md` / `PERF-260828.md`。

## 0. 项目一句话

本地优先笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo）仅作**多端同步镜像**。**本地是真相，S3 只是镜像。**

## 1. 当前基线

- **master = `c1623c0`**（已推 Gitee），工作区干净（本地仅 master 分支）。
- 质量门槛：`tsc` 全绿 · `vitest` **741 passed / 1 skipped** · 桌面 + 移动 `vite build` 全绿。
- 本会话（2026-09-02）在 `fix/audit-correctness` 分支（已并入 master）完成 4 个独立提交。

## 2. 本会话完成内容（均已并入 master，可 `git revert` 单个回滚）

| 提交 | 内容 | 解决的问题 |
|---|---|---|
| `6838e7d` | **W-2** 正文下载后 sha256 校验（4 个下载点；与资产强校验对齐，hash 不符→warning+跳过） | 损坏/篡改正文不再被静默当作本地真相入库/反向传播 |
| `0baa87a` | **W-7** 保存路径文件写移出 DB 事务（`atomicWrite` 先于事务，落盘失败不碰 DB） | 磁盘失败不产生「DB 已提交但正文没写进文件/丢编辑」；仅极罕见 DB 提交失败留「新正文+旧元数据」且自愈 |
| `a05a1f8` | **W-6** 删除死代码 `decideTrashCross`/`decideTrashYield`（+`TrashCrossDecision` 类型）+ sync.ts 未用 import + 对应测试 | 决策单点化（引擎内联唯一实现），消除双实现分叉 |
| `c1623c0` | **A 方案** 上传 `manifest.assets` 并入「正文引用 + 已声明元数据」 | 备份清单永不漏记录「正文引用但本地缺文件」的资源 |

### A 方案（备份完整性关键，重点理解）
- 新增 `declared_assets` 表（desktop `electron/store.ts` + 移动端 `src/mobile/bridge.ts`），记录 manifest 声明的资产 `{filename,size,hash}`。
- `SyncDbPort` 加两个**可选**方法 `recordDeclaredAssets`/`listDeclaredAssets`；desktop adapter（`electron/syncAdapters.ts`）实现且**优雅降级**（store 缺该方法则 no-op/空数组）。
- `downloadAssets` 下载时记录声明元数据（即使该资源本地文件缺失）。
- 上传 `manifest.assets = scanLocalAssets(本地文件) ∪ 正文引用资源的已声明元数据`（`syncEngine.ts` 的 `resolveUploadAssets`）。
- **语义关键**：用**当前正文引用**（`extractAssetRefs(contentOf(local))`），**不用历史引用**。历史引用只进 GC keep 集（防误删、供恢复），**绝不进 manifest** → 已删除的资源不会因历史钩子挂回当前文档。
- 用户边界已确认：本地缺文件 + 编辑删除该引用 → manifest 正确不含它（不产生幽灵文件/不重挂载）。

## 3. 红线（违反即返工，见 AGENTS.md）

1. `src/core/` 禁 `node:` 导入（双端共享层）；平台差异走注入。
2. 本地是真相，S3 只是镜像；**不改同步协议语义、不改 DB 写入行为**。
3. 开发数据只用 `lake-notes-dev`；**绝不碰 `lake-notes-electron` 正式数据**。
4. 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`。
5. 不为旧数据写兼容/迁移代码；能删重建就删重建。
6. 云端是备份——**备份绝不能反噬本地数据**（本会话一切改动以此为最高优先级）。

## 4. 当前问题 / 待办（按此排布，未做）

### 4.1 已明确「待办/独立项」
- **FTS 搜索重做（独立立项，暂缓）**：当前 `notes_fts` 用 `tokenize='trigram'`（`store.ts:297`），只索引 ≥3 字符 → **1/2 字搜不到正文**（1 字只搜标题、2 字 P4-2 只搜标题）。本机 SQLite **无 `ngram` tokenizer**（只有 trigram/unicode61，且 unicode61 对中文子串更差），所以「换 tokenizer」走不通。可落地方案 = **trigram(≥3) + <3 字「标题+正文 LIKE」短查询**。**优先级：暂缓**（用户拍板先不做，后续重做整个搜索）。
- **回收站惰性下载（独立专项）**：批量删除后他端首拉会全量下载回收站资源（实测 106 资产/58MB≈8-9s）。已定方案：**「冻结资产清点 + 恢复前强拉全量」**（进回收站不能编辑→清点不变；不是自己删的、可能被清空→先不拉资源；恢复时强拉全量）。**要注意恢复红线**，配用例。
- **W-9 App.tsx 拆分（单独 `refactor/app-split` 分支最后做）**：App.tsx 仍 1175 行 god component。纯重构、无行为变化、改动大易回归，**必须单独分支分批**，别和正确性小改混。
- **W-8 ACAO / W-10 dompurify（挂起，并入 lake 资源导入统一优化）**：可能影响 lake 资源加载，先记录。

### 4.2 记录的 bug / 已知问题
- **移动端大纲只读(viewer)下点击不跳转**：`OutlineSheet` 用 `renderer.execCommand("headingUnfold")`+`scrollByNodeId`，viewer 下不生效。已记入 `docs/TODO.md`，**用户将重做大纲时一并处理**。
- **安卓同步 DNS 解析失败**：`UnknownHostException`，设备网络问题非代码，联网重试即可。
- **回收站首拉成本 + 笔记本新建跨端撞号**：见 `HANDOFF-260901.md` §2。

## 5. 下一步计划（推荐顺序）

1. **先验收 `c1623c0`（A 方案）**：属备份数据完整性，建议跑一次**双端真机**同步（A/B 两端），确认删改/恢复/资源清点行为正常、无丢资源。
2. （若要）做 **W-9 App 拆分**：单独分支、分批（每批拆一个 hook + 跑门槛），最后合。
3. （若要）做 **回收站惰性下载**：独立专项 + 用例。
4. **FTS 重做**：等用户明确重做范围后再立项。
5. 其余（W-8/W-10）等 lake 资源导入优化统一做。

## 6. 踩过的坑（务必记住）

### 环境 / 进程
- Node 用 `$HOME/.nvm/versions/node/v24.18.0/bin`（系统 Node 18 跑不了 Vite 8/Vitest 4）。
- **better-sqlite3 是 Electron ABI**，系统 Node 24 加载不了；查 sqlite 用 `python3`/`sqlite3` CLI。
- 杀 Electron 只 kill 具体 PID；多开 A/B 端用 `LAKE_USER_DATA=$TMPDIR/lake-device-b LAKE_ASSET_PORT=19877`。
- vite dev server 要 `tty=true` 长驻；改 `electron/main.ts` 会触发 vite-plugin-electron 重启 Electron（可能退出，需重启 dev）。
- 安卓构建：`JAVA_HOME=jdk-21.jdk/Contents/Home`，SDK 在 `/opt/homebrew/share/android-commandlinetools`（不是 `~/Library/Android/sdk`）。
- 移动端真机验证：`adb`（`/opt/homebrew/bin/adb`）+ `cap sync android` + `gradlew assembleDebug` + `adb install -r` + `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`（socket 会因重装变，需重新抓）。

### 验证回路（本次全程用 CDP 实测，别凭印象下结论）
- **桌面** 9222：`npm run dev`（长驻 tty）→ CDP 连 `http://127.0.0.1:9222/json`（Node24 原生 WebSocket，无需 playwright）。
- **移动** 9223：真机启动 + `adb forward` → CDP 连 9223。切深色 `adb shell cmd uimode night yes/no`。
- **三门槛**：`npx tsc --noEmit && npx vitest run && node node_modules/vite/bin/vite.js build`（移动端加 `--config vite.mobile.config.ts`）。

### 同步语义（改动务必守住，否则返工/丢数据）
1. **下载环 后 再取上传 `getAllNotes`**：提前取会让刚下载的笔记被判 upload 造成回环重传（`syncEngine.ts:626`）。
2. **`contentOf` 只在留历史快照/上传入队时回查正文**（P3-1：批量行 content 可为 ""）；`ownEditOf` 用 `contentHash` 不读正文。
3. **manifest.assets 用当前正文引用 ∪ 已声明元数据**，**不用历史引用**（A 方案，防删除引用挂回当前文档）。
4. **恢复例外**：`restore_pending_at` 清除在 `markSynced`/delete/purge 各路径，W-4 已修——别破坏。
5. **墓碑权威**：删除压编辑，恢复是唯一例外。
6. **测试用的 store mock**：legacy sync 测试（`electron/sync.test.ts` 等）用**部分 store mock**，新增 store 方法必须**优雅降级**（adapter 里 `typeof store.xxx === "function"` 判断），否则直接 `store.xxx is not a function`。

### 迁移/用例提示
- 本会话给 desktop store + 移动端 bridge **新增了 `declared_assets` 表**（`store.ts` schema + `bridge.ts` schema），dev 库可删重建，无迁移负担。
- 给 `NoteContentRepository.save` 加了**独立单测**（`electron/noteContentRepository.test.ts`，mock DbLike 需满足 `DbLike` 接口：prepare/get/all/run/transaction/pragma/exec/close）。若新加的类依赖 mock DB，照此补全接口。

## 7. 关键文件索引

| 文件 | 角色 |
|---|---|
| `src/core/syncEngine.ts` | 共享同步引擎（W-2/A/下载/上传）。**A 方案核心**：`resolveUploadAssets`、`recordDeclaredAssets` |
| `electron/syncAdapters.ts` | 桌面 SyncDbPort adapter（缺方法优雅降级） |
| `electron/store.ts` | 数据访问（`declared_assets` 表 + `recordDeclaredAssets`/`listDeclaredAssets`） |
| `src/mobile/bridge.ts` | 移动端 SyncDbPort（`declared_assets` 表 + 方法） |
| `electron/noteContentRepository.ts` | 保存路径（W-7：文件写先于事务） |
| `electron/noteContentRepository.test.ts` | W-7 保存单测 |
| `src/core/searchRepository.ts` | FTS 搜索（trigram；1/2 字待办） |
| `AUDIT-260828.md` / `PERF-260828.md` | 评审/性能方案 |

## 8. 验收命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npx tsc --noEmit
npx vitest run
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts
```
