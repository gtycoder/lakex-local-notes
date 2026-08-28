# Lake Notes 交接文档（2026-08-27 · 审计+修复会话）

> 写给完全无上下文的新会话。
> 本轮做了两件事：**① 审计** 此前 GPT 实现的 5 块功能；**② 修复** 审计发现 + 用户反馈的若干 bug。
> 新会话必须优先读本文件、`AGENTS.md`（项目长期记忆，含核心设计原则）和 `docs/TODO.md`。

---

## 1. 当前分支与工作区

- 当前分支：`perf/mobile-startup-batch1`
- 基线：`master` / `origin/master` @ `a18b176 docs: 安卓端技术方案 + 启动耗时分析（供 GPT 优化咨询）`
- 本分支改动：**尚未提交**，**不要直接合并或推送**，等待用户验收。
- 工作区同时包含：此前 GPT 的移动端启动优化/同步语义/保存幂等/图标能力，以及**本轮新增的审计修复**。
- 生成的 `dist/`、`dist-mobile/`、Android web assets 属构建产物，通常被 gitignore 忽略。
- **本分支还没有跑 `git add`**；验收前不要动其它功能分支。

---

## 2. 本轮目标

1. 审计此前 GPT 实现的：移动端启动性能优化 / 桌面+移动端同步状态语义调整 / 编辑器初始化误保存与保存幂等 / 移动端文档图标底层能力 / 思源式同步 UI 状态，确认是否有问题。
2. 修复审计发现 + 用户反馈的 bug（目录计数口径、附件 hover、音视频卡闪现、媒体附件弹窗、移动端音视频输入 UI、附件卡阴影）。
3. 全程**遵守原则 10：永远不要为旧数据写冗余代码**（本轮一度违反，已撤销）。

---

## 3. 审计结论（5 块 GPT 功能）

总体：**实现自洽、无严重 bug**。质量门槛（测试/tsc/build）全绿。仅发现一处真实问题（目录计数口径），其余为代码卫生/一致性观察，非硬 bug。

| 功能 | 结论 |
| --- | --- |
| 移动端启动性能优化 | ✅ 正确。init 延迟迁移、listNotes 只返回摘要、资源按需读 FS、懒加载 doc 页。 |
| 同步状态语义调整 | ⚠️ 目录待同步计数口径不一致（已修，见下）。其余正确。 |
| 编辑器初始化误保存与保存幂等 | ✅ 正确（noteSaveDecision / editorChangeGuard / 两端幂等）。 |
| 移动端文档图标底层能力 | ✅ 正确（setNodeIcon 支持 note+folder，manifest 发布 icon）。 |
| 思源式同步 UI 状态 | ✅ 正确（状态优先、无总数徽标、弹层三项计数）。 |

---

## 4. 本轮已完成内容

### 4.1 目录待同步计数口径（审计发现的真实 bug）
`electron/store.ts` 的 `getSyncPendingSummary().folders` 原来带 `AND trashed_at IS NULL`，导致**目录移入回收站后同步会真的传播该删除，但「待同步目录」显示 0**（与笔记统计不对称）。
- 修复：去掉 `trashed_at IS NULL`，与 `listFoldersForSync`（发布方向）口径一致。因同步发布后 `syncEngine` 对 `listFoldersForSync()` 全量调用 `markFolderSynced`，计数会正确归零，不会"永不归零"。
- 新增测试：`counts a trashed folder as pending (aligns with listFoldersForSync)`。

### 4.2 附件 hover 残留不消失（bug C）
`src/features/attachment/attachmentPreviewController.ts` 的 `createCardHoverResidueCleaner` 原来只在 `pointerdown` 清理 `.ne-card-hovered`。
- 修复：新增 `pointerout` 监听，光标离开卡片（`relatedTarget` 不在卡内）即移除 `.ne-card-hovered`；保留 `pointerdown` 兜底。

### 4.3 音视频卡进入/锁定/解锁时失败闪现（bug B）
`src/features/editor/lakeRuntime.ts` 的 `tryEnsureAudio` 兜底：缩短首次重试 `500ms→80ms`；在重载失败媒体元素时设 `preload="metadata"`，避免急切加载竞争的错误闪现。
- 已在运行端用 CDP 实测：进入时 `error=null`、卡片 class 全程为空，闪现消除（仅 7ms 的无源过渡态）。

### 4.4 媒体附件点击打开"webview 弹窗"（bug A）
`EditorTab.tsx` / `LakeEditor.tsx` 原来用 `isMediaFilename(name)`（只看卡片名）判定媒体；当卡片名缺扩展名/异常时媒体附件会误落 `directOpen`（系统/新窗口，即"webview 弹窗"）。
- 修复：改用 `item.kind`（`buildAttachmentPreviewItem` 已按 `name||src` 判定，canonical src 带扩展名）|| `isMediaFilename(name)` → 媒体附件稳定走**应用内嵌播放**（不跳系统弹窗）。

### 4.5 移动端音视频卡片输入 UI
`src/mobile/editor/EditorDock.tsx` 插入面板新增「音频」「视频」按钮；`src/mobile/document/DocumentPage.tsx` 各配 `accept="audio/*"`/`"video/*"` 的文件选择器，复用 `insertFiles` 上传链路。

### 4.6 附件卡不渲染阴影/背景（用户需求）
`src/styles.css` 追加覆盖：`ne-card[data-card-name="file"]` 的 `.ne-card-file` / `.ne-card-hovered` 状态 无论是否 hover 都 `background/outline/box-shadow = none`（带 `!important`，编辑器+查看器两模式）。
- 根源规则：`.ne-viewer ne-card[data-card-name="file"]:hover .ne-card-file, ... .ne-card-hovered .ne-card-file { background: var(--lakex-editor-card-background-hover) }`。
- 只针对 `name="file"`（附件卡）；图片/音频/视频/其它卡 hover 样式不变。

### 4.7 已撤销：媒体文件卡 → 原生音视频卡（违反原则 10）
曾尝试用 `upgradeMediaFileCardsToNative`（内容清扫）把附件里的音频/视频文件卡提取成原生卡，并在 `EditorTab/LakeEditor` 的 onChange 应用。**该做法会在编辑时改动已有笔记（旧数据），违反原则 10**，已完全撤销（helper + 测试 + wiring 全部删除）。

---

## 5. 关键实测结论（Lake 卡片类型路由）

这些是运行端 CDP 实测得到的，**后续做音视频卡务必记住**：

| 插入方式 | 产出的卡 | 说明 |
| --- | --- | --- |
| `execCommand("insertFiles", [file])` | **文件卡**（图片→图片卡；音视频→文件卡） | 移动端/附件路径用的就是它 |
| `execCommand("insertVideo", [file])` | **视频卡**（强类型，塞 mp3 也变视频卡） | 视频卡专用命令 |
| `insertAudio` /`audio` /`insertCard` /`cardSelect` | 无/报错/不生效 | **音频卡没有独立命令** |

- **音频卡**只能由 Lake 原生 slash 的 `useMediaCard` 创建（内部 `readAudio/queryAudioUrl/setAudioInfo`，闭源无文档）。因此"从附件提取成原生音频卡"没有干净的向前路径（要么内容清扫=旧数据逻辑，违反原则 10；要么插入点拦截——桌面端是 Lake 原生插入、拦截不到）。
- **结论**：本轮**不做**"媒体附件→原生卡"。已改为：媒体附件即文件卡，但点开即应用内嵌播放（item.kind 修复），无系统弹窗。

### 原生音视频卡序列化标记（供未来参考）
- **音频卡**：`<card type="inline" name="audio" value="data:{status:"uploaded",audioId:"<canonical>",fileName:"...",fileSize:N,message:null,download:false,id:"...",margin:{top:true,bottom:true}}">`
- **视频卡**：`<card type="block" name="video" value="data:{status:"done",name:"...",size:N,taskId:"...",taskType:"upload",url:"<canonical>",cover:null,videoId:null,__spacing:"both",id:"...",margin:{top:true,bottom:true}}">`
- 注意：`value` 是 `data:` + `encodeURIComponent(JSON)`。

---

## 6. 当前问题 / 未完成

1. **音频卡无独立插入命令**：移动端音频按钮、附件媒体走 `insertFiles` 会产出文件卡（点开内嵌播放）。若要"真正的原生音频卡"，需 Lake slash 机制，暂无干净向前实现。
2. **桌面附件插入无法在插入点拦截**：桌面端是 Lake 原生 file 插入，没有可挂钩的 JS 拦截点做"按类型路由"。当前靠 item.kind 让媒体文件卡内嵌播放兜底。
3. **移动端未做真机验证**：设备 serial `50950385`（Xiaomi 2109119BC）在本轮最后一次安装后断开，需重连 + `adb forward` 才可验证。应验证：移动端音视频按钮插附件、媒体点开内嵌播放、附件卡无阴影。
4. **质量门槛最新状态**：`npm test -- --run` → **718 passed, 1 skipped**；`npx tsc --noEmit` 通过；桌面+移动 `vite build` 通过；`git diff --check` 通过。此为本轮**撤销 mediaCardConversion 后**的基线。

---

## 7. 下一步计划

1. **重连设备 `50950385`** 后装最新 APK，真机验证移动端：音视频按钮插媒体、媒体点开内嵌播放、附件卡无阴影、重复保存不推进 updatedAt、note 图标 bridge 写库并参与同步、首页不加载 DocumentPage/Drawnix/CodeMirror。
2. 若用户坚持要"真正的原生音视频卡"，需再次确认方案——**不要用内容清扫（违反原则 10）**；只能考虑插入点拦截（需要支持媒体文件卡的向前路径）或接受"媒体=文件卡+内嵌播放"现状。
3. 若未来需要展示"真实待上传资源数量"，必须增加独立资源上传 ledger；不要用正文引用数估算（设计红线 3）。
4. 移动端 UI 视觉可继续向思源靠拢，但不动 Lake 编辑器内核。

---

## 8. 踩过的坑（务必记住）

### 环境 / 进程
1. **杀 Electron 只能用具体 PID，绝不用 `pkill -f Electron`**——机器上有 VSCode/Trae/SiYuan 等 Electron 应用。
2. `npm run dev` 里 `vite-plugin-electron` 会**自动拉起 Electron 并带 `--remote-debugging-port`**（`vite.config.ts` 的 onstart 已内置，读 `LAKE_CDP_PORT`，默认 9222）。所以直接 `LAKE_CDP_PORT=9222 npm run dev` 即可拿到 CDP，**不需要改 vite.config.ts**。
3. dev 与打包版 userData 隔离：dev=**`~/Library/Application Support/lake-notes-dev`**（可重建/测试），打包版=`lake-notes-electron`（正式数据，**禁止触碰**）。任意模式可用 `LAKE_USER_DATA` 覆盖。
4. **kill 掉 `npm run dev` 的 wrapper job 后，vite/electron 子进程可能残留**（本轮多次遇到 1421/9222 端口被占）。清理用 `lsof -iTCP:1421 -sTCP:LISTEN` / `9222` 找 PID 再 kill。
5. dev 主进程改动需重启 Electron；renderer 改动走 HMR（但**不会重建已建编辑器实例**，测编辑器相关改动必须 Cmd+R 或重启）。

### CDP 驱动桌面端
6. 用 Node 原生 `WebSocket` 连 `ws://127.0.0.1:9222/devtools/page/<id>` 发 `Runtime.evaluate`（`returnByValue:true, awaitPromise:true`）即可在渲染层求值。配合 `Page.reload` / `Page.addScriptToEvaluateOnNewDocument` 可观察首帧渲染（本轮的动画/闪现观测就是这么做的）。
7. `window.__desktopEditor` 是当前激活 tab 的编辑器实例；`window.lakeNative` 是桌面 debug 契约（含 uploadResource/readNote 等）。`lakeBridge(ed).renderer.execCommand(...)` 走 Lake 命令。
8. **CDP 注入脚本会把 `\/` 在 heredoc 里丢掉**：写 verify 脚本时避免含 `\/` 的 regex，或用 `String.split` 计数代替。
9. `npx tsx` 里 import 相对路径要相对**脚本所在目录**（放项目根再 import `./src/...`）。

### 附件 / 媒体卡
10. **附件卡 hover 阴影**是 Lake 的 `.ne-viewer ... file:hover .ne-card-file { background: var(--lakex-editor-card-background-hover) }`。覆盖 Lake 样式必须用**高特异性 + `!important`**，且要覆盖编辑器+查看器两种模式。
11. `fileCard.ts` 的 `scanFileCards` 的 `raw` 只含**开始标签**，不含 `</card>`；若用 `replace(raw, replacement)` 会留下重复闭合标签导致结构错乱。**替换要匹配整个卡元素**（`<card ...></card>` 或自闭合）。
12. `encodeCardValue` 会 URI 编码 value（`data:` 前缀 + encodeURIComponent(JSON)），断言/检查内容时需 decode。

### 原则（核心）
13. **原则 10：永远不要为旧数据写冗余代码**。开发版数据可删可重建，不写兼容/迁移/清扫逻辑。判断标准：先问"这些数据能不能删了重新生成？"——能，就绝不写。本轮"媒体文件卡→原生卡"的内容清扫正是违反此原则，已撤销。
14. 本地是真相，S3 是镜像；不要用正文引用数算待上传资源数；不要重新引入 blob 注入方案。

---

## 9. 验证命令 / 质量门槛

```bash
cd /Users/admin/file/local-lake/lake-notes-electron
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

npm test -- --run            # 本轮基线 718 passed, 1 skipped
npx tsc --noEmit
npx vite build
npx vite build --config vite.mobile.config.ts
git diff --check
```

桌面端启动 + CDP 观察：
```bash
LAKE_CDP_PORT=9222 npm run dev   # vite @127.0.0.1:1421 + electron --remote-debugging-port=9222
# 结束后：lsof -iTCP:1421/9222 找 PID kill；不要 pkill -f Electron
```

---

## 10. 关键文件索引

| 文件 | 作用 |
| --- | --- |
| `src/core/noteSaveDecision.ts` | 桌面/移动端共享保存幂等决策（此前 GPT） |
| `src/core/editorChangeGuard.ts` | 共享编辑器 change 守卫（此前 GPT） |
| `electron/noteContentRepository.ts` | 桌面正文保存、缓存边界（此前 GPT） |
| `electron/store.ts` | 桌面包含同步摘要——本轮修了 `getSyncPendingSummary()` 目录计数口径 |
| `src/core/syncEngine.ts` | 桌面/移动端共享 manifest 同步引擎 |
| `src/features/attachment/attachmentPreviewController.ts` | 附件预览控制器——本轮加了 hover 离开清理 + 媒体点开内嵌 |
| `src/features/editor/EditorTab.tsx` | 桌面 tab 编辑器——本轮改了媒体判定（item.kind） |
| `src/features/editor/LakeEditor.tsx` | 移动端/共享编辑器——本轮改了媒体判定（item.kind） |
| `src/features/editor/lakeRuntime.ts` | Lake 运行时/音频卡兜底——本轮缩短重试 + preload |
| `src/mobile/editor/EditorDock.tsx` | 移动端编辑 dock——本轮加音频/视频按钮 |
| `src/mobile/document/DocumentPage.tsx` | 移动端文档页——本轮接入音频/视频插入 |
| `src/styles.css` | 应用全局样式——本轮加附件卡去阴影覆盖 |
| `src/mobile/bridge.ts` | 移动端 DB/同步/资源/图标能力 |
| `electron/assetServer.ts` | 桌面本地资源 HTTP 服务 |

---

## 11. 后续会话补充（2026-08-27 晚：附件分发 + 笔记本普通化）

> 同一分支 `perf/mobile-startup-batch1` 继续。新增两块改动 + 一轮审计，质量门槛 **738 passed, 1 skipped（739 total）**（tsc / 桌面+移动 build / diff 全绿）。

### 11.1 附件 → 音视频/图片卡自动分发（已在 §4.4 基础上完成）

- 用户需求：附件插入的音频/视频/图片文件自动转为**原生对应卡片**（编辑器内嵌播放/显示），不再落成文件卡 + 点击预览。
- 机制（CDP 实测）：Lake `insertFiles` 命令把第三参数原样透传 `readData`；fileReader 按 `{ category: "audio"|"video"|"image", from: "ui" }` 分发到对应 reader → 原生卡。附件路径原本 `category:"file"` → 文件卡。
- 实现：
  - `src/features/editor/mediaCardRouting.ts`（新）：`installMediaCardCategoryRouter`——`beforeExecCommand` 拦截 `insertFiles`/`dropFile`，按扩展名改写 args 加 category；单一批直接改写（单次事务），混合批原命令 no-op + 异步按原顺序分批（顺序保持）。EditorTab/LakeEditor 接入。
  - `src/core/assetNaming.ts`：`mediaKindOfFilename` 三态（audio/video/image）+ 常量 `AUDIO_EXTENSIONS`/`VIDEO_EXTENSIONS`/`ASSET_IMAGE_EXTS`（已导出，移动端复用）。**清单 = Lake fileReader 实测接受集**（CDP 逐格式验证）：audio=mp3/wav/m4a/flac；video=mp4/mov/mkv/avi/webm/m4v/wmv/flv/mpeg/mpg/3gp/ts；image=png/jpg/jpeg/gif/webp/bmp/svg/tiff/tif。**aac/ogg/wma/avif/apng/jfif 等 Lake 任何路径都建不出卡，不列入**（保持附件路径原生行为；aac/ogg 附件点击仍走 fileKindOf 内嵌预览，两者语义分离正确）。
  - 移动端 `DocumentPage.tsx`：文件选择后显式传 category（双保险）。
- 参考思源 `SIYUAN_ASSETS_*`（app/src/constants.ts）核对过格式清单。

### 11.2 种子笔记本普通化：系统里没有"默认/不可删除"的笔记本

- 用户决策：不存在"默认笔记本"概念；**所有笔记本（含首启种子"个人笔记"）都是普通笔记本**——可删（移入回收站）、可改名、可 purge、删后不复活。唯一机制例外：**回收站容器**（`notebook-trash`，"有笔记本行为的系统容器"，非普通笔记本，保持不可删）。
- 实现：
  - `electron/store.ts`：`deleteTreeNode` 只保护回收站容器；种子 `seed_initialized` 标记（全新库首启种一次，删/purge 后不复活）；`resolveParentNotebook()` 兜底（无父新建/恢复/同步导入）——任意存在的笔记本（sortOrder 最小，排除回收站容器）→ 无则自动创建普通笔记本"未分类"（随机 ID + 图标 X）；`createNote`/`createNoteIn`/`restoreTrashItem`/`defaultNotebookId` 全部改走兜底。
  - `electron/noteMetadataRepository.ts`：删除死代码 `defaultNotebookId`（兜底逻辑由 Store 承担）。
  - `src/core/syncEngine.ts`：接口语义对齐（`defaultNotebookId` = 兜底父笔记本）。
  - `src/mobile/bridge.ts`：种子标记防复活；`defaultNotebookId` 无笔记本时自动建"未分类"；`createNote` 兜底；**新增 `trashTreeItem(id, kind)` API**（软删笔记本/分组/笔记，整棵子树级联进回收站、trashed_at 同步传播）——**仅 API，移动端 UI 未接入删除笔记本入口（用户未定是否做移动端删除 UI）**。
  - `src/mobile/MobileApp.tsx`：去掉硬编码 `notebook-personal`。
- 踩坑：根层笔记本 `parent_id` 为 NULL，`parent_id != ?` 对 NULL 恒不成立（SQL 三值逻辑）+ 回收站容器本身也是根层 notebook——兜底查询必须 `id != trash AND (parent_id IS NULL OR parent_id != trash)`。
- 测试：store 4 个（删种子不抛错/不复活/自动建未分类/兜底优先已有）、syncEngine D4b（回退 defaultNotebookId 返回值而非固定 ID）、移动端 trashTreeItem 2 个。

### 11.3 审计遗留（未做，用户选择暂缓）

1. **移动端删除笔记本 UI 未接入**（API 已备，`trashTreeItem`）。
2. **UI 端到端实测**：**移动端附件分发已真机验证（2026-08-28，设备 50950385）**——附件路径插 mp3→audio 卡、mp4→video 卡、png→image 卡、pdf→file 卡；显式 category 路径（DocumentPage 按钮）同样生效；真实 mp3（3.4MB）插入后播放器 readyState=4 / err=null / duration=448s，AssetServer MIME（audio/mpeg）正确；router 已装（LakeEditor beforeExecCommand）。桌面端 dev 环境仍会因 HMR full reload 弄挂 electron（vite-plugin-electron 的 electron 与 wrapper 生命周期绑定，kill electron 会让 npm run dev 退出）；重启方式：整包 `LAKE_CDP_PORT=9222 npm run dev` 一个 job 管理，不要单独 kill electron。桌面 UI 链路（种子删除/自动建"未分类"）仍只经单元测试，未做桌面 CDP 实测。
---

## 12. 后续会话补充 2（2026-08-28：小记图片彻底纯文件化，去 BLOB）

> 用户决策：小记图片与文档完全一致——**纯文件存储 + AssetServer 服务 + buildAssetFilename 唯一名，彻底放弃 BLOB**（小记单独用 BLOB 没意义）。移动端真机验证（设备 50950385，CDP）通过，质量门槛 **742 passed, 1 skipped（743 total）**（tsc / 桌面+移动 build / diff 全绿）。

### 12.1 改动（移动端为主）

- `src/mobile/bridge.ts`：`saveQuickNoteWithImages` 图片**纯文件落盘**（`note-assets/quick-notes/{id}/{唯一名}`，AssetServer 服务）+ 不写 BLOB；`getQuickNoteImage` 读文件；`purgeQuickNote` 删文件（先读 content 再删行）。
- `src/mobile/quickNotesDbPort.ts`：同步端口去 BLOB——`readAsset` 读文件（内存层优先 + 文件兜底，端口支持 Promise）、`applyRemoteQuickNote`/`applyTombstoneAssets` 写文件（内存层 + fire-and-forget 落盘）、`archiveLocalQuickNoteToTrash` 图片文件随归档迁移。注入 `QuickNotesAssetFsDeps`（bridge 传 Capacitor 实现，测试传内存实现）。
- `src/mobile/assetFs.ts`：新增 `removeAssetBytesFs`。
- `src/mobile/MobileApp.tsx`：lakeNative 调试契约补暴露 `saveQuickNoteWithImages`/`getQuickNoteImage`（与桌面调试契约对齐）。
- `src/core/quickNoteModel.ts`：新增纯函数 `buildQuickNoteImageFiles`（唯一名只生成一次——content JSON 引用与落盘文件名必须一致）。
- **桌面无需改**：小记 stage 本就生成唯一名（`{13ts}_{8hex}.{ext}`），AssetServer 已服务 quick-notes（含 staging）。
- **BLOB 表**：`quick_note_assets` 保留仅兼容历史库（注释标注废弃），新代码零写入；历史 BLOB 由 `migrateAssetsToFilesystem` 一次性落盘迁移。

### 12.2 真机验证（50950385，CDP）

- 带图小记保存 → 唯一名文件落盘（同名不覆盖），content 引用与文件一致；
- **同步上传成功**（小记 ↑1，不再报图片缺失）——readAsset 文件路径工作；
- AssetServer 服务 `quick-notes/{id}/{file}` → 200 + 正确 MIME；
- 单元测试：quickNotesDbPort 8/8、quickNoteModel 新增 4 个（防 double-name 回归）、全量 742 passed。

### 12.3 踩坑（务必记住）

1. **`buildAssetFilename` 非幂等**（每次调用生成新随机名）：content JSON 与落盘文件名必须**只生成一次并共用**，否则同步 readAsset 找不到文件（真机踩过，已抽 `buildQuickNoteImageFiles` 防回归）。
2. **同步端口是同步接口**，Capacitor Filesystem 是异步：移动端用「内存 `assets` Map 作同步层 + fire-and-forget 落盘 + 读时文件兜底」——与 Lake 文档资源 `saveAsset`/`readLocalAsset` 的既有模式完全一致（不要另造轮子）。
3. **小记图片文件落在 `note-assets/quick-notes/{id}/`**（assetFs ROOT 硬编码 note-assets，key 首段当 noteId）——移动端 AssetServer（root=note-assets）因此天然服务 quick-notes 前缀，无需改 Java。
4. **不做旧文件清理**：与文档一致（每次上传生成唯一新文件，旧文件由 GC/孤儿清理回收；冗余是设计理念）。曾加过"全量替换清理"（saveQuickNoteWithImages 与 applyRemoteQuickNote 各一处），后者还是死代码（tx 后读 oldRow 已是新 content，永不触发）——已删除。
### 12.4 清空数据 + BLOB 兼容残留清理（2026-08-28 续）

> 用户决策：开发版**直接清空所有数据**（`adb shell pm clear` 设备数据），不保留任何旧数据兼容逻辑；并排查"为旧数据写兼容"的类似残留，全部清理。

- **已删（移动端）**：
  - bridge.ts `migrateAssetsToFilesystem` 整个函数（IndexedDB 旧资产迁移 + quick_note_assets BLOB 迁移）+ init 调用；
  - quickNotesDbPort.ts `quick_note_assets` 表 CREATE + 孤儿清理（schema 不再建表）；
  - persistence.ts 旧 IndexedDB 资产函数（saveAssetBytes/loadAssetBytes/listAssetKeys/removeAssetBytes，`asset:` 前缀存储）；
  - cachePort.ts legacyMigration 分类（IndexedDB 旧资产迁移残留清理）；
  - SettingsDrawer.tsx legacyMigration 显示文案；QuickNotesTrashPage/QuickNoteComposer 过时 BLOB 注释；
  - 测试：bridgeStartup/bridgePurge/bridgeTree 的 persistence mock 死引用、quickNotesDbPort.test 的 BLOB 表断言改文件断言、bridgeStartup 的"init 加载资产"断言更新（init 现在完全不做资产预加载/迁移）。
- **保留（非旧数据兼容，是必要机制）**：桌面 `quick_note_assets` 表（**元数据表**，无 bytes BLOB 列，图片索引/级联用）、schema ALTER（store.ts/quickNotes.ts 的 migrate——列迁移）、S3 secret 兼容（安全）、store.ts 首启 tree_nodes 迁移（seed_initialized 内，新库幂等）。
- 验证：设备清空后（pm clear）空库首启正常（种子笔记本 + init 不崩 + 无 BLOB 表依赖）、带图小记保存/落盘正常。质量门槛 **742 passed, 1 skipped（743 total）**（tsc / 双端 build / diff 全绿）。- **桌面端排查结论（2026-08-28）**：无类似 BLOB 的旧数据存储兼容残留。确认以下均为**必要机制**（非"为旧数据写兼容"）：schema 初始化/列迁移（store.ts/quickNotes.ts migrate——纯 CREATE/ALTER，无旧数据判断）、崩溃恢复（recoverStagedSaves/recoverImports/recoverConversions、conversion journal）、同步协议容错（对象缺失跳过 B 方案、墓碑占位符——按原则 5 不判断占位符形态、10 份 manifest 容错）、恢复/删除语义（隐式恢复留档、restore_pending_at 清理）、外部适配（七牛 S3 兼容、Electron 旧式 console-message 回调 main.ts:268、lakeRuntime editor.theme 兼容层）、CSS 渐进迁移注释。另清理了共享接口 `CacheSummary.legacyMigrationBytes` 字段（移动端 legacyMigration 分类删除后恒 0 的残留字段，ports.ts + cachePort + ports.test 同步删）。质量门槛 742 passed / tsc / diff 全绿。
