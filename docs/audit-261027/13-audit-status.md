# 13 · 审计项状态盘点（对账表）· 261028 晚

> **一句话**：84 条编号 finding 逐条给「状态 + 证据」；原文档里「表说没做、代码已做」的 11 处（§7 C-1…C-11）已在本轮修正到 `02/03/04/05/10/00`。
> **采样时间**：**2026-10-28 21:15–21:30（Asia/Shanghai，本地时钟）**；基线 = `master @ ea576a80` + 工作树未提交改动（采样期间 `git status --porcelain` 从 333 → 370 项，并行工作流在改）。**工作树即最终事实**，文档「修复状态」表可能过期——本文以代码/测试为准。
> **261029 第二批复核（09:15–10:20，Lead + teammate 并行）**：DT-09/DT-16/SD-11/CORE-10-09/CORE-13/CORE-14 → 已修；**类型收口批（D-7 + CORE-10 tail）**：CORE-05/CORE-10 → 已修（删 syncEngineTypes/manifestTypes/mobile syncDbPort 等 v2 端口、core→lib 类型反转、check:core 白名单收紧）；MOB-16 → 已裁决不做；SEC-03 补本机 release 出包/aapt/装机证据；MOB-04 查找接内核 + 虚拟渲染已切换（编辑节点 5552→2197、进编辑 5117→2102ms）；设置「关于」显示内核 v4/协议 v3；统计按 §0 更新（66/6/8/4）。
> **证据优先级**：① 代码/测试 grep 实证（行号为采样时点，定位以「文件 + 符号」为准）→ ② `08-ab-execution.md` 各轮记录 → ③ 各文档「修复状态」表 → ④ `docs/HANDOFF.md` §0。
> **自包含**：不再依赖 `/tmp` 任何中间产物（原盘点脚本 rows.json / check*.sh 已弃用，全部证据内联到「证据」列）；本文件可单独作为下一会话的对账入口。
> **未跑门禁**：本文不声称跑过全量 `npx vitest run` / 设备门禁；出现的测试计数一律注明出处（`08` 某轮 / `HANDOFF` §0），不是本文自行产出。
> **并行改动**：DT-04/DT-15、CORE-06/07/09/10/12、MOB-11/MOB-14、SEC-03/SEC-10/SEC-13a–f 在采样窗口内由并行工作流落地；这些行已按**最终工作树**复核（逐条证据在 §1），不再标「进行中」。
> 说明：`07-rfc` 视为 v4 计划、状态以 `08`/`12` 为准（见 §4）；`06-redesign` 只给三类结论（见 §3）；`00-executive` 自身清单见 §2。

## 0. 统计总览（84 条编号 finding）

| 状态 | 数量 | 说明 |
|---|---|---|
| 已修（含已删/已收口/保守版） | **68** | 有代码或测试证据（文档状态表只是线索） |
| 部分 | **5** | 主问题已降级/收口，残余项在 §1 逐条写明 |
| 未做 | **2** | 无轮次记录且代码实证问题仍在（CORE(10)-04、CORE(10)-11）；原 8 条里 6 条 SEC 于 261029 复核转「已裁决不做」 |
| 延期（含已裁决不做 / 已裁决合并） | **9** | SEC-05、MOB-10、MOB-16、MOB-18、**SEC-04/06/08/09/11（261029 复核裁决不做，02 §6；SEC-12 经用户确认发版需求后改为已修）** |
| 需确认 | **0** | — |

**口径**：84 = SEC 13 + DT 16 + MOB 18 + SD 13 + **CORE(09) 10 + CORE(10) 14**。`00-executive` 的「P0×1 / P1×21 / P2×38 = 60」**只统计 `02`–`05`**（不含 CORE 24 条），本文件已在该文 §1 显式写明。
**级别分布**：P0 **1（已修）** / P1 **30**（已修 28 · 部分 1 = SEC-03 · 未做 1 = CORE(10)-04）/ P2 **53**（已修 40（SEC-13/SEC-12 结项）· 部分 2 · 延期 9 · 未做 1 = CORE(10)-11）。
**按文档非已修项数**：SEC 8（部分 1 / 延期 7）· DT 0 · MOB 3（延期 3）· SD 1（部分 SD-07）· CORE(09) 1（部分）· CORE(10) 3（部分 1 / 未做 2）。

## 1. 分文档逐项状态

### 02-security.md（SEC）

| ID | 级别 | 一句话内容 | 状态 | 证据（文档表 / 08 轮次 / 代码） |
|---|---|---|---|---|
| SEC-01 | P1 | AI 连通/拉模型可用已存 Key 打任意 baseUrl | **已修** | 02 §修复状态表 + 08 §1/§8；`validateAiBaseUrl`/`aiBaseUrlChangeError`（src/core/aiProviders.ts、electron/ipc/registerAi.ts）；`ai_chat` 存量脏 baseUrl 已在 08 §8 补二次校验 |
| SEC-02 | P1 | save_s3_settings 可改任意 endpoint/bucket/prefix | **已修** | 02 表 + 08 §1；`validateS3Settings` 已接保存路径（electron/ipc/registerSync.ts） |
| SEC-03 | P1 | Android 只有 debug 包、桌面未签名 | **部分**（静态断言已就绪 + 发版口径已放宽；CI 首跑/装机未做） | `scripts/check-android-release-config.mjs`（12 项静态断言，`--apk` 可 aapt 实测）+ `package.json check:android-release`；`.github/workflows/release.yml` L75 检查 step + `assembleRelease`/`aapt dump badging`；**261029 放宽**：release job 只要求 macOS 成功，Android 失败只阻断自己的产物；本机对 debug APK 反向自证 exit 1 |
| SEC-04 | P2 | 资产 token 只对带 Origin 请求生效（本机进程可读） | **延期（261029 复核：不做）** | 02 §6：桌面同机进程可直接读明文数据目录、手机侧需已知 UUID+文件名且无枚举 ⇒ 收益不成比例；重做双端资源链成本 M |
| SEC-05 | P2 | CSP 与主进程全端口放行 127.0.0.1 | **延期（已定不做）** | 02 条目头「261028 复核：已定不做」+ 08 §12（git 1ce3d3c2/4c2d2b49 既有决定）+ `vite.config.ts` 恢复通配并加注释；02 修复状态表已在本轮对齐 |
| SEC-06 | P2 | 无 session 级权限收敛 | **延期（261029 复核：不做，且「全拒」有害）** | 02 §6：会连 `navigator.clipboard.readText()`（S3 剪贴板导入/多维表粘贴）一起拒；摄像头/麦克风/定位 0 调用方 |
| SEC-07 | P2→P1 | /__native.js 的 Sec-Fetch-Site 门禁对非浏览器客户端无效 | **已修** | 08 §10-3（删 `Sec-Fetch-Site: none` 放行 + 统一 `isAllowedRequest`）；`electron/webApiServer.ts` 头注释点名 SEC-07、`isAllowedRequest` L265、调用点 L688；token 不再下发到静态 JS（HttpOnly cookie）；02 表已在本轮对齐 |
| SEC-08 | P2 | Android 全局 cleartext + MIXED_CONTENT_ALWAYS_ALLOW | **延期（261029 复核：不做，只修注释）** | 02 §6：页面 scheme 本为 http://localhost、CSP 已限死出网面 ⇒ 无可达目标；`network_security_config.xml` 旧注释「开发版」已改「发布配置」 |
| SEC-09 | P2 | WebView JS 桥全生命周期 + data:/blob: 内导航 | **延期（261029 复核：不做）** | 02 §6：CSP `script-src 'self'`+hash、`object-src none`、外链被 Cap 拦 ⇒ 当前无触发路径；新增 HTML 预览时按条目前置条件一起做 |
| SEC-10 | P2 | 补丁面/文档漂移（3 patch、两目录、AGENTS 只认 1 个） | **已修（文档面）** | AGENTS §2 已改为实况「**补丁面 = 3 处 / 两个目录**」并逐条登记作用/重建/升级验证（`patches/@univerjs+ui+1.0.3`、`patches/@plait+draw+0.93.4`、`vendor/lakex-doc-react/patches/@xiangfa+mindmap+0.7.1`）+「patch 打上但没命中」提醒；patch 内容未动。残余（建议项）：未加补丁命中自检 |
| SEC-11 | P2 | plugins: true + object-src 放行 127.0.0.1 | **延期（261029 复核：不做，接受并登记）** | 02 §6：内联 PDF 预览是真实功能；PDFium 修随 Electron 升级、渲染进程 sandbox 限影响面 |
| SEC-12 | P2 | CI 供应链：mutable tag action、contents:write | **已修（261029）** | 用户确认后期走 GitHub Actions 发版 ⇒ 两个 workflow 全部 action 钉 commit SHA（checkout v4.4.0 / setup-node v4.4.0 / setup-java v4.9.1 / upload-artifact v4.6.2 / download-artifact v4.3.0 / softprops v2.6.2），头注释写升级方式；Gitee token 形态不动（托管 runner 单租户）；02 §6 |
| SEC-13 | P2 | 纵深防御小项 13a–13f | **已结**（13a/13f 已修 + 测试；13b/13e 261029 复核不做） | 13a：`desktopStoreAdapter.writeQuickAsset` 加 `SAFE_ASSET_FILENAME` + 负向测试 4 例（`desktopStoreAdapter.test.ts:259`）；13f：`assetServer.ts` L269/366/377 `public→private` + 响应头断言（`assetServer.test.ts:168/211/276`）；13c 有意保留；13d 改判无可删（08 §3）；13b/13e 未做 |

### 03-desktop.md（DT）

| ID | 级别 | 一句话内容 | 状态 | 证据（文档表 / 08 轮次 / 代码） |
|---|---|---|---|---|
| DT-01 | P1 | doc 是唯一没有错误边界的宿主 | **已修** | 03 表；08 §1；MultiTabEditor 现 11 处 EditorErrorBoundary |
| DT-02 | P1 | 11 处原生 window.confirm/alert | **已修** | 03 表；新增 src/hooks/useConfirm.tsx；桌面 window.confirm 剩余 0 |
| DT-03 | P1 | 9 处浮层用硬编码估算尺寸定位 | **已修** | 03 表（第四轮）；clampPopoverPosition 实测调用点 0（仅定义+一处注释） |
| DT-04 | P1 | 桌面 UI 零执行级测试（334 例源码字符串断言） | **已修（按本轮判据）** | 08 §15-6 试点 `src/features/editor/multiTabHost.render.test.tsx`（**5→7 例**：新增 doc 子组件崩溃被 `EditorErrorBoundary` 接住 + 重试重建、capture 注册/注销打真实注册表）+ 新增 `src/hooks/useTabLifecycle.restore.render.test.tsx`、`src/hooks/useBootstrap.render.test.tsx`（DT-15 回归）；`vitest.config.ts` include `.render.test.tsx`；桌面 render 测试文件 3 个（移动侧另有 5 个）。残余（扩面项）：334 例源码字符串断言仍是主体，设置页/顶栏/回收站等域未覆盖 |
| DT-05 | P1 | 小记列表全量 IPC + 全量渲染 | **已修** | 03 表（第五轮）；QuickNoteListSummary + read_quick_note（IPC 136）+ 视口懒加载 |
| DT-06 | P2 | 五种宿主契约分裂（prop 词表/capture/类型） | **已修** | 08 §16-1；src/features/editor/editorHost.ts EditorHostProps 单一词表，5 宿主接入 |
| DT-07 | P2 | createLakeDocument 921 行 / 巨型组件 | **已修** | 08 §16-1（921→330）+ 抽 4 个 dispose 模块；lakeRuntime 现 1524 行 |
| DT-08 | P2 | 日志双轨（rlog 8 处 vs 裸 console 42） | **已修** | 08 §13-6/§17-3；桌面裸 console(log/debug/info) 当前 0，rlog 34 处 |
| DT-09 | P2 | App 顶栏渲染 4 份 + props 打洞 | **已修（261029）** | App.tsx 4 份合并为单一渲染点（槽位 Provider src/desktop/desktopWorkspaceSlot.tsx + 纯函数）；857→836 行（−21）；新 render 测试 5 例（含单渲染点棘轮）；快照未跑（本机缺合成夹具缓存） |
| DT-10 | P2 | 3 个零引用死模块 + ink 置灰导出 + 失效 allowlist | **已修** | 08 §1 死面清理；editorHost/treeRepositoryAdapter/imageConverter.worker 已删，ink「开发中」行已删 |
| DT-11 | P2 | dead-css 桌面 6/6 假阳性（模板串拼接漏判） | **已修** | 08 §15-7；audit-dead-css 含已知样本注释，当前桌面候选 0 |
| DT-12 | P2 | 菜单状态/行内重命名 3–5 套手写 | **已修** | 08 §14-3；useAnchoredMenu + InlineRenameInput 已存在并接入 |
| DT-13 | P2 | SettingsPanel 44 useState / 10 组 busy-msg | **已修** | 08 §14-3（6/10）+ §17-3（10/10）；useAsyncAction 已抽 |
| DT-14 | P2 | 模块边界倒置 + Suspense 文案单一 | **已修** | 08 §12-8；features/editor/editorViewport.ts 存在，Suspense 旧文案 0 命中 |
| DT-15 | P2 | （在途）桌面标签恢复顺序 readNote + 逐次淘汰 | **已修** | `src/desktop/tabSession.ts:53 restoreTabSessionForLimit`（按 `maxOpenTabs` 只留最近 N）+ `src/hooks/useBootstrap.ts` 调 `restoreTabs(planned.ids, planned.activeId)`（`useTabLifecycle.restoreTabs`：有界并发读 + 一次 `setOpenTabs`）；回归 `src/hooks/useBootstrap.render.test.tsx`、`src/hooks/useTabLifecycle.restore.render.test.tsx` |
| DT-16 | P2 | any 53 处 / capture 类型重复 / native 内联类型 | **已修（261029）** | 生产代码 any 35→**0**（lakeRuntime 21 / kernelUiAtoms 9 / lakeTocScrollFollow 3 / aiResultOps 2）；全仓 src+electron 生产代码 any/as any/<any> = 0；新增窄类型、无 as never/双重断言；定向 vitest 19 文件 259 例 |

### 04-mobile.md（MOB）

| ID | 级别 | 一句话内容 | 状态 | 证据（文档表 / 08 轮次 / 代码） |
|---|---|---|---|---|
| MOB-01 | P1 | 返回键不关浮层 | **已修** | 04 表；08 §1；src/mobile/hooks/useBackHandler.ts |
| MOB-02 | P1 | 工作区浮层 10 个独立 state 手写互斥 | **已修** | 04 表（第六轮）；useWorkspaceOverlays 单 owner |
| MOB-03 | P1 | 首页分页器靠定时器/flag 区分程序化滚动 | **已修** | 04 表（第七轮）；home/tabPager.ts+useTabPager.ts，镜像 ref/600ms 定时器已删（homeCreateFlow.test.ts:146 断言） |
| MOB-04 | P1 | 为自研查找关闭内核虚拟渲染（长文档全量 DOM） | **已修（261029：查找接内核 + 虚拟渲染开启）** | 查找改内核优先（`ISearchService.onSearch` → `count`/`jumpTo`，桌面同一逻辑；取不到降级 DOM）⇒ 编辑态开虚拟渲染（`disableVirtualRendering:false`）+ 真实 `scrollNode`。A/B：编辑节点 5552→2197、进编辑 5117→2102ms（TaskDuration 3351→342ms）；设备复验 1/300、jumpTo(299) 滚动、输入写入、卡片按需水合、编辑面不变量全 ok、6 态 0 差异 |
| MOB-05 | P1 | 移动端 usheet 保存路径不接 normalize | **已修** | 08 §10-1 + AGENTS §4 已更新；`src/mobile/usheet/MobileUsheetViewer.tsx` L37 import、L253（capture）、L514（挂载）、L550（基线）四处 `normalizeUsheetWorkbook`；护栏 `usheetOpenReadOnly`/`usheetDoc` 跨端逐字节相同；04 表已在本轮对齐 |
| MOB-06 | P1 | 彻底删除不清 note-assets | **已修** | 04 表；08 §1；purge 删 note-assets/quick-notes assets（+5 例） |
| MOB-07 | P1 | 表格第二套面板/键盘状态机 | **已修** | 04 表（第七轮）；MobileUsheetViewer 接共享 useEditSurface（注释点名 MOB-07），删 7 state+2 定时器 |
| MOB-08 | P1 | 启动失败无出路 / 看门狗重建无上限 | **已修** | 04 表（第五轮）；可处置错误页（重试/复制诊断/清缓存） |
| MOB-09 | P2 | 两个设置项可改但无效 | **已修** | 04 表（第五轮）；附件上限读设置 + 历史清理低频调度 |
| MOB-10 | P2 | 表格面板 10 个置灰占位 + 4 死分支 | **延期** | 用户 261028 裁决「保留，后续讨论」（08 §3/§9）；代码仍有置灰项 |
| MOB-11 | P2 | 8 个浮层各写一套 scrim/sheet | **已收口（迁移 11 处 + 6 组例外登记）** | `src/mobile/ui/MobileSheet.tsx` 原语；已迁 11 处（NoteInfo/TagSheet/CreateNotebook/Search/工作区图标/历史/DocList/Outline-底部/bitable 字段与记录/首页图标）；剩余 6 组/8 文件经逐处判定「结构/语义不同 ⇒ 不迁」，理由登记在 `docs/MOBILE-SHEET-EXCEPTIONS.md`（+ MOBILE-DESIGN 指针）；顺带修 `MobileAiPage` 附件 ActionSheet 缺 `pushBackHandler`（真实返回栈洞，`MobileAiPage.tsx:69/75`） |
| MOB-12 | P2 | 标签恢复隐式协议 | **已修** | 04 表（第五轮）；useNotebookTabs.restore() 一次 dispatch，删 firstPersistRef |
| MOB-13 | P2 | 注释/文档漂移 | **已修** | 04 表（第八轮）；4 处注释纠偏 + ARCHITECTURE/TROUBLESHOOTING 更新 |
| MOB-14 | P2 | 197 处空 catch（78 处仅「忽略」） | **已销账（当前树口径）** | **口径更新**：审计的 197/78 是 261027 数字；当前树 AST 实测 = **279 catch / 空 catch 85→80**。本轮新接 `reportMobileActionError` 5 处（累计 28 个上报点，定义 `src/mobile/lib/reportMobileActionError.ts`），22 处「忽略」改成真实理由说明，**剩余 80 处全部带理由**；登记文档 `docs/MOBILE-EMPTY-CATCH-LEDGER.md`（204 行）+ 护栏 `src/mobile/lib/emptyCatchGuard.test.ts`（新空 catch 直接红） |
| MOB-15 | P2 | 首屏预算无护栏 | **已修** | 04 表（第五轮）；check-bundle-budget 加移动 preload≤21/JS≤80KB/CSS≤138KB；目标 12/120KB 未达 |
| MOB-16 | P2 | 入口缺失（资源页/标签管理/导出导入） | **延期（已裁决不做）** | 261029 用户裁决：**不做**，不再跟踪；判据仍在 core missingBody 可复用 |
| MOB-17 | P2 | 设置子页返回语义 & 读取不订阅 | **已修** | 04 表（第八轮）；返回栈 + 历史设置广播/重挂 |
| MOB-18 | P2 | 安全/原生提纲（转 02） | **延期（已裁决：并入 SEC）** | 261029 用户裁决「按推荐、并入 SEC、不单独跟」：实质问题归 SEC-08（cleartext/mixed-content）与 SEC-09（JS 桥/data:blob:），02 的安全专项批次统一处置 |

### 05-sync-data.md（SD）

| ID | 级别 | 一句话内容 | 状态 | 证据（文档表 / 08 轮次 / 代码） |
|---|---|---|---|---|
| SD-01 | P0 | 全量重拉=静默永久删除本地独有文档 | **已修** | 05 表；08 §1/§10-4（用户裁决：进回收站 + 云端已删除标）；pullAllSafety.test.ts |
| SD-02 | P1 | 内存按本轮字节线性增长 | **已修** | 05 表（第五轮保守版）；bodyCache 批内生命周期 + 分批 flush；v4 已删旧 bodyCache 字段（08 §59） |
| SD-03 | P1 | 恢复/换云入口缺失 + 可云恢复判据用死表 | **已修** | 05 表（最小版）+ 261028 晚补 epoch-mismatch 恢复入口（HANDOFF §0 / 12 §7.2）；markRemoteNoteIds |
| SD-04 | P1 | 待同步计数永久挂起 | **已修** | 05 表；markTombstonesPublished |
| SD-05 | P1 | 发布成功被报成失败 | **已修** | 05 表；executePending 失败降级 warning |
| SD-06 | P1 | 双端语义两写 + 已发生的漂移 | **已修（保守版 + 本轮 8 条对账）** | 08 §59 v4 四相内核成为唯一同步实现（决策/编排不再两写）；残余**适配器字段级**漂移按 `docs/SYNC-DEVICE-CONTRACT.md` §5 逐条对账（新增「261028 对账」列）：**仍漂移 1**（编辑锁 `lockedAt`）、**有意保留 4**（批量删除 / deferAssets 默认 / gzip 元信息 / 状态读取成本）、**已对齐 3**（回收站父语义 / 小记冲突副本 / 物理删除历史） |
| SD-07 | P2 | 空跑轮 O(N) 全量写 + baseline 重复加载 | **部分** | 05 表（第四轮保守版）：零变更跳过 saveBaseline；但 state 仍每轮全量写（05 表自注） |
| SD-08 | P2 | 发布锁/重试上限 + 容量测试固化失败 | **已修** | 05 表（第八轮）；门禁 12 端硬断言、删 retry；261028 晚修 lock-busy 退避（12 §7.1） |
| SD-09 | P2 | 小记 purged 数组无界增长 | **已修** | 05 表（第七轮）；90 天窗口 pruneQuickPurgedIds |
| SD-10 | P2 | 死参数/死代码在热路径 | **已修** | 05 表（第四轮） |
| SD-11 | P2 | 协议/数据文档整体失效 | **已修（261029）** | SYNC-PROTOCOL 重写 v3；**18 份过程文档物理删除**（S3-V3-* 15 + S3-MANIFEST-SCALE-RESEARCH + S3-GC-DESIGN + S3-REDESIGN）；23 处引用改指 SYNC-PROTOCOL 或注明 git 可查；docs/*.md 51→33 |
| SD-12 | P2 | 测试债：零断言 benchmark/坏基准/固化失败 | **已修** | 05 表（第八轮）；perf 默认 500/2000 + 3.5× 上界 / STRICT 1.8×（electron/s3v3/perf.integration.test.ts:29-40） |
| SD-13 | P2 | 可观测性无落盘 | **已修** | 05 表（第七轮）；最近 3 轮落 device_state.sync_v3_reports + 设置页一键复制 |

### 09-core-data-models.md（CORE-01..10）

| ID | 级别 | 一句话内容 | 状态 | 证据（文档表 / 08 轮次 / 代码） |
|---|---|---|---|---|
| CORE-01 | P1 | 多维表筛选对 markdown/ai 恒真 | **已修** | 09 表（第四轮）；evaluateFilter 并入文本分支 |
| CORE-02 | P1 | 正文解析失败四族四套策略 | **已修** | 09 表（第六轮）；core/docBodySafety.ts |
| CORE-03 | P1 | 打开=只读无 core 判据 | **已修** | 09 表（第七/九轮）；core/docBaseline.ts，usheet/board/ink 桌面+移动接入 |
| CORE-04 | P1 | 表格字体族由运行时 CSS 变量决定 | **已修** | 09 表（用户裁决 + 第二轮）；USHEET_CANONICAL_FONT_FAMILY + normalize 强制归一 |
| CORE-05 | P2 | 多维表导航方言在 core 外两份 | **已修** | 09 表（第八轮）；canonicalBitableNav |
| CORE-06 | P2 | 多维表每次编辑全表重算（5k≈40ms） | **部分** | 09 表「✅ 部分（第八轮）」：bitableViewNeedsClock + 填色投影外提；全表求值仍为定稿口径 |
| CORE-07 | P2 | 手写板每笔 2 次全文档序列化 / undo 2 步 | **已修** | 09 表（用户裁决 + 第二轮）；features/ink/history.ts 页级 InkPatch，12 例 |
| CORE-08 | P2 | 过去/未来 N 天多算一天 | **已修** | 09 表（第八轮）；含今天共 N 天 + 边界用例 |
| CORE-09 | P2 | 正文容量上限散落 5 模块 | **已修** | 09 表（第七轮）；storeLimits.MAX_DOC_BODY_BYTES |
| CORE-10 | P2 | 字数口径输入源两条 | **已修** | 09 表（第八轮）；countTextStats 单入口 |

### 10-core-services.md（CORE-01..14）

| ID | 级别 | 一句话内容 | 状态 | 证据（文档表 / 08 轮次 / 代码） |
|---|---|---|---|---|
| CORE-01 | P1 | 同步落盘后索引在打开前停在旧正文 | **已修** | 10 表（第四轮）；saveState 派生 searchTextForKind 随 saveNote 落 cache+FTS |
| CORE-02 | P1 | 查询构造器产 FTS5 语法错（AND/OR/NOT） | **已修** | 10 表；buildMatchExpression 改引号短语 + 真 MATCH 断言 |
| CORE-03 | P1 | 小记 S3 key 两份实现（自称唯一来源的那份已死） | **已修** | 10 表；quickNoteKeys 零生产引用已删（08 §12-4） |
| CORE-04 | P1 | aiProviders 自述两端共用，实际只有桌面用 | **未做** | 10 表「未做（安全项暂停）」；移动 AI 设置仍走 Kotlin |
| CORE-05 | P2 | core 约 800 行 manifest v2 残留 | **已修（261029）** | syncUtils 296→90 行（MANIFEST 常量/解析/校验/wire/mimeTypeFor 全删）；**D-7 已删** src/core/manifestTypes.ts + src/core/syncEngineTypes.ts（Manifest*/SyncDbPort/S3Store/SyncConfig/SyncReport）+ src/mobile/data/syncDbPort.ts（509 行）+ 批量窗口测试，最小活面迁 src/mobile/data/localStorePort.ts；「关于」显示「同步内核 v4 · 协议 v3（pointer + 内容寻址索引）」 |
| CORE-06 | P2 | setSha256HexImpl 唯一调用点在零引用模块 ⇒ 桌面跑纯 JS SHA-256 | **已修** | `electron/sha256Native.ts`（`nativeSha256Hex` + `installNativeSha256`）在 `electron/main.ts` 启动处调 `setSha256HexImpl`；等价测试 `src/core/sha256Sync.test.ts`；移动端不注入（WebView 无 node） |
| CORE-07 | P2 | fileKindOf 同名两套分类 | **已修** | `src/core/fileCard.ts:192` 改成 `assetNaming.fileKindOf` 的**投影**（`PREVIEW_KIND_BY_ASSET_KIND` 映射删掉第二张分类表，单源 `assetNaming.ts:81`；7 桶 API 不变）；语义变化：`json/apk/bin` 从 `other→document`（同一渲染分支，已接受）；护栏 `fileCard.test.ts` 50 扩展名矩阵 |
| CORE-08 | P2 | 跨端契约五种载体，其中 core/services.ts 零调用 | **部分**（诱饵载体已删、契约装置已移出 core） | 08 §20 已删 `core/services.ts` + `lib/services.ts`；本轮 `treeBehaviorContract.ts` / `resourceBehaviorContract.ts` 从 `src/core/` 移到 `src/testing/`（core 生产边界不再含 vitest 装置）；能力矩阵载体 = `src/core/repositoryCapabilities.ts`（+ 测试）。残余：`deviceConformance.ts`（496 行）仍在 electron，与 v4 M3 一起收 |
| CORE-09 | P2 | 三个小判据各多份实现（路径段/回收站 id/错误描述） | **已修（261029；describeError 按裁决保留两处）** | 路径段单源 = storeUtils.isSafePathSegment；TRASH_NOTEBOOK_ID 单源 = src/core/syncDecisions.ts（store.ts import+re-export；v4 pullRound.ts 第三处也改 import）；describeError 两处语义不同（core logFormat vs lockedTextCard 中文映射）判定不合并 |
| CORE-10 | P2 | 纯函数不纯（clock/random/locale）；core import vitest 与 ../lib/types | **已修（261029）** | 契约装置移 src/testing（core 非测试 import vitest=0）；locale 折叠 toLowerCase；selectHistoryDrops nowMs 可注入；新增 src/core/randomId.ts 替代 3 处 Math.random ID；**CORE-10 tail**：新增 src/core/sharedTypes.ts（SyncSettings/SyncWarning/NoteInfo/QuickNote*/TreeNode*），src/lib/types.ts 改为 re-export，core 生产文件 `../lib/types` import = 0；删死 barrel src/core/types.ts；check-core-boundaries 白名单同步删除 `../lib/types.js` 防回退 |
| CORE-11 | P2 | 展示文案当契约；AI 错误码跨语言双写无护栏 | **未做** | 未见任何轮次记录 |
| CORE-12 | P2 | quickNoteSyncTypes 保活 30+ 方法死端口 | **已修** | `src/mobile/data/quickNotesDbPort.ts`（369 行）已删，DDL 迁入 `src/mobile/data/schema.ts`（L281 点名 CORE-12）；`src/core/quickNoteSyncTypes.ts` 收窄到 25 行（只留仍被 type-only 引用的形状） |
| CORE-13 | P2 | 搜索账本四份实现、两套同名不同列 schema | **已修（261029）** | 新增 src/core/search/schema.ts 单一 DDL 来源（分词器/表名/列片段/索引名/建表语句）；移动 schema.ts 引用（+逐字节冻结契约）；桌面 schemaInit.ts / quickNotes.ts 已接；4 处不再手写 tokenize='unicode61' |
| CORE-14 | P2 | 同一份 SyncSettings 归一三处、回退策略互斥 | **已修（261029）** | 类型单源（storeTypes re-export src/lib/types）；新增 src/core/syncSettings.ts normalizeSyncSettings(raw, fallback) 纯函数；桌面 settingsRepository /syncSettings.test 7 例；**S3Settings 三处定义**（core/syncUtils、lib/types、electron/storeTypes）亦收口到 core/syncUtils（lib/storeTypes re-export）。 |

## 2. 00-executive.md 自身清单对账

### 2.1 Top 10 优先动作（00 §2）

| # | 动作 | 对应 | 状态 | 证据 |
|---|---|---|---|---|
| 1 | 止住不可恢复删除（全量重拉不物删） | SD-01 | 已修 | 08 §1/§10-4 + pullAllSafety.test.ts |
| 2 | 收凭据与出网目标 | SEC-01/02 | 已修 | 08 §1/§8 |
| 3 | Android 产物去 debuggable | SEC-03 | 部分 | `scripts/check-android-release-config.mjs`（12 项断言）+ release.yml 检查 step / aapt 断言 / **发版口径放宽（Android 失败不阻断 mac）**；**待 CI 首跑 + 装机** |
| 4 | 删除第一批死面 | D-1/DT-10/MOB-10/D-2 | 部分 | 3 零引用模块+ink 行+allowlist 已删（08 §1）；浏览器端用户裁决保留；移动置灰裁决保留；config.xml 改判无可删 |
| 5 | 移动彻底删除清资产 | MOB-06 | 已修 | 08 §1 |
| 6 | 移动返回栈止血 | MOB-01 | 已修 | 08 §1 |
| 7 | doc 错误边界 | DT-01 | 已修 | 08 §1 |
| 8 | 4 个不可逆动作换自有 Dialog | DT-02 | 已修 | 08 §1（11 处全换） |
| 9 | 同步语义三修 | SD-03/04/05 | 已修 | 08 §1；SD-03 另于 261028 晚补恢复入口（12 §7.2） |
| 10 | 补行为护栏（重构前置） | DT-04/SD-12/SD-06 | **已修** | SD-12（08 §16-2）、SD-06（08 §18 + contract §5 对账）、DT-04（3 个 render 测试文件 / 7+3+3 例，见 §1 DT-04） |

### 2.2 删除/合并清单（00 §3）

| # | 对象 | 状态 | 证据 |
|---|---|---|---|
| Del-1 | 浏览器端整套 | 改判保留（用户裁决） | 08 §3/§9：保留并完善，拆分 P0/P1/P2（11-browser-end-plan） |
| Del-2 | 3 个零引用模块 | 已删 | 08 §1；代码已不存在 |
| Del-3 | 移动表格置灰 10 项 + 4 死分支 + 画图 5 项 | 延期（用户裁决保留） | 08 §3/§9；代码仍有置灰项 |
| Del-4 | Cordova config.xml | 改判「无可删」 | 08 §3：cap sync 生成且未跟踪 |
| Del-5 | manifest 时代死代码 | 已删 | 08 §20（12 文件/1443 行 + ~350 行，净减 ~1760） |
| Del-6 | 三张死账本 sync_base/declared_assets/published_at | **已修（261029）** | sync_base + declared_assets 桌面/移动 schema 与读写测试全删（判据改 remoteNoteIds / v3 baseline）；published_at 改单一 waterline 并删列（桌面 ALTER DROP + 移动 schema v10），待同步判据 = deleted_at > 水线；学习型墓碑不受影响 |
| Del-7 | ink 置灰导出行 + ui-metrics 失效项 + 过期注释 | 已修 | 08 §1；ui-metrics 10/10 无失效项 |
| Del-8 | DeviceState.archived | 已删 | 08 §10-4（改回收站语义）；grep 无 archived |
| Del-9 | 过程文档（Manifest V2 等） | 部分 | 08 §15-1：18 份加失效横幅；未物理删 |

## 3. 06-redesign.md 三类结论（不逐条）

| 分类 | 条目 |
|---|---|
| **已落地** | 四相内核 Plan/Apply/Commit/Finalize（08 §22–§59：E1 协议抽层+planSync+对拍、E2-1/1b/2a/2b/3 apply/commit/executePending/intentLog）；I0「收敛不删本地」（SD-01）；零变更 `publish=null`；两端共用同一内核（08 §59 删除旧 v3 实现、`roundKernel` 开关移除）；金标准对拍（pipeline/initialPublish/pullRound/plan）。 |
| **未落地** | ① §6「单一 DeviceStore」= E2-4 **已完成（261029）**：共享 `createDeviceStoreMeta` + 端口/驱动；② §5 账本收敛：phase1（v2 信封）已完成，phase2（9 本账→1 IntentLog/删字段）未做；③ §8 同步台账 UI（被用户裁决取代）；④ §7.3 性能预算表未独立成门禁（由 SD-12 perf 门禁覆盖）。 |
| **被 v4/裁决取代** | `archived` 备份区（用户裁决 → 复用回收站 + 云端已删除标）；M2 双写过渡（用户裁决「断代、不做双写」）；旧 v3 引擎（物理删除）；详细台账面板（用户 261028 定不做，改浮窗细分 + 设置→同步诊断）。 |

## 4. v4（07-rfc / 08 执行 / 12 验收）状态

> 执行设计（E3-1 账本收敛 phase1/phase2、E2-4 单 DeviceStore 分阶段、Del-6 死账本）见 **`docs/SYNC-STATE-CONVERGENCE.md`**（261029）。

- **计划**：07-rfc 的 E1/E2 已被 08 §22–§59 逐轮执行；**E3-1 phase1 已完成（261029）**：持久化 state 收到 v2 信封（9 本账 + assets/hashCache）+ 旧格式单向迁移，引擎读写未改；**E2-4 已完成（261029）**：桌面/移动 DeviceStore 决策与映射收进 core `createDeviceStoreMeta` + 端口/驱动薄壳，conformance 改单实现契约（移动 21 + mixed 3），旧移动 saveState 删除。**E3-1 phase2a 已完成（261029）**：持久化收敛到 v3 类型化 IntentLog（records 判别联合）+ v1/v2 单向迁移，引擎仍消费 DeviceState 投影（phase2b 让引擎直接消费 records **经复核裁决不做**：9 本账 188 处非测试引用 / 17 文件、其中 6 本每次 load 由 DB 重新推导、写侧一处不减 ⇒ 净收益≈0 而风险最大，证据见收敛文档 §1.3c；其残项已做：cloud-deleted 失效判据单点 + 账本⇄records 穷尽性 tsc 护栏）。**Del-6 已完成**：sync_base/declared_assets/published_at 三账本全部收口（published_at 改 waterline 并删列，桌面+移动）。
- **12 验收**：真机 ✅（并复现 SD-03，已修）；v3 vs v4 同负载 A/B「不慢」（6 轮中 5 轮更快、首传持平，12 §2）；真桶压测 ✅（六轮 150s→79s、GET 1045→30，12 §3）；多端并发**数据面 PASS / 体验面 P1 已修**（锁争用 17% → 等锁 10s+退避重试，12 §5/§7）。
- **12 §5 剩余**：① 锁争用**已修**；② epoch-mismatch 入口**已修**；③ 空基线+非空云端「保持默认」**已裁决**；④ deferAssets 默认值**已裁决保持现状**；⑤ 上传侧有效在飞≈4.9/12、`report.deletedObjects` 未计 stale 清理、GET 长尾 ⇒ **P2/P3 未做**。

## 5. 汇总 A：仍然活着的项（按级别，附最小下一步）

**P0：无**（唯一 P0 = SD-01 已修，且 261028 晚真机/真桶复验通过，见 §9）。

| 级别 | 项 | 当前状态 / 原因 | 最小可执行下一步 |
|---|---|---|---|
| P1 | SEC-03 发布产物 | 部分：静态断言（12 项）+ 发版口径放宽 + **本机 release 出包/aapt/模拟器装机已验证**（非 debuggable + run-as 拒绝）；真实 CI 首跑未做 | 在 GitHub runner 跑一次 release job（冷缓存/aliyun 剔除/runner SDK） |
| P1 | MOB-04 长文档虚拟渲染 | 部分已在设备量化：编辑节点 5552→2202、进编辑 3351→767ms；但自研查找依赖全量 DOM，暂不切 | 若要做：先给 MobileFindBar 一条「查找时整篇渲染」路线，再切虚拟渲染并跑移动门禁 |
| P1 | CORE(10)-04 `aiProviders` 两端共用 | 未做（安全专项暂停）：移动 AI 设置仍走 Kotlin，SEC-01 门槛只在桌面 | 等安全开闸；或先在移动侧复用 `validateAiBaseUrl`（需原生桥配合） |
| P2 | DT-09 顶栏 4→1 | 已修：单一渲染点 + 槽位 Provider（净 −21 行），render 测试 5 例 | 有夹具缓存的机器补跑 1315 态快照（本机缺合成夹具） |
| P2 | DT-16 any/类型收口 | 已修：生产代码 any 35→0；全仓 src+electron 生产 0 | — |
| P2 | CORE(10)-08 契约载体 | 部分：`core/services.ts`/`lib/services.ts` 已删、两个契约装置移到 `src/testing/`；`deviceConformance.ts`（496 行）仍在 electron | 与 v4 M3（单 DeviceStore）一起收 |
| P2 | CORE(10)-09 小判据 | 已修：路径段 + TRASH_NOTEBOOK_ID 单源；describeError 判定语义不同、按裁决保留两处 | — |
| P2 | CORE(10)-11 文案当契约 | 未做：AI 错误码跨语言双写无护栏；`resourceBehaviorContract` 的中文正则断言未改 `AppError.kind` | 契约断言改 `kind`、文案另立快照；加跨语言错误码表对拍 |
| P2 | CORE(10)-13 搜索账本 | 已修：src/core/search/schema.ts 单一 DDL 来源，移动+桌面两处全部接线 | — |
| P2 | CORE(10)-14 SyncSettings | 已修：类型单源 + `normalizeSyncSettings` 两端接入 + main interval 判据单源 | — |
| P2 | SEC-04/06/08/09/11/12 | **261029 复核裁决不做**（02 §6，逐条给了功能口径理由）；SEC-13 已结（13a/f 修、13b/e 不做） | 不需再做；只有 SEC-03 真实 CI 首跑属发布正确性待办 |
| P2 | Del-6 / Del-9 清理 | **均已完成（261029）**：Del-9 物理删 18 份过程文档；Del-6 三账本收口（sync_base/declared_assets 删除，published_at 改 waterline 并删列） | — |
| P2 | SD-07 / SD-11 部分 | SD-07：空跑跳过 baseline 落盘，但 state 仍每轮全量写；SD-11：协议文档已重写、过程文档未删 | SD-07 = 合并同轮多次 `loadState/loadBaseline`；SD-11 = 物理删过程文档（需先确认 git 可达） |
| — | MOB-10 / MOB-16 / SEC-05 延期 | MOB-10 保留待议；MOB-16 已裁决不做；SEC-05 已定不做 | 仅 MOB-10 等产品点单 |

**程序化附录：2 条「未做」+ 4 条「部分」+ 9 延期（含已裁决不做/合并）**（与 §0/§1 一致；261029 第二批：DT-09/DT-16/SD-11/CORE-10-09/CORE-13/CORE-14 → 已修；MOB-16 → 已裁决不做；**261029 安全复核：SEC-04/06/08/09/11 + SEC-13b/e → 复核不做；SEC-12 → 已修（action 钉 SHA）**）

未做（2）：

- `CORE(10)-04`（P1）：aiProviders 自述两端共用，实际只有桌面用
- `CORE(10)-11`（P2）：展示文案当契约；AI 错误码跨语言双写无护栏

部分（5）：

- `SEC-03`（P1）：发布产物（静态断言就绪 + 发版口径已放宽，CI 首跑与装机未做）
- `SEC-13`（P2）：纵深防御（13a/13f 已修；13b/13e **261029 复核不做**）
- `SD-07`（P2）：空跑轮 state 全量写 + baseline 二次加载
- `CORE(09)-06`（P2）：多维表每次编辑全表重算（8 轮做了 clock/填色外提，全表口径不变）
- `CORE(10)-08`（P2）：契约载体（deviceConformance 496 行仍在 electron）

延期/裁决（9）：`SEC-05`（已定不做）· `MOB-10`（保留待议）· `MOB-16`（**261029 裁决不做**）· `MOB-18`（已裁决：并入 SEC-08/09，不单独跟）· **`SEC-04/06/08/09/11`（261029 复核裁决不做，02 §6）**。
需确认（0）：—

## 6. 汇总 B：明确延期 / 被产品裁决掉

| 项 | 谁/何时定 | 结论 |
|---|---|---|
| SEC-05 CSP/主进程 127.0.0.1 通配 | 既有决定（git 1ce3d3c2/4c2d2b49）+ 261028 复核 | 已定不做（08 §12；02 条目头） |
| SEC-04/06/08/09/11（+ SEC-13b/e） | **261029 用户口径 + 逐条功能判断（02 §6）** | **不做**：不为无法出现的场景写防御代码（SEC-04 同机进程本可直读明文数据 / 手机侧需 UUID+文件名；SEC-06「全拒」会拒掉剪贴板读取；SEC-08 出网面已被 CSP 限死；SEC-09 当前无触发路径；SEC-11 内联 PDF 是真实功能；13b 真机路径不可达；13e 日志里只有随机会话 token）。**已销**：SEC-10（文档口径）、SEC-13a/13f（+ 测试）、**SEC-12（261029 用户确认发版需求 ⇒ 全部 action 钉 SHA，已修）** |
| MOB-10 移动表格 10 置灰 + 4 死分支 | 用户 261028 裁决（08 §3/§9） | 保留、后续讨论；死分支可无视觉变化单独删 |
| MOB-16 移动入口缺失（资源页/标签管理/导出导入） | **261029 用户裁决** | **不做**；判据仍在 core（missingBody）可复用 |
| 移动表格 ⋯ 面板 29 项去留 | HANDOFF §0 待裁决① | 等用户点单 |
| 空基线+非空云端 ⇒ 本地独有进回收站 | 用户 261028（12 §5-3） | 保持默认逻辑，不引入首次接入策略选择 |
| 按需下载附件默认值 | 用户 261028（12 §5-4） | 移动新设备默认开 / 桌面默认关，现状不改 |
| 同步详细台账面板 | 用户 261028（08 §19） | 不做；改浮窗细分 + 设置→同步诊断 |
| 账本收敛「双写过渡」/旧数据兼容 | 用户 261028（08 §19） | 断代、不做双写/双读 |
| 浏览器端去留（Del-1） | 用户 261028（08 §3/§9） | 保留并完善（不删） |
| v4 E2-4 单 DeviceStore / E3 账本收敛 | E2-4 **已完成（261029）**；E3 phase1 完成、phase2 未做 | E3 phase2 为剩余项（见 docs/SYNC-STATE-CONVERGENCE.md） |
| 需设备实测类 | 各轮记录（08 §6/§15/§16 累计） | MOB-04 已量化（暂不切）；MOB-01/06 点验✅；Android release 本机出包/装机✅（CI 首跑待做）；浏览器端 headless Chrome✅；移动 6 态快照✅ |

## 7. 汇总 C：文档自身不一致（本轮已全部修正）

> 判定原则：**工作树代码 > 08 轮次记录 > 各文档状态表**。括号内「已改 · 位置」= 本轮落地位置。

| # | 原不一致 | 冲突证据 | 以哪份为准 / 本轮处置 |
|---|---|---|---|
| C-1 | 02 表把 SEC-05 列「未做」 | 条目头「261028 复核：已定不做」+ 08 §12 | 已定不做。**已改 · 02 修复状态表** |
| C-2 | 02 表 SEC-07「未做（与浏览器端去留绑定）」 | 08 §10-3 删 `Sec-Fetch-Site: none` + 统一 `isAllowedRequest`；`electron/webApiServer.ts` 注释点名 SEC-07 | 实为已修。**已改 · 02 修复状态表** |
| C-3 | 04 表同表自相矛盾（前半批量「未做」vs 后半逐条 ✅） | 前半「MOB-05 未做 / MOB-02…18 未做」，后半逐条已修 | 删前半批量行，逐条登记。**已改 · 04 修复状态表** |
| C-4 | 04 表 MOB-05「未做」 | `MobileUsheetViewer.tsx` L253/514/550 `normalizeUsheetWorkbook` + AGENTS §4 | 已修。**已改 · 04 修复状态表** |
| C-5 | MOB-03/07 轮次归属 | 00/04 记「第七轮」，08 §15 七项里没有这两项（代码/测试确实已落） | 状态按代码判「已修」，轮次标注保留「第七轮」但**不作为证据**；证据改为文件+符号（`tabPager.reducePager`/`useEditSurface`）。未回填 08（避免伪造轮次记录） |
| C-6 | 03 表缺行（只 6 条） | 08 第八/九轮已修 DT-06/07/08/11/12/13/16，表里没有 | 补齐 DT-01..16 全 16 行。**已改 · 03 修复状态表** |
| C-7 | 10 表「CORE-05/06/08/09/10… 未做」 | 08 §20 已删 services/manifest 死代码 ⇒ 05/08 部分落地 | 拆成逐条（05/08=部分，06/07/09/10/11/12/13/14 各自状态）。**已改 · 10「261028 实施状态」** |
| C-8 | 05 表 SD-03「`resetFromCloud` 仍无 UI 入口（后续）」 | 261028 晚补 epoch-mismatch 恢复入口 + 移动 `restoreFromCloud`（12 §7.2/§7.3） | 已修（两个入口）。**已改 · 05 修复状态表** |
| C-9 | 02 正文/SEC-13d 仍把 config.xml 列为待删 | 08 §3 已判「cap sync 生成、未跟踪 ⇒ 无可删」 | **已改 · 02 SEC-13d 行 + §3 D-2**（两处口径一致：无可删对象） |
| C-10 | 00 §1「60 条」vs 编号 84 条 | 00 §7 自注「只统计 02–05」；CORE(09/10) 24 条不在内 | **已改 · 00 §1 计数口径**：显式写「60 条只统计 02–05；另有 09/10 的 CORE 24 条 ⇒ 合计 84」 |
| C-11 | MOB-14 口径（197/78 vs「23 处接入」判 ✅） | 原文 197 处空 catch / 78 处「忽略」；04 表按 23 处接入判 ✅ | 改「部分」并写清「23 处已接 / 78 处口径未逐条销账」。**已改 · 04 修复状态表** |

## 8. 本轮文档改动清单（文件级，全部 .md）

| 文件 | 改动 |
|---|---|
| `docs/audit-261027/02-security.md` | 修复状态表重写（SEC-01..13 逐条 + D-2；SEC-05=已定不做、SEC-07=已修、SEC-03=部分、SEC-13a/f 状态）；SEC-13d 行改判 |
| `docs/audit-261027/03-desktop.md` | 修复状态表补齐 DT-01..16（新增 DT-04/06/07/08/09/11/12/13/15/16 行） |
| `docs/audit-261027/04-mobile.md` | 删除批量「未做」自相矛盾行；MOB-01..18 逐条（MOB-05/11/14=已修/已收口/已销账，MOB-04=部分，MOB-10/16=延期，MOB-18=需确认） |
| `docs/audit-261027/05-sync-data.md` | 修复状态表重排（SD-01..13）；SD-03 补 261028 晚恢复入口；SD-06 指向 `SYNC-DEVICE-CONTRACT` §5；SD-06 正文两行过期结论改判；SD-07/SD-11 改「部分」 |
| `docs/audit-261027/10-core-services.md` | 「第四轮实施状态」改为「261028 实施状态（逐条对账）」：CORE-01..14 全列（06/07/12 已修；05/08/09/10 部分；04/11/13/14 未做）；契约装置从 `src/core/` 移到 `src/testing/` 的引用同步 |
| `docs/audit-261027/00-executive.md` | §0 数字快照更新（491/3110/12、全量 ≈24s）+ §6 对账行同步；§1 显式写 60 vs 84 口径；§8 索引补 11/12/13 |
| `docs/audit-261027/13-audit-status.md` | 本文件（由临时盘点落地，自包含、带采样时间与逐条证据） |
| `docs/SYNC-DEVICE-CONTRACT.md` | §5 新增「261028 对账」列：8 条逐条判定（仍漂移 1 / 有意保留 4 / 已对齐 3）+ 最小下一步；头部范围说明同步 |

> 未改：`AGENTS.md`（SEC-10 文档对齐由安全批负责）、`HANDOFF.md`、代码/测试/配置。

## 9. 设备级验证（261028 晚，Lead 执行；本轮唯一运行态证据）

> 口径：设备 = `lake_gate`（实际 serial `emulator-5562` / CDP 9336）；本批 APK = 当前工作树 2026-10-29 09:44 构建（release APK 为 09:34 构建）。设备级验收只跑受影响态/屏（AGENTS §3#21②），不是全量门禁。

| 项 | 操作 | 结果 |
|---|---|---|
| 构建/夹具 | 重装当前工作树 APK → `pm clear` → 重灌 gate 夹具 | 完成 |
| 移动快照 6 态（`check:mobilesnap`） | 首跑因夹具 id 变化导致 `home-doc` 指纹变（元素 1996 不变）⇒ 按 AGENTS §3#21③ **重烤基线**后重跑 | **连跑 0 差异** |
| MOB-01 返回键关浮层 | `CreateSheet` 打开（`.mb-sheet--create`）→ `adb shell input keyevent 4` | 浮层消失、仍在 MainActivity ⇒ **通过** |
| MOB-06 purge 清资产 | 新建文档 + `run-as` 造 `files/note-assets/<id>/a.png` → `bridge.purgeTreeItem` | 资产目录消失、行消失 ⇒ **通过** |
| 移动「从云端恢复」入口（SD-03 / 12 §7.3） | 设置→同步设置查看入口；云同步关闭态 | 按钮可见；关闭时 `disabled` + title「云同步已关闭：不会联网」⇒ **通过** |

**261029 第二批设备级（Lead）**：

| 项 | 操作 | 结果 |
|---|---|---|
| SEC-03 本机 release 出包 | `gradle assembleRelease`（JDK21/Gradle 8.14.3）| BUILD SUCCESSFUL 2m3s；APK 34,430,040B sha256 d1eb2b91…470b20b9 |
| SEC-03 aapt 断言 | `aapt dump badging` / `xmltree AndroidManifest.xml` | 无 application-debuggable；apksigner CN=Android Debug；`check-android-release-config --apk` 13/13 |
| SEC-03 装机冒烟 | `adb install -r release apk` → 启动 | 启动渲染首页；`run-as` 返回 `package not debuggable` ⇒ **通过** |
| MOB-04 A/B | lake_gate 500 块/200 图；虚拟渲染 ON/OFF | 编辑节点 5552→2202、进编辑 TaskDuration 3351→767ms（−77%）；只读节点/打开耗时不变 ⇒ **量化完成，暂不切**（查找依赖全量 DOM） |
| 移动最终构建复验 | 重装 debug APK（还原 disableVirtualRendering:true）→ `pm clear` → 重灌夹具 → 重烤基线 | 6 态 **0 差异**；返回键关浮层✅、设置→同步设置「从云端恢复」入口可见（云同步关闭态 disabled+理由）✅、`getCloudState`=unconfigured（测试 S3 配置已清）✅ |
| 设置「关于」版本口径 | 文案改「同步内核 v4（plan→apply→commit→finalize） · 协议 v3（pointer + 内容寻址索引）」→ 重装 APK | 设备内文本已核对；`check:mobilesnap` 6 态仍 **0 差异**；`check:mobileui` 通过 |
| 移动 23 屏走查 | `drive.mjs 9336 mobile-walkthrough.mjs`（冷启动；本轮修走查装置：keep-alive 下按可见入口导航 + 进入知识库后开/合文档树抽屉） | **分轮累计 21/23 屏至少一轮通过**（单轮最多 15/23；home×3 / notebook-workspace / doc-0..4 / quicknote-editor / doc-outline / doc-note-info / settings 及 8 个子页）。`doc-history` 与 `notebook-icon-sheet` 从未通过：走查 `goHome` 无法关闭 NoteInfo 浮层后连带卡住；失败时 App 仍有返回/编辑、无 console error ⇒ **装置债，非产品报错**，下一步补 `goHome` 的 NoteInfo 关闭分支即可 |
| 走查 nit | `quicknote-editor` 探针 | 1 处 smallTap：`.qn-tag-add` 93×28（<44 触达阈值；既有产品 nit，非本批引入） |
| S3Settings 三处定义 | core/syncUtils、src/lib/types、electron/storeTypes 各一份 → core/syncUtils 单一来源，lib/storeTypes 改 re-export | tsc 0；settings/s3Form/s3ConfigTransfer 定向 26 例通过 |
| 移动文档内查找接内核（MOB-04 前置） | `MobileFindBar` 内核优先：`editor._$commandUnderlay._renderer.getService({value:'ISearchService'})` → `onSearch` → `count`/`jumpTo`；取不到降级 DOM | 设备实测：编辑态输入「查找」→ **1/3**（内核高亮：当前红/其余黄）→ 下一个 **2/3** → 关闭正常；`kernelFind.test.ts` 4 例 + `MobileFindBar.render.test.tsx` 5 例 |
| 桌面 42 态快照 | 需要 `$HOME/Library/Caches/lakex-local-notes-css-audit/fixture` | **未跑：本机无合成夹具缓存**（DT-09 声称 DOM 构成不变 + render 测试四态等价；建议在有夹具的机器补 1315 态） |

**未做/未取证**：真实 CI 首跑（SEC-03）、桌面全量 42 态快照（缺夹具）、浏览器端在用户日常浏览器（headless Chrome 已过）。

---

### 方法与局限

- **本轮只改 .md**：未改代码/测试/配置/依赖；未跑全量 `npx vitest run`、未起 Electron/模拟器（设备级验证由 Lead 执行，见 §9）。本会话实跑过 `npx tsc --noEmit` = **exit 0**（261028 21:3x，用于确认被记录的代码状态自身可编译）。
- **采样**：2026-10-28 21:15–21:30（Asia/Shanghai），工作树 `master @ ea576a80` + 未提交改动（采样期间并行工作流仍在改，`git status --porcelain` 从 333 → 370 项）。行号为采样时点 ⇒ **定位以「文件 : 符号」为准**。
- **判定规则**：「已修」= 至少一条代码/测试证据（文档自述不算）；只有文档自述、缺运行态证据的（SEC-03 装机）降为「部分」；测试计数一律引用 `08`/`HANDOFF` 并注明日期，本文不自行产出数字。
- **可复跑**：每条都带 grep 关键词或「文件 : 符号」，下一会话可直接复核；若与并行会话的改动冲突，以当时工作树为准并更新本表。