# Lake Notes 会话交接文档（2026-08-23）

> 写给完全没有上下文的新会话。本会话（2026-08-23）核心工作：**桌面同步墓碑生命周期修复 + 移动端删除传播/图片保存/目录树**。
> 项目根：`/Users/admin/file/local-lake/lake-notes-electron`。先读 `AGENTS.md`（核心原则）+ 本文件 + `docs/TODO.md`。

## 1. 项目是什么

本地优先笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核 + Capacitor 移动端），S3 同步（七牛 Kodo，桶 `local-lake-hebei`，测试前缀 `ab-test-verify`）。**本地是真相，S3 只是镜像**。

- 桌面端：`electron/` + `src/`（Vite + electron，CDP 调试端口 9222）
- 移动端：`src/mobile/`（Capacitor Android，WebView 内跑共享 syncEngine，CDP 端口 9295）
- 共享同步引擎：`src/core/syncEngine.ts`（桌面 + 移动端共用）+ `src/core/quickNotesSyncEngine.ts`（小记独立前缀）

## 2. 任务目标（本会话）

用户验收顺序：
1. **桌面同步墓碑生命周期修复**（31 待上传归零 + 删除传播）
2. **移动端删除传播**（手机端删除的内容要能上云、其他端跟随删除）
3. **移动端图片保存污染**（编辑保存后图片裂）
4. **移动端目录树文档嵌套**（桌面"父文档套子文档"在手机可见）
5. 提交合并推送 + 本交接文档

## 3. 已完成内容（全部合并到 master 并推送到 gitee）

### 3.1 桌面墓碑修复（commit a9920dd）
- **墓碑占位符发布**：purge 后内容缺失（.lake 已删）不再 skip，降级占位符 id 照常发布 `deleted:true`（迁移回归——syncEngine 迁移时把旧 sync.ts 的占位符逻辑丢了，导致删除永不传播、计数永远 31）
- **deleted_notes 加列**：`node_type`（note/folder）+ `published_at`（已发布标记）
- **计数归零**：`getSyncPendingSummary` 只算"未发布的 note 墓碑"；`purged`（收到他端删除的保留副本）永不上传、不计待上传、不阻塞早退（`hasLocalPendingNotes` 排除）
- **B4 修复（深层 bug）**：purged 条目发布时不再从 manifest 移除——否则收到他端删除的设备会**吞掉 deleted:true 墓碑**，离线第三端可复活已删内容

### 3.2 移动端删除传播 + 图片保存 + 目录树（commit eb1e18e）
- **purge 传播**：`purgeTreeItem` 物理删行 + 写墓碑（此前只标 `sync_state='purged'` 永不发布 → 手机删的东西永远不上云）
- **墓碑端口**：移动端实现 `listDeletedNotesForSync/readDeletedContent/markTombstonesPublished`，`isFolderPurged` 加 `purged_at` 条件
- **图片保存污染修复**：`blobInject/cardBlobInject` 的 restore 正则补 **URI 编码形态**（`blob%3Ahttps%3A%2F%2F...`）——card value 里 blob URL 是编码的，明文正则匹配不到 → 保存把 blob 存进存储 → 重开即裂
- **裸 URL 映射**：`<img src="http://127.0.0.1:...">` 注入路径补 `blob→canonical` 映射
- **setNodeIcon bug**：`.run().changes` 在 sql.js 恒 0 → 改 SELECT 确认
- **目录树**：`listNotebookTree` BFS 支持 note 作父（任意层级嵌套）；`NotebookPage` 嵌套文档可展开（chevron 行首加大）、图标展示（emoji/字符）、**展开状态按笔记本缓存**（进文档返回保持）

### 3.3 原则补充（commit 5bf52ca）
- `AGENTS.md` §3.10：永远不要为旧数据写冗余代码（开发版数据可删重建）

### 3.4 之前已合并的（a10c595 及更早）
- a10c595：桌面 folder purge 复活修复（isFolderPurged + 发布重写 manifest）
- 移动端通知栏/composer/图片注入等系列（28cdd14 ~ 400242c）

**测试基线：676 passed | 1 skipped**（新增 blobRestore/bridgePurge/bridgeTree 测试 + B4 回归 + store 计数/列测试）。

## 4. 当前问题 / 已知未解决

1. **桌面弹窗与红绿灯重合**（排查过未修）：同步状态弹窗/工作空间菜单定位到左上角 (8,7)。根因：DOM 有**两个** `.sync-status-button` 实例（一个在 (196,5) 正常，一个在 (0,0) 未布局），`syncBtnRef` 绑到隐藏实例 → `getBoundingClientRect()` 全 0 → 锚点失效。怀疑 App.tsx 两条渲染路径（库视图 + 小记视图）ref 抢占。**未修**（用户当时让先放下）。
2. **清空回收站立即删云端无延迟窗口**：用户确认这是预期（purge = 二次确认的彻底删除，本地历史快照也删）。7 天保留（`gcRetentionDays`）只保护**深清孤儿对象**，不保护主动 purge。
3. **测试数据脏**：测试11（fd60755d）等已被 blob 污染的旧数据在云端/桌面/手机（blob URL 存进了存储）。按 §3.10 删掉重建即可，不要写兼容代码。
4. **手机端目录树创建/移动**：只做了展示（嵌套可见 + 展开），**嵌套文档的创建入口（新建到父文档下）、拖拽移动**未做（用户说先不做编辑）。
5. **桌面 dev server GPU crash**：vite dev 模式下 electron 偶发 GPU 进程崩溃退出（日志 `GPU process exited unexpectedly`），需重启 dev server（`LAKE_CDP_PORT=9222 npx vite --port 1421`）。
6. **origin 历史分支**：gitee 上有 `feat/mobile-android`、`refactor/mobile-capacitor`、`main`、`backup/pre-reset-master-20260819` 等旧分支（可清理，未动）。

## 5. 下一步计划（建议）

1. 修复桌面弹窗双实例 ref 抢占（App.tsx 两条顶栏渲染路径合并/ref 修正）——见 §4.1
2. 手机端目录树：新建文档到父文档下（parentId 传 note）、拖拽/长按移动、图标编辑（用户说"先不做编辑，只做展示"）
3. 清理 gitee 旧分支（`feat/mobile-android` 等）
4. 用户实机验收后：删掉污染测试数据（测试11 等）重建干净基线
5. 手机端"小记"相关的待办看 docs/TODO.md

## 6. 踩过的坑（务必记住）

### 环境 / 进程
1. **adb 位置**：`/opt/homebrew/share/android-commandlinetools/platform-tools/adb`（不在 PATH；brew 装的 commandline tools）。手机小米 25098PN5AC，序列号 `133ee490`。
2. **CDP 端口**：桌面 9222、手机 9295（`adb forward tcp:9295 localabstract:webview_devtools_remote_<pid>`，pid 每次重启变，必须重新 forward）。手机 WebView 可能 `visible:false`，长 eval 会超时。
3. **electron 主进程改动**（syncEngine 等）触发 vite-plugin-electron 自动重启 electron；重启后 GPU 可能崩（见 §4.5），CDP 9222 会断，需重启 dev server。
4. **JDK**：gradle 构建用 `/Library/Java/JavaVirtualMachines/jdk-21.jdk`（系统默认 Java 8 太旧）。ANDROID_HOME=`/opt/homebrew/share/android-commandlinetools`。
5. **移动端构建流程**：`npx vite build --config vite.mobile.config.ts`（输出 dist-mobile）→ `npx cap sync android` → `cd android && ./gradlew assembleDebug` → `adb install -r app-debug.apk` → `am force-stop + am start` 重启（install -r 不重启 app，新代码不生效）。
6. **bash 变量**：run_code 的 bash 里 `VAR=xxx; $VAR cmd` 有时不展开（直接写全路径可靠）。
7. **run_code 模板字面量**：代码里的模板字符串含反引号/中文引号（""）会触发 parse error，改用数组 join 或避免。

### 同步 / 代码
8. **sql.js 的 run() 无 statement 级 changes（恒 0）**：判断行存在必须用 SELECT（setNodeIcon 就踩了）。
9. **bridge 对象同名方法自引用 = 无限递归**：在 bridge 对象末尾加 `listNotebookTree() { return bridge.listNotebookTree(...) }` 会栈溢出（RangeError），模块级函数提取（函数声明 hoist）解决。
10. **lakeNative ≠ bridge**：`window.lakeNative` 是 MobileApp.tsx 手动映射的接口，bridge 对象上加的方法不会出现在 lakeNative（CDP 验证时注意）。
11. **B4 filter 吞墓碑**：收到他端删除的设备发布时，purgedIds 过滤会把 deleted:true 从 manifest 移除 → 离线端复活。**purged 条目只该不上传，不该从 manifest 抹掉**。
12. **restore 正则匹配编码形态**：card value 里 blob URL 是 `blob%3Ahttps%3A%2F%2F...`（URI 编码），明文 `blob:...` 正则匹配不到 → 保存污染。两种形态都要还原，编码形态替换为 encodeURIComponent(canonical)。
13. **云端对象读法**：manifest 是 gzip 压缩的，测试/脚本读 `s3.getObject`（自动 gunzip），不要直接读 map。
14. **墓碑 semantics**：`purged` = 收到他端删除的保留副本（可恢复、不上传）；`purge`（本地主动清空回收站）= 物理删 + 墓碑（deleted:true 传播）；软删（进回收站）= trashedAt 条目上云。

### 数据 / 测试
15. **开发数据**：`~/Library/Application Support/lake-notes-dev`（桌面，可删重建）；手机 app 数据 `adb shell pm clear com.lakenotes.mobile`。
16. **S3 凭据**（测试用）：AK `***REMOVED***`，SK `***REMOVED***`；Endpoint `https://s3.cn-north-1.qiniucs.com`，Region `cn-north-1`，Bucket `local-lake-hebei`，Prefix `ab-test-verify`。
17. **vitest**：移动端测试 mock `./sqliteDb.js`（Vite ?url wasm import 在 node 崩）+ `./persistence` + `./assetFs`；cardBlobInject 需 mock `lakeRuntime.js`。
18. **手机端测试数据**：测试本笔记本（493f09af）有嵌套链 无标题文档144→文档22→文档111(🏓图标)→分组2333→组下11，用于验证目录树/图标。

## 7. 关键命令速查

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit && npm test -- --run        # 676 passed | 1 skipped
# 桌面 dev（CDP 9222）
LAKE_CDP_PORT=9222 npx vite --port 1421
# 移动端构建 + 安装
npx vite build --config vite.mobile.config.ts && npx cap sync android
cd android && JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleDebug
adb -s 133ee490 install -r app/build/outputs/apk/debug/app-debug.apk
# CDP eval 工具
bash scripts/cdp-util/cdp-eval.sh 9222 'expression'   # 桌面
bash scripts/cdp-util/cdp-eval.sh 9295 'expression'   # 手机（先 adb forward）
# 云端对象查看
S3_AK=... S3_SK=... S3_PREFIX=ab-test-verify node scripts/s3-ls.mjs --count
```

## 8. 当前 git 状态

- `master` 与 `feat/mobile-polish` 同点（5bf52ca），已 push gitee。
- 工作区只剩 `prototype/`（旧遗留，不相关，未提交）。
- gitee 旧分支：`feat/mobile-android`、`refactor/mobile-capacitor`、`main`、`backup/pre-reset-master-20260819`（可清理）。
