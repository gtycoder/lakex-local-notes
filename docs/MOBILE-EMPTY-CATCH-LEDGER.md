# MOBILE-EMPTY-CATCH-LEDGER.md — MOB-14：src/mobile 剩余空 catch 清单

> 口径（261027 审计 MOB-14 的收口）：空 catch（`catch {}` / `catch (e) {}`，块内只有注释）= **可预期 no-op 白名单**，
> 每条必须写「真实理由」；**交互/命令路径**的失败接 `reportMobileActionError(动作, error)`（默认只记 debug 日志、
> 不弹 toast、不打扰用户；需要用户可见时显式传 `toast`）。
>
> 本清单 = 261029 收口快照（TS AST 扫描 `src/mobile`，排除 `*.test.*`；**行号是当时的快照**）：
> 空 catch **80 处**，逐条带理由。同批把 5 处命令/交互路径接上 `reportMobileActionError`（AI 删除/清空历史对话、
> 打开小记、订阅撤销快照、切换表格编辑态）⇒ 全 `src/mobile` 现有 28 处上报点。
>
> 护栏：`src/mobile/lib/emptyCatchGuard.test.ts`（新增空 catch 若只写「忽略/ignore」或干脆不写理由会红）。
> 维护：新增空 catch **必须同时写理由注释**；能让用户「点了没反应」的命令路径必须上报，不要沉默。

## 本批改写理由的 22 处（✏️）

### `src/mobile/bridge/sync.ts`
- `153` ✏️ /* 原生直传不可用/失败 ⇒ 回退下面的字节 GET 路径（不是错误） */
- `475` ✏️ /* 同步诊断落盘失败：不阻断本轮同步结果 */
- `495` ✏️ /* 失败诊断落盘失败：原始同步错误照旧抛出 */

### `src/mobile/editor/EditorDock.tsx`
- `134` ✏️ /* 内核未实现该命令查询 / 实例销毁：按「未生效」返回，避免误点亮工具栏 */

### `src/mobile/editor/useEditSurface.ts`
- `46` ✏️ /* 元素已卸载/不可聚焦：无副作用 */
- `55` ✏️ /* 同上：inputmode 已写好，失焦失败不影响抑制 */
- `250` ✏️ /* 目标在事件派发后已卸载：属性写失败无副作用 */

### `src/mobile/editor/useEditorCommandDispatcher.ts`
- `61` ✏️ /* 合成期间切焦点：元素可能已卸载；命令仍会执行 */
- `65` ✏️ /* 同上：交还焦点尽力而为，失败不阻断命令 */

### `src/mobile/editor/useSnapshotUndo.ts`
- `197` ✏️ /* 卸载路径：内核已销毁/无 off 方法，取消订阅失败无需处理 */

### `src/mobile/home/QuickNoteComposer.tsx`
- `198` ✏️ /* 内核这一刻还没就绪：聚焦是尽力而为（立即 + 150ms 各试一次），用户可手动点正文 */
- `226` ✏️ /* 同上：插入文件后补一次聚焦，内核不可达时用户可手动点正文 */

### `src/mobile/native/kernelPrewarm.ts`
- `81` ✏️ /* 预热容器已移除/未挂载：清理失败不影响主流程 */

### `src/mobile/native/nativeSqliteDb.ts`
- `120` ✏️ /* 事务已被原生端回收（begin 失败/已回滚）：原始错误才是要上报的 */

### `src/mobile/native/secretStore.ts`
- `72` ✏️ /* localStorage 被禁用：删除失败等同不存在（读取路径会解密失败返回 null） */

### `src/mobile/usheet/MobileUsheetViewer.tsx`
- `341` ✏️ /* 收起键盘：没有可失焦元素时无副作用 */
- `596` ✏️ /* 实例重建/销毁瞬间没有 univerAPI：下次挂载会重设主题 */
- `603` ✏️ /* 卸载时逐个 dispose：单个失败不阻断其余（实例即将销毁） */
- `605` ✏️ /* 销毁失败不阻断卸载：引用已置空，交由 GC 回收 */
- `728` ✏️ /* 实例销毁/无活动表时 scroll-to-cell 不可用：只影响自动滚动，几何变化会重试 */

### `src/mobile/usheet/useNativeSheetFormulaBar.ts`
- `97` ✏️ /* canvas 被清空/跨域污染导致读像素失败：按「无文字宽度」兜底（只影响公式栏左内边距） */

### `src/mobile/v3/sync.ts`
- `59` ✏️ /* 设备本地调试开关读不到 ⇒ 按默认 upload（不参与同步数据） */

## 其余 58 处（既有合理理由，保持不动）

### `src/mobile/MobileApp.tsx`
- `358` /* 坏图跳过，不阻断带入 */

### `src/mobile/ai/AiImageSheet.tsx`
- `41` /* 单篇失败跳过 */

### `src/mobile/ai/MobileAiPage.tsx`
- `105` /* 单张失败跳过 */

### `src/mobile/ai/aiChatStore.ts`
- `164` /* 淘汰失败不影响对话 */
- `183` /* 落盘失败不打断对话（下次变更会再试） */
- `238` /* 恢复失败从空会话开始 */

### `src/mobile/ai/aiConversationPersist.ts`
- `197` /* 不存在/失败都算删掉 */
- `205` /* 不存在 */

### `src/mobile/ai/aiImageStore.ts`
- `147` /* 目录不存在 */

### `src/mobile/ai/aiSettings.ts`
- `12` /* 存储不可用：本次会话按默认关 */

### `src/mobile/bridge/sync.ts`
- `373` /* 日志失败不阻断 */

### `src/mobile/data/historyRepository.ts`
- `50` /* 单条坏账跳过 */
- `127` /* 文件已缺失不阻断删行 */
- `207` /* 文件已缺失不阻断删行 */

### `src/mobile/data/noteRepository.ts`
- `70` /* 单条坏账不影响其它快照 */

### `src/mobile/data/schema.ts`
- `393` // 例如 sql.js 没有 FTS5 模块：整批回滚 ⇒ 退逐条，只对 optional 语句容错（真实错误照旧抛）。
- `414` // Older databases or constrained environments may not support the pragma.
- `423` /* 旧库没有账本表 */
- `424` /* 无 FTS5 的环境 */

### `src/mobile/editor/useSnapshotUndo.ts`
- `104` /* 光标还原失败不阻断内容恢复 */

### `src/mobile/home/QuickNoteComposer.tsx`
- `169` /* 读草稿失败不阻断输入 */

### `src/mobile/home/useQuickNoteDetailCache.ts`
- `67` // 单条正文读取失败：卡片保留轻量摘要，允许下次可见时重试。

### `src/mobile/hooks/useAutoSync.ts`
- `139` /* Web 预览/测试环境没有 Capacitor：只保留冷启动那次 */

### `src/mobile/hooks/useBackHandler.ts`
- `58` // 非 Capacitor 环境（Web 预览/测试）：不注册，浏览器 history 或物理键兜底

### `src/mobile/lib/historySettingsSync.ts`
- `23` // 单个订阅方异常不能影响其它订阅方与设置保存流程。

### `src/mobile/native/aiChat.ts`
- `108` // 插件不可用（浏览器预览）：静默，调用方会拿到 aiChat 的 unavailable

### `src/mobile/native/assetFs.ts`
- `221` /* 回退 Filesystem 扫描 */
- `240` // 小记资源目录不存在/损坏时跳过

### `src/mobile/native/assetWrites.ts`
- `29` // Memory has been restored; a failed disk restore must not mask the original error.
- `36` // The destination was absent before this write; best-effort cleanup is sufficient.

### `src/mobile/native/cachePort.ts`
- `16` /* Filesystem 不可用时忽略 */

### `src/mobile/native/deviceProfile.ts`
- `20` /* 桥不可用时保持手机布局 */

### `src/mobile/native/keystoreSecretStore.ts`
- `51` /* 幂等 */

### `src/mobile/native/nativeKeyboard.ts`
- `23` /* Web 预览 / vitest：没有原生插件 */

### `src/mobile/native/quickNoteShortcut.ts`
- `158` // 非 Capacitor 环境（Web 预览/测试）：不订阅

### `src/mobile/native/safeAreaInsets.ts`
- `30` /* 桥不可用时保持 env 兜底 */

### `src/mobile/native/sharedContent.ts`
- `54` /* 读不到就只带文本 */

### `src/mobile/native/stylusInput.ts`
- `14` // 老系统 / 非 Android 壳层没有该能力：手写板仍可使用 Pointer Events。

### `src/mobile/settings/useS3SettingsForm.ts`
- `116` // 剪贴板不可用：面板里可长按全选复制。

### `src/mobile/sync/historyCleanupScheduler.ts`
- `37` /* 隐私模式/无存储 */
- `46` /* 回退 localStorage */
- `58` /* 表异常时只留 localStorage */

### `src/mobile/sync/syncDiagnosticsStore.ts`
- `18` /* 隐私模式/无存储 */
- `31` /* 表异常 → 回退 localStorage */
- `43` /* 表异常时 localStorage 兜底已写 */

### `src/mobile/sync/syncProgressStore.ts`
- `28` /* 订阅方自行负责 */

### `src/mobile/sync/syncResumeMarker.ts`
- `18` /* 隐私模式/无存储 */
- `21` /* 同上 */
- `29` /* 表异常时退化为 localStorage */
- `35` /* 同上 */
- `43` /* 回退 localStorage */

### `src/mobile/ui/haptics.ts`
- `14` /* 不支持即忽略 */

### `src/mobile/usheet/useSheetChromeState.ts`
- `99` // 选区内没有可读样式时保持原状态。
- `111` // 实例销毁中忽略。

### `src/mobile/usheet/useSheetReadFilter.ts`
- `35` // 实例销毁中忽略：此时正文也不再落盘。

### `src/mobile/v3/mobileDeviceStore.ts`
- `621` /* 原生不可用/旧 APK：回退逐篇扫描 */

### `src/mobile/v3/sync.ts`
- `48` /* UI 回调自行负责 */
- `51` /* UI 回调自行负责 */

## 说明：为什么这些不上报

- **DOM 尽力而为**（focus / blur / setAttribute / remove）：元素在事件派发后已卸载或不可聚焦时失败无副作用。
- **派生 / 缓存兜底**（localStorage 不可用 → 内存或默认值、读像素失败 → 保守值、目录不存在 → 空列表）：失败等价于「还没有」。
- **清理 / 回滚路径**（卸载时 dispose、恢复失败不掩盖原错误、删除幂等）：失败不改变用户可见结果，且不应掩盖原始错误。
- **非 Capacitor 环境**（Web 预览 / vitest）：插件不存在是预期分支，调用方另有兜底。
- 反例（**不要**学）：命令执行 / 异步动作「静默吞掉」——用户只看到「点了没反应」。这类必须接 `reportMobileActionError`。
