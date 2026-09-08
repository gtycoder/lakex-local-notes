# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（长期红线/机制/坑，每次自动加载）→ 相关 `docs/`。
> 历史所有 dated handoff 已合并进本文件（内容在 git 历史可查）。本文件只保留**当前状态 + 真正的待办 + 有价值的坑**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 当前基线（新会话开工前）
- 分支/远端：开发主干 `master` ↔ Gitee `origin`（`git@gitee.com:gtycoder/local-lake.git`，SSH 可用；`master` 亦是远程默认分支）。**本文不写死 commit hash**——查 `git log -1 --oneline`。
- 质量门槛：`tsc` 0 error · vitest **831 passed / 15 skipped** · 桌面 `vite build` + 移动 `vite build -c vite.mobile.config.ts` 全绿（计数变动见 §2；别把数字写回 AGENTS/README）。
- 本地业务分支只有 `master`（其余已合并/删除；`origin/main` 是旧 Tauri 遗留）。`git worktree list` 目前只有主目录（历史上的 `lake-notes-wt-android` 已消失，见 §3 移动端条）。
- **开工先跑 `git status` + `git worktree list`**：工作区里有**移动端会话的在途未提交改动**（`src/mobile/**`、`vite.mobile.config.ts`、`scripts/{emu-up,emu-cdp,fetch-sys-image,mobile-preview}.sh`）+ 早前会话留下的 `src/features/outline/outline.css`（focus-visible 微调）。**别把它们卷进你的提交**（用显式路径 `git add`）。
- dev 实例状态：本会话结束时 `npm run dev` 仍在跑（vite `:1421` / Electron CDP `:9222` / 资源服务 `:19876`）。新会话可直接 CDP 接管（§6），不需要就 `kill <具体PID>`。
- **dev 数据现状（重要）**：
  - `welcome-note`（幽灵文档）已一次性清理：墓碑 `deleted_notes(welcome-note, note, purged_at=now, published_at=NULL)` 已写、行与文件已删 ⇒ **下次同步会发布 `deleted:true` 并删云端 `objects/welcome-note-*`、`assets/welcome-note/` 前缀**，之后不会复活。
  - `到啦领导`（ee860a19）仍在回收站里（`trashed_at=09-04 10:34`，原父=测试本2222，正文含用户 18:06 的编辑「测试老师啦啦队」）；**用户尚未决定是否恢复**，别擅自删。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 43 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交）。移动端另有铁律见 **§8.0**。

## 2. 本轮已完成（260904，全部已合入 master）
### 2.1 桌面 UI 整体「精仿思源」（用户：设置-资源丑出天际 → 决定精仿思源）
- **可行性关键**：思源的组件 SCSS **早就 vendored** 在 `src/b3/siyuan/{util,component}` 并由 `main.tsx` 加载（`.b3-list-item`/`.b3-label`/`.b3-text-field`/`.b3-select`/`.b3-switch`/`.b3-button--outline` 全是活的）。丑的原因是设置面板/弹窗**没用它们**，自研了一套 `settings-*` + 大量内联样式。本轮是**接线**，不是新造。
- 新增 `src/b3/siyuan/business/_config.scss`（署名移植版式骨架：`config-group/title/items/item/name/block/readonly/stats/assets/empty`）；`siyuan.scss` 补挂 `util/function`（`fn__space/fn__size200/ft__error/fn__kbd` 此前根本没加载 = 死类名）。
- `SettingsPanel` 全量重写为 `Group/Item/Block/Switch/Seg/NumField/TextField/Shortcut` 原语；数字框不再拉成整行；GC 删除记录/待回收明细/日志改 `.config-readonly` 等宽框；体检结果 `.checks` 分行配色。
- 设置-资源 → 思源资源页语言（分组清单 + 状态徽章 + 单行省略 + **hover 才出现的图标操作** + 清单在上、大图预览在下）。
- HistoryPanel：孤儿文件 tab 改「左 320px 列表 + 右内嵌预览」，**删掉孤儿预览模态框**；TrashPanel：行改 `.b3-list-item` 两行密度 + hover 图标 + `.badge`。
- 搜索面板 / 同步状态 popover / 小记工作台一并收进同一套（小记原有**三层 hex 覆盖块**合并成一段令牌派生块，紫色身份改由 `--shell-hue` 派生）。
- 横向 tab 最终用**底部指示线**（轨道 hairline + 选中主色字 + 2px 下划线）：只给选中项灰底"看不出是两个 tab"，分段控件的阴影浮起又与全局克制风格冲突（用户两次反馈后定稿）。
- 删除全部失效旧层（`settings-group/row/choice/toggle/field/hint/body`、`shortcut-*`、`trash-item*`、`history-item*`、`trash-tabs/history-tabs/history-create/history-clean-all`、`quick-notes-trash-*`、`search-result*`、`b3/components.css` 里与 overlays 打架的重复规则）。
- 长期约束已写进 `AGENTS.md §3 #14`（版式语法 + 禁内联样式 + 设置行必须同步搜索注册表）。

### 2.2 设置页条目级搜索（对齐思源"每条设置都可搜到并定位"）
`settingsSearch.ts` 新增 `SETTING_ITEMS`（55 条：id + 分类 + 标题 + 同义词）与 `searchSettingItems`（多词=每词都命中）；行原语接 `itemId` → `data-set-id`；导航出「条目 · N 项」，点击/回车 → 切分类 + 滚动 + `.is-hit` 闪 1.5s，命中行留 `.is-match` 指示条。**故意不隐藏非命中项**（会被误读成设置被删）。反漂移单测比对源码 `itemId` 集合与注册表。

### 2.3 关于页重做（从两段文字 → 可核对的元信息面板）
新增只读 IPC `electron/ipc/registerSystemInfo.ts`：`get_system_info`（版本 / Electron·Chromium·Node / **pin 的依赖版本表** / 路径 / 存储概览 / 小记数）+ `reveal_data_folder(kind)`（**白名单枚举**，路径由主进程拼，未知 kind 抛 `IpcInputError`）。`store.getStorageOverview()` 只读概览。关于页五组：关于 / 版本与运行环境 / 数据与存储（四条路径 + 在 Finder 中显示）/ 诊断（**复制诊断信息**到剪贴板）/ 第三方与许可。明确**不做**：检查更新、危险操作集中区。

### 2.4 同步复活漏洞（用户报：资源页出现本地/回收站都没有的文档，资源既不能看也不能删）
- 证据链：`deleted_notes.notebook-personal`（folder 墓碑，`purged_at` 已被清空）+ `tree_nodes.welcome-note.created_at` **晚于 purge 88 秒** ⇒ purge 后被陈旧清单重新导入到**已不存在的父**下 → UI 不可见却仍在同步与占资源。
- **洞 1**：`isFolderPurged()` 看 `purged_at IS NOT NULL`，而 `markPurgeSynced()` 在前缀删除成功后会清空它 ⇒ 保护只活到下一次同步。改为**永久判定**（存在 `node_type='folder'` 墓碑）。
- **洞 2**：`purgeTrashItem` 里 `if (meta) tombstone.run(...)` —— `notes` 行缺失时跳过写墓碑 ⇒ 云端永不下架 ⇒ 必然复活。改为无条件写（元数据从 `tree_nodes` 兜底）。
- **诊断补位**：`runDataHealthCheck` 新增 `treeChecked` / `treeDanglingParent`；哈希比对限定只比 `sync_state='synced'`（原来本地未上传编辑天天误报"可能被外部改动"）。脏数据已一次性清理（见 §0）。

### 2.5 回收站里的文档竟然可编辑可保存（用户报，严重）
- 数据结论：**文档没坏也没复活**（`trashed_at` 未被清、无 `restore_pending_at`，编辑写进了回收站文档，可恢复）。"目录栏找不到"是正确行为，错在**毫无提示**。
- 三个洞：① 启动恢复按 `last_opened_note_id` 重开文档时**不校验回收站/purge**；② `tab.deleted` + 保存拦截**只在同步刷新路径设置**；③ `openNote` 复用标签分支**无条件 `deleted:false`** 会解开标记，且丢弃保存**静默 return**。
- 修法：新增 core 纯函数 `isGoneNote({parentId,syncState})`（打开与同步共用）；`openNote` 两条路径都判定；`tab.deleted` → 复用 `EditorTab.locked` 走 **viewer 只读** + 顶部横幅〔打开回收站〕；`onBlockedSave` 明确提示。恢复路径 `handleTrashRestored` 本就存在，无回归。红线写进 `AGENTS.md §3 #16`。

### 2.6 预览"初次切换闪一下"（实测定位，非猜测）
逐帧采样证实：切换时 `setPv(null)` 让预览区塌成一行「加载中…」文本（412→220→412，**192px 跳动**），冷读盘 ~48ms 正好被看见。修法：① 切换**保留旧图**，新图 `img.decode()` 后才替换；② 固定高度舞台 `.config-assets__stage{height:300}` + 说明行 `min-height:17`；③ 换图 `key` 重挂载 + `ln-preview-fade-in` 淡入。设置-资源与历史弹窗孤儿文件同治。修后实测高度全程恒定（352 / 474，0 跳变）。

### 2.7 上一轮（260903）摘要
里程碑 M1a–M6 全量落地（冲突收口、归档 30 天保护、回收站倒计时、数据体检、日志查看器、整库备份 A1 / 云端恢复 A2、审美 tokens）+ 两个 bug（凭空「未分类」、小记删不掉）+ S3 同步差集化性能（churn 18.4s→<1s、首传 240 图 HEAD→0、manifest 链 8→3）。细节见 `docs/MILESTONES-SYNC-UX-2026-09-03.md` 与 git 历史；不变量在 `AGENTS.md §3 #11~13`。

## 3. 真正的待办（已剔除全部完成项，按优先级）
> **260904 后续评估（用户决策 + 本轮核实）**：原 §3.1 对象级 5xx 重试、§3.2 快照 gzip 异步化、§3.5 笔记本 `sort_order` 撞号 —— **已评估不做**（5xx 有"失败不 markSynced→下轮重扫"兜底；gzip 异步收益小；sort_order 撞号场景极低）。
> 原 §3.3（FTS 全量重建→增量）与 §3.4（1/2 字短词回退）**合并为一条**：计划**整体重做索引**，两件一起落地（同属 `src/core/searchRepository.ts` 的索引/搜索路径，同时覆盖 10 万文档量级）。
> 原 §3.6（其余浮层统一）**基本已完成**：顶栏菜单/右键菜单/标签切换器已进 b3 令牌（`src/b3/components.css` + `src/b3/layout.css`）；仅**草稿恢复框**（`draft-recovery-*`，`overlays.css` 自定义类 + `--lake-*` 令牌）未收进 b3 套，属可选小收尾。

**性能/健壮性**
1. **FTS 索引重做**（合并原 P4-1 增量 + P4-2 短词回退）：`src/core/searchRepository.ts` 的 `rebuild()` 现每次启动 `DELETE FROM notes_fts` 全清 + 逐条重插、trigram 只索引 ≥3 字；改为增量账本（`updated_at`/旁表记账，只重建缺失/过期）+ 1/2 字短词回退（标题+正文 LIKE）。可动 FTS schema（dev 可删重建），**按 10 万文档/100 万附件量级验证**。← 近期待办。
2. 其余浮层收尾（可选，成本低）：仅**草稿恢复框**未进 b3 套；如统一照 §2.1 路子 + 同步 `settingsSearch.ts` 注册表即可。

**移动端（安卓）** —— 全部见 **§8.6/§8.7**（剪贴板粘贴不解析、真机资产 canonical URL 不可达、"整体编辑还有问题"待现象、大纲 viewer 跳转）。注意 §8.6 提到的 android worktree **已不存在**，那条"沿 worktree 验证"的线索要重新确认落点。

**产品/技术债（长期；评估后多属低/缓）**
3. W-8 ACAO / W-10 dompurify（并入"lake 资源导入统一优化"，**安全相关，建议优先**）；依赖维护：`@types/better-sqlite3` 可单升。
4. 大纲 **viewer（只读）点击标题不跳转**（用户计划重做大纲时一并处理，低优先）。
5. **回收站首拉成本**（批量删除后接收端首拉仍下全文+资产）——惰性下载方案**暂缓**（要动恢复红线，低优先）。
6. Store 分批重构（`docs/REFACTOR-PLAN-2026-08-17.md`，按领域、严禁一次改事务边界；移动端复用专项；无测试护栏前不动）。
7. Word/PDF 导出（`electron/export.ts` 已预留 docx/pdf）；附件大文件 S3 分片/断点续传（**nice-to-have，未被需求驱动**）。
8. **Lake 内核策略**（属政策，非任务，记录即可）：A lakejs 开源源码当"机制字典"；B 版本锚点 + hack 清单（vendor lakex 已 pin，勿随意升级）；按需最小 patch，**不整体 fork**。
9. **lakex 契约固化（编辑器可观测性，低成本待落地）**：新增 `src/features/editor/lakex-contract.d.ts`（完整设计见 `docs/LAKEX-CONTRACT.md` §4，速查表 §5），替换 lakeRuntime 等处的 `as any`、收敛反编译结论；纯类型改动 + 门禁全绿，**不碰 vendor**。

**非代码**：安卓同步偶发 `UnknownHostException` = 设备网络（联网重试）。

## 4. 踩过的坑（合并版；通用红线/环境见 AGENTS.md）
### 同步 / 数据语义（最危险的一类）
- **`purged_at` 不是"已彻底删除"的永久标记**：`markPurgeSynced()` 在前缀删除成功后清空它（防重复删）。任何"别让它复活"的判定必须看**永久墓碑**（folder 看 `deleted_notes.node_type='folder'`）。
- **purge 的墓碑必须无条件写**：`notes` 行缺失时跳过 = 云端永不下架 = 之后必然复活成"父不存在的不可见文档"（本轮实数据踩到）。
- **不要给"资产存在性"做本机持久缓存**（GC 会真删对象 → 缓存失真 → 破坏跨端自愈）；用"刚下载的远端清单"做差集（AGENTS #11）。
- **`contentHash` 会骗人**：`syncAdapters.localHashOf` 对 synced 笔记返回 `store.baseHash`（不读 `.lake`）；判"本地可复用"必须**实读正文 + sha256**。
- **清单声明⇒存在**：上传走差集但 `manifest.assets` 仍**全量声明**（裁剪声明 → 他端 GC 误删在用资产）；禁逐对象 HEAD。
- **兜底「未分类」只惰性创建**：下载阶段无条件 `defaultNotebookId()` 会凭空建"未分类"并上传扩散；`effectiveParent()` 也只能在"真应用"处解析。
- **S3 并发峰值 ≤8**（七牛建议）：`NOTE(2)×ASSET(4)`；曾 16 偏高、无必要。
- **软删 = 移动到回收站笔记本**（`parentId=TRASH + trashedAt`），`deleted:true` 只用于 purge 墓碑。混用 = B1 级致命 bug。
- **守卫不能只挂在一条路径上**：`tab.deleted` 此前只在同步刷新里设置，启动恢复/点击打开都不判定 ⇒ 同一文档"同步过就只读、没同步就能编辑"。这类判定必须收敛成一个纯函数（现 `isGoneNote`）在所有入口调用。
- **静默丢弃用户输入是最坏的失败模式**：`if (deleted) return;` 不打提示 → 用户以为已保存。拦截必须同时给可见反馈 + 出口。
- **文档漂移**：易过期事实（分支/hash/计数/当前焦点）**只写 HANDOFF §0**，别写回 AGENTS/README。
- **`git worktree list` 要纳入开工检查**（历史上漏看过一次 android WIP）。

### 渲染 / CSS
- **浮层 flex 列的固定区必须 `flex: 0 0 auto`**：`header/页签/提示条/错误条` 默认 `0 1 auto`，内容一多就被压扁，溢出文字被**后绘制的列表**盖住（就是"回收站左侧列盖住顶部提示"）。复现：CDP 把面板压到 200px 高，比对 `Range` 文字底边与列表 `top`。
- **预览/图片切换不要清空旧内容**：`setState(null)` + 文本占位 = 塌陷再撑开 = "闪一下"。正解：保留旧图 + 新图 `img.decode()` 后替换 + 容器固定高度。
- **居中缩放容器别用 grid 的隐式 auto 行**：`display:grid; height:300px; overflow:hidden` 里图片按原始尺寸撑高行 → `max-height:100%` 失效、图被裁切。要 `display:flex; align-items:center; justify-content:center`。
- **同一元素被多层 CSS 覆盖会互相打架**（styles.css → b3/components.css → overlays.css）。改 UI 前先 `grep` 类名看有几处定义；跨层加 modifier 时写进**同一层**（`.badge` 会赢过 styles.css 里的 `.quick-notes-count`）。
- **vendored `text-clamp` 混入不等于省略号**：`.b3-list-item__text` 只有 `overflow:hidden`，长文件名会把 `__meta/__action` 挤出列宽，需自己补 `min-width:0 + text-overflow:ellipsis + white-space:nowrap`。
- **lucide 图标把 `className` 直接给 `<svg>`**：`el.className` 是 `SVGAnimatedString`（`.replace` 会炸），且 `.b3-list-item__graphic svg{}` 匹配不到 → 包一层 `<span className="b3-list-item__graphic">`。
- **密集列表行不要做 `:active scale()`**：28~40px 的行按压缩放会抖字、与滚动条抢空间（思源只给 hover 底色）。

### 工程 / 环境
- **hooks 必须在早退之前**：`SettingsPanel` 的 `if (!open) return null;` 之后全是普通函数，把 `useState/useEffect` 插进去 → "Rendered more hooks…" → **整个 React 树卸载**（`#root` 变空，长得像 GPU 崩溃）。
- **改 `electron/*.ts` 或 `src/core/*`（含 `syncDecisions.ts` 这类被主进程 import 的共享模块）→ vite-plugin-electron 重启 Electron → 命中未带 `--use-angle=metal` 的 GPU `exit_code=15`，整个 dev 实例被带走**。fresh `npm run dev` 一般不崩、**热重载才崩**。改完别再动主进程文件，或直接重启一次。
- **窗口被关掉 ≠ 进程退出**：`/json` 返回空数组但 Electron 还活着时，`open -a <Electron.app>` 触发 `activate` 会重建窗口。
- **`nohup` 起的 vite/vitest 会随 exec 会话回收而死**：dev server 必须 **tty=true 长驻**；测试直接前台跑（vitest 全量 ~3s）。
- **量 DOM 逐帧变化前必须解除后台节流**：窗口不可见时 rAF 一帧不跑、`setInterval(10ms)` 被节流成 ~1000ms（第一版数据因此全错）。解法：CDP `Emulation.setFocusEmulationEnabled{enabled:true}` + `Page.setWebLifecycleState{state:'active'}`，并用"10ms 定时器 1 秒跑了几次"自检。
- **别用跨进程往返做时序观测**：点击和采样要放在页面内**同一个 async 表达式**里，否则错过 <100ms 的中间态。
- **CSS `:nth-of-type` 数的是同类型兄弟**（含分组标题 div），不是"第 N 个列表行"；脚本里用 `rows[i].click()` 显式取索引。
- **`Page.reload` 之后 CDP `Input.dispatchMouseEvent` 可能点不动**（窗口非激活），`element.click()` 仍可靠；要测真实 hover/拖拽/剪贴板才用鼠标事件。
- **CDP 裸驱无需第三方库**：Node **v24 有内置 global `WebSocket`**（别用系统 node 18，会 `WebSocket is not defined`）；页面 target 在 `http://127.0.0.1:9222/json`。
- 压测真实云用一次性前缀 `lake-stress-<ts>/`，**结束必 `deletePrefix` 清场 + 复核 0 残留**；凭证只走环境变量、绝不入库。合成 `Readable` 流式 PUT 在七牛会大面积超时 → 测脚手架用字节 PUT。
- `better-sqlite3` 是 **N-API**（Electron/vitest/node 都能加载）；命令行查库：拷 `.sqlite3`+`.sqlite3-wal` 到别处用 `/usr/bin/sqlite3 -readonly`（app 在跑时读快照）。
- S3 `[perf]` 日志行尾数字是 **epoch 时间戳不是耗时**（旧坑，head 已移除）。
- 七牛：`ObjectStore.test()` 必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404）；正确配置 Endpoint `https://s3.cn-north-1.qiniucs.com`、Region `cn-north-1`、Bucket `local-lake-hebei`、`forcePathStyle=false`。
- 同步完成必须广播 `sync-progress`；`markSynced` 要同时改 `notes` 与 `tree_nodes.sync_state`；IPC 三处同步（`main.ts` handle + `preload.cjs` + `src/lib/native.ts`，preload 暴露名是 **`lakeNative`**）；多表写必须 `db.transaction`。
- 结束 electron 只能 kill 具体 PID，**禁 `pkill -f Electron`**（机器上还有 SiYuan/VSCode/Trae）。

## 5. 下一步建议（新会话）
1. 先跑 §6 门禁确认基线；有问题先测再改。
2. 待办优先：**§3.2 快照 gzip 异步化**（小、独立）→ **§3.3 FTS 增量**（收益大）。
3. 移动端一律按 **§8**（§8.0 移动端/桌面硬隔离已解除——现桌面与移动可自由改；仅 `src/b3/**` 思源 vendored 组件等共享/合规件仍须谨慎）。
4. 任何同步/GC 改动**先读** `AGENTS.md §3 #11/#12/#13/#15/#16` + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`，改前想清"声明是否仍全、被引用对象会不会被 GC 删、跨端自愈是否成立、复活路径在哪"。
5. UI 改动先看 `AGENTS.md §3 #14`（思源版式语法），别再造第四套类名、别写内联样式。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
git diff --check                                                # 空白错误（注意会报出移动端会话的文件）
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
```
- **UI 实测姿势**：`curl http://127.0.0.1:9222/json` 拿 page target → Node 24 内置 `WebSocket` 直驱 `Runtime.evaluate` / `Page.captureScreenshot{clip}` / `Input.*`（本会话用这套量出了预览闪烁的逐帧数据）。详见 `docs/CODEX-GUIDE.md`。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8.1 / §8.9**。

## 7. 文档索引（`docs/` 按需查）
`AGENTS.md`（红线/机制/坑，必读）· `LAKEX-CONTRACT.md`（闭源 lakex 契约+速查表，编辑器相关先读）· `SYNC-PROTOCOL.md` · `S3-GC-DESIGN.md`（GC/保留链）· `TODO.md`（历史待办总表，§3 已摘要）· `PROGRESS.md` ·
`CODEX-GUIDE.md`（动手前必读：Playwright/CDP 驱动真实 Electron）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` ·
`ANDROID-TECH-SCHEME.md` / `MOBILE-TECH-STACK.md`（移动端）· `MILESTONES-SYNC-UX-2026-09-03.md` · `STRESS-260903.md` · 各 `*-AUDIT/*-REVIEW/*-DESIGN`。
> `docs/` 里若干 `*-HANDOFF`/`AUDIT`/`PERF` 是过程记录；权威待办以本文件 §3 为准，移动端以 §8 为准。

---

## 8. 移动端（安卓模拟器 + 编辑器）专职交接（260904）

> 本节是移动端（安卓模拟器 + 编辑器）交接：如何用**本机安卓模拟器**熟练验证移动端 UI/编辑，以及移动端编辑器任务的目标/已完成/遗留/坑。桌面 Electron 工作见 §0-§7。**注（260907）：原「只做移动端、别碰桌面」的硬隔离已解除**——那是早期多会话并行时规避提交冲突的历史约定，现在桌面与移动可自由改动（见 §8.0）。

### 8.0 移动端注意（原「移动端铁律」已降级为注意项，260907 用户明确解除硬隔离）
- **桌面与移动已可自由改动**（不再限定 `src/mobile/**`；当前无并行会话，不会有提交冲突）。仍请谨慎：`src/b3/**` 是**思源 vendored 组件（AGPL-3.0）**、`src/features/editor/lakeRuntime.ts` 等是**两端共享模块**，改动前先确认影响面；`electron/`、`src/main.tsx` 改动会触发 vite-plugin-electron 重启 Electron（见 §4 踩坑）。
- 移动端设置/浮层 UI 受 `AGENTS.md §3 #14` 约束：用思源 vendored b3 类，**禁内联样式**（`style={{...}}`）。
- **移动端数据在安卓模拟器 App 沙盒（`com.lakenotes.mobile`）里，不是 macOS 的 `lake-notes-dev`**。开发数据可 `adb shell pm clear com.lakenotes.mobile` 整体重建（`seed_initialized` 会重新种子"个人笔记"笔记本）。
- Node **24** 必须：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`（别用系统 node 18）。安卓相关 JAVA/SDK 环境**脚本里已内置，不用手动 export**。

### 8.1 安卓模拟器使用（本机 AVD `lake_mobile`，pixel_6 / API36 / arm64）
**一键脚本**（都在 `scripts/`，环境变量自备，直接跑）：
| 场景 | 命令 |
|---|---|
| 启动模拟器并等开机 | `bash scripts/emu-up.sh`（纯 CDP/远程会话用 `--no-window`） |
| 构建+同步+安装+启动 App | `bash scripts/android-build.sh --sync --install` |
| 把 App WebView 转发到本地 CDP | `bash scripts/emu-cdp.sh`（默认端口 9335） |
| 不起模拟器、浏览器里速测移动 UI | `bash scripts/mobile-preview.sh`（`http://127.0.0.1:1422/preview.html`，390×844 手机框） |

- AVD 名 `lake_mobile`；SDK 在 `/opt/homebrew/share/android-commandlinetools`；gradle 复用缓存 `~/.gradle/wrapper/dists/gradle-8.14.3-bin/.../gradle`（公司网络下不了 distribution，**别走 wrapper**，脚本已指好）。包名 `com.lakenotes.mobile`；`adb` 在 SDK `platform-tools`。
- `npm run dev`（桌面）与移动端无关；移动端构建= `vite build -c vite.mobile.config.ts` → `dist-mobile/`。

**CDP 自动化驱动（本会话验证过的可靠方式）**：
1. `bash scripts/emu-cdp.sh` → 本地 `tcp:9335`。
2. 程序：`const list = await fetch("http://127.0.0.1:9335/json/list").then(r=>r.json())`，取 `type==="page"` 的 `webSocketDebuggerUrl`。
3. 连 WebSocket，`Runtime.enable`，用 `Runtime.evaluate`（`returnByValue:true, awaitPromise:true`）执行任意 JS 驱动/断言。
4. **触摸（触发键盘/IME）**：`Input.dispatchTouchEvent {type:"touchStart",touchPoints:[{x,y}]}` → 延时 ~70ms → `{type:"touchEnd",touchPoints:[]}`，再对 contenteditable `.focus()`。
5. **打字**：`Input.insertText {text}`；**选中文本**：`document.createTreeWalker` 找文本节点 + `Range.setStart/setEnd` + `sel.removeAllRanges();sel.addRange(r)`。
6. `window.__mobileEditor` 暴露当前活跃文档的 Lake 编辑器实例，用于 `renderer.execCommand`/`queryCommandEnabled`（比查 DOM 可靠）。

### 8.2 Lake 编辑器命令名（移动端用 `renderer.execCommand`，命令名与桌面 toolbar 不同）
- **有效**（`queryCommandEnabled`=true）：`bold`、`unorderedList`（列表！）、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style`（块级，传 `"p"/"h1"/"h2"`）、`undo`/`redo`。
- **无效**（no-op/返回 false，别用）：`insertUnorderedList`、`formatBlock`、`heading`、`setHeading`、`insertBulletList`、`strike`/`strikethrough`、`justifyLeft/Center/Right`、`clearFormat`、`fontsize`。
- **命令生效前提**：需要真实 caret/选区在文本块里——`bold` 先选中文字；`style "h1"`/`unorderedList` 需 caret 在段落里。**命令名写错/焦点丢了 = 点了没反应，还会疑似"正在下载"。**
- 渲染 DOM（验证用这些选择器）：列表=`ne-uli-i`/`ne-uli-c`/`ne-tli`（**不是** `<ul>/<li>`）；加粗=`ne-text` 且 `font-weight:700`（**不是** `<strong>`）；标题=`ne-h1`/`ne-h2`。

### 8.3 编辑器 Dock 键盘/面板机制
- `src/mobile/useKeyboard.ts` 返回 `{ base, innerHeight, offset, height, keyboardOpen }`。`base`=键盘收起满高度（max innerHeight）；`innerHeight`=当前；`offset`=edge-to-edge 上移量（adjustResize=0）；`height`=键盘实际高；`keyboardOpen=height>8`。
  - 模拟器是 **adjustResize**（键盘弹 `innerHeight 842→530`，`offset=0`，`bottom:0` 元素天然在键盘上方）；真机可能 **edge-to-edge**（`offset>0` 需上移）。两模式都被覆盖。
- `src/mobile/editor/EditorDock.tsx`：`if(!editing) return null`。工具栏 8 钮：`[+]插入 [Aa]字体 [B]加粗 [列表]unorderedList [任务]taskList [...]字体 [键盘]切换 [√]完成`。
- **工具栏 `--kb-offset`（bottom 基准）**：面板开时 `usable = Math.max(0, innerHeight - base + panelHeight)`；无面板 `usable = offset`。作用：工具栏屏幕 Y 恒等于 `base - panelHeight`——键盘收起 `innerHeight 530→842` 全程**不跳**（本轮修的核心）。CSS：工具栏 `bottom:calc(var(--kb-offset)+4px)`；面板 `bottom:0; height:calc(var(--kb-offset))` 占键盘区。
- **焦点/键盘**：`onMouseDown={(e)=>e.preventDefault()}` 加在 `.med-toolbar`/`.med-panel` 上，**防按钮抢走编辑器焦点**（否则键盘关、caret/选区丢→命令 no-op）。`runInline`（工具栏）= 仅 `exec`；`runPanel`（面板项）= 仅 `exec`，**都不要调 `focusEditor`**。
- 面板开关：开=`setPanelHeight(max(round(height),280))` + `setTimeout(()=>blur(),0)`（提 IME、占住键盘区）；关=`setPanelMode(null);setPanelHeight(0); focusEditor()`（自动恢复键盘）；`收起键盘/显示键盘` 切换。

### 8.4 本轮任务目标（用户需求，260904）
1. 面板展开"闪烁" → 加 `medPanelIn` 淡入+上滑；工具栏去 `transition:bottom`（对变化视口有害）。
2. 加粗/无序列表不可用 + "正在下载" → 命令名错（`insertUnorderedList`→`unorderedList`）+ 按钮抢焦点；已修（干净文档 `ne-uli 0→1`、`ne-text font-weight:700`，键盘保持开）。
3. 面板"正文/标题"不可用 + "工具栏-面板-键盘"3 层堆叠 → 面板项用 `runPanel`（仅 exec、不重开键盘）+ blur 提 IME；已验证 `ne-h1 0→1`、键盘保持收起、3 层消除。
4. 追加：点工具栏一直跳、要稳定 + 展开具体工具 → `--kb-offset` 改 `innerHeight-base+panelHeight` + 删工具栏 `transition:bottom`；实测工具栏屏幕 Y 全程 478/526 恒定。

### 8.5 已完成（本轮，全在 `src/mobile/**`）
`src/mobile/useKeyboard.ts`（暴露 `base`/`innerHeight`）· `src/mobile/editor/EditorDock.tsx`（`unorderedList` 命令名、`runInline`/`runPanel` 拆分、`--kb-offset` 稳定公式、`onMouseDown preventDefault`、blur `setTimeout(0)`）· `src/mobile/editor/editor-dock.css`（面板 `medPanelIn`、删工具栏 `transition:bottom`）。
（早前会话）多 tab+左右抽屉、设置竖向菜单+子页、移动精仿思源样式、seed 数据、keep-alive 性能、settings 重构。
门禁：`tsc` 0 · `vite build -c vite.mobile.config.ts` 过 · `android-build.sh --sync --install` 过。

（260908 本会话）设置收口 + 完整端资源/历史：
- 移除 `showToolbar`/`showToc` 设置（AppSettings + 桌面/移动 UI + settingsSearch 全清）；`SettingItemEntry.platform` 标记桌面/移动专属；设置版式原语抽 `src/components/settingsPrimitives.tsx`（桌面/移动共用，对齐思源分层）。
- 移动端历史快照：`listNoteHistory`/`restoreHistory`（恢复前留档可反悔）/`deleteHistory` + **24h 去重** + `cleanupHistory`（>30 天过期 + 每文档 20 份上限，syncNow 后执行）；目录树长按「历史版本」sheet。
- 移动端资源管理：`orphan_assets` 表 + `detectOrphans`（保存登记未引用资源，含历史 refs）+ `listLocalAssets` 跳过孤儿（**删图不再重传**）+ list/delete/clean API + 设置「资源管理」视图。
- 云端 GC：`S3Store` 扩 `listObjects`/`deleteMany`；共享 `src/core/gcDecisions.buildGcKeepSet`（+单测）；移动 `gcDeepCleanup`（删「未被 latest 清单/历史引用 ∧ 超 7 天」的云端 objects/assets）+ 设置「云端清理」按钮。
- 标签保持（localStorage 记上次打开标签 + `maxOpenTabs` LRU 淘汰）；工作区改标题；插入面板纯图标；小记缩略图批量；目录树长按管理（重命名/图标/移动/删除）。
- lakeNative 暴露：listOrphanAssets/cleanOrphanAssets/deleteOrphanAsset/gcDeepCleanup/listNoteHistory/restoreHistory/cleanupHistory。

（260908 后续）1. 历史设置可配置 + 定时自动快照：HistoryMobileSettings（maxSnapshots/retentionDays/cleanupIntervalHours/snapshotIntervalMinutes）+ get/saveHistorySettings（device_state）+ cleanupHistory 改共享 selectHistoryDrops（分层保留+上限+保留天数）+ snapshotNote + MobileApp 定时器 + 设置「历史」视图。
2. GC 完整对齐：s3_gc_pending/s3_gc_log 表 + add/remove/list/record 方法 + syncNow 加 onPublished 钩子（新 manifest 不再引用的旧正文/资源→登记待回收，full key）+ buildGcKeepSet 支持 extraManifests（prev 链引用保护）+ gcDeepCleanup 改 double-anchor 窗口 + 删除写 gc 日志。
3. 运行诊断：getDiagnostics（文档/分组/小记/资源/孤儿/待回收/快照数+库大小）+ 关于页「数据诊断」区块（移动端无桌面日志文件，此为「关于/日志」等价）。

### 8.6 当前问题 / 未决（需用户给现象）
1. **"正在下载"从未复现**（MutationObserver 实时抓也没有）——判断是编辑器初始化瞬时态/旧命令报错后遗症，修复后未见。**若用户真机仍见，要截图或位置**再定位。
2. 命令在**被改乱的段落**上可能不生效（caret 落标题/边界时 list 0→0）——编辑器 caret 语义，非命令 bug；干净段落正常。
3. 移动端**既有遗留**（见 §3.6-3.8）：剪贴板粘贴不解析为空（静态线索：移动端入口没挂 `installPasteInterceptor`，android worktree 已补挂，先沿那条线验证）；本地资产 canonical `http://127.0.0.1:19876/{noteId}/{file}` 真机不可达（需 `adb reverse tcp:19876 tcp:19876` 或可达成名）；用户"移动端整体编辑还有问题"现象未细化。
4. **大纲 viewer 只读点标题不跳转**（`OutlineSheet` 用 `headingUnfold`+`scrollByNodeId`，viewer 下静默失效）；用户计划重做大纲时一并处理。

### 8.7 下一步（移动端）
1. **整库备份/云端恢复**：桌面走「文件系统拷贝 + 应用重启」；移动端数据在沙盒（sql.js + Capacitor FS，无 workspace 目录），架构不匹配——需另做「数据导出/导入」（导出 DB 快照 + 资产清单到文件）。当前移动端已做「运行诊断」统计（§8.5.3）。
2. **定时自动快照**：snapshotNote 复用 createHistorySnapshot（已带 24h 去重）；真机验证定时器（移动端模拟器 app 生命周期可能不触发 setInterval，需前台运行验证）。
3. 剪贴板粘贴真机验证（§8.6.3）；大纲 viewer 跳转（§8.6.4）；资源 canonical URL 真机可达（adb reverse）。

### 8.8 移动端踩坑（本会话新增）
- **`insertUnorderedList` 不是 Lake 命令**：`unorderedList` 才对；命令名错=静默 no-op/疑似"下载"。
- **点 dock 按钮会抢走编辑器焦点**：键盘关、caret/选区丢→命令失效。解法：容器 `onMouseDown={e=>e.preventDefault()}`。
- **面板项别调 focusEditor**：`renderer.execCommand("focus")` 重开 IME→叠成"工具栏-面板-键盘"3 层；面板项只 `exec` 不聚焦。
- **别在 setState updater 里 blur**（键盘有时仍开着）；blur 挪到 `setTimeout(0)` 外。
- **工具栏 `transition: bottom` 有害**：它在对"正在 resize 的视口"做动画（键盘收起 `innerHeight 530→842`），把本来稳定的一帧错位放大。改 `--kb-offset=innerHeight-base+panelHeight`（屏幕 Y 恒定）并删 transition。
- **adjustResize vs edge-to-edge**：模拟器 adjustResize（键盘弹 `innerHeight` 变小、`offset=0`）；真机 edge-to-edge（`offset>0` 上移）。用 `height>8` 判键盘开、`offset` 区模式。
- **测试污染**：往文档打字/改格式会改脏 doc → 后续 caret 不可靠（list 0→0）。验证命令用**新建干净文档**（`window.lakeNative.createNote(name,'notebook-personal')`），别在已改过的 PRD/文档上测。
- **模拟器 `.click()` 无 mousedown**：测不了 `preventDefault` 焦点路径；`Runtime.evaluate` 里 `element.click()` 测逻辑，真实 preventDefault 要真触屏/真机。
- **模型看不了图**：`read_image` 失败（模型不声明图片输入）→ 用 DOM/computed style/`getBoundingClientRect` 量测代替截图。

### 8.9 移动端常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit                                             # 类型检查
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts   # 移动 bundle→dist-mobile
bash scripts/android-build.sh --sync --install               # sync+gradle+adb install+launch(com.lakenotes.mobile)
bash scripts/emu-cdp.sh                                      # 转发 WebView→tcp:9335（测 UI 前必跑）
bash scripts/emu-up.sh                                       # 启动模拟器（无窗口 --no-window）
bash scripts/mobile-preview.sh                               # 浏览器预览 http://127.0.0.1:1422/preview.html
adb shell pm clear com.lakenotes.mobile                      # 清 App 数据重建种子（dev 才做）
```
