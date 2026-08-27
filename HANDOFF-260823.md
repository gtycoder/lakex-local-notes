# Lake Notes 交接文档（2026-08-23）

> 写给完全无上下文的新会话。本会话核心成果：移动端媒体/附件链路全面修复 + 本地资源服务器架构落地，
> 已合并到 master 并推送 gitee 远程。

## 1. 任务目标

- **分支 `feat/mobile-editor-dock` 原始目标**：移动端编辑 app 化——底部 dock 工具栏（悬浮输入法上方）、
  大纲/快捷切目录、编辑态适配手机屏。
- **本轮扩展目标**：解决移动端媒体/附件链路（图片空白、音频/视频不能播、进度条、附件预览弹窗），
  架构上从「blob 注入」切换到「本地资源服务器 + canonical URL」（与桌面端统一）。

## 2. 分支与版本

- 分支 `feat/mobile-editor-dock` 已 **merge 到 master 并 push**（90ecb09..b070192，gitee）。
- 测试基线：**706 passed | 1 skipped**；tsc 全绿；Android 编译通过。
- 当前 master HEAD：`b070192 refactor(mobile): 自检优化……`

## 3. 已完成内容（按模块）

### 3.1 本地资源服务器（核心架构，替换 blob 注入）
- **移动端 `android/.../AssetServer.java`**（新增）：ServerSocket 监听 127.0.0.1:19876，
  流式服务 `FilesDir/note-assets/{noteId}/{file}`（与桌面 note-assets 同构）；支持
  Range（206/416）、CORS、MIME 覆盖、目录穿越防护、4 线程 daemon。
- **桌面 `electron/assetServer.ts`**：补 Range 支持（206 + Accept-Ranges）。
- canonical URL 手机本地可达 → Lake 原生渲染图片/附件，**移除全部 blob 注入**：
  `src/mobile/cardBlobInject.ts` / `blobInject.ts` / `blobRestore.test.ts` 已删除。

### 3.2 移动端页面 scheme http
- `capacitor.config.ts` `server.androidScheme: 'http'`——页面 origin 从 https://localhost 改
  http://localhost，消除「https 页面加载 http 资源」的混合内容（媒体被 WebView 拒）。
- 代价：origin 变化 → IndexedDB/localStorage 数据隔离（手机本地数据需重新配置 S3 同步）。

### 3.3 媒体播放（音频/视频）
- `lakeRuntime.ts`：video/audio 插件配置 `createUploadPromise`（此前缺失 → 上传走默认端点失败）。
- **audio 卡**（Lake 原生音频卡）：`allowAudioPlayer: true`（默认 false 是语雀版权保护 → 渲染成链接）、
  上传返回 `audioId=canonical`、`queryAudioUrl` 返回 canonical；播放兜底（见 3.5）。
- **Range 支持**：浏览器 seek 需要 206；修复 Java `Range: bytes=start-` 的 Content-Length=0 bug。
- **MIME 覆盖**：Android MimeTypeMap 的 wav→audio/x-wav WebView 不认，补标准音视频 MIME 表
  （与桌面 MIME_MAP 对齐）。

### 3.4 附件（file 卡）点击
- 媒体附件（音频/视频）→ 应用内嵌播放 overlay（AttachmentPreview 内联 audio/video）；
- 非媒体（PDF/Office/zip）→ 直接系统应用打开（去预览弹窗）；
- `ne-card-hovered` 残留清理（点击任意位置 pointerdown 清理，两端共用）。

### 3.5 播放兜底（`lakeRuntime.ts` tryEnsureAudio）
- 编辑器就绪后重试（最长 ~20s）：audio/video 元素 error（server 启动竞态）→ 重载；
- viewer（只读）audio 卡无 onTranscodeSuccess → 直接 setAudioInfo(url)+sync(true)+rerender；
- 无媒体卡文档前 5 轮等待后停止（避免白跑）。

### 3.6 小记（quick notes）
- 图片落盘 `note-assets/quick-notes/{id}/{file}`，canonical 直显（列表缩略图/编辑预览），
  BLOB 表保留为同步字节真相；启动时幂等迁移。

### 3.7 共享逻辑（桌面/移动端）
- `core/assetUrl.ts`：`localAssetHttpUrl`（canonical URL 生成）、`parseLocalAssetUrl`（解析）。
- `core/assetNaming.ts`：`isMediaFilename`（媒体判定）。
- `attachmentPreviewController.ts`：`attachFileCardClick`、`createCardHoverResidueCleaner`。
- 平台实现（语言不同语义对齐）：AssetServer Range/MIME/CORS（Java vs TS）、URL 协议、页面 scheme。

## 4. 关键文件

| 文件 | 说明 |
| --- | --- |
| `android/.../AssetServer.java` | 移动端本地资源服务器（Range/MIME/CORS/HEAD） |
| `electron/assetServer.ts` | 桌面资源服务器（Range 支持） |
| `src/features/editor/lakeRuntime.ts` | video/audio 配置 + 播放兜底（两端共用） |
| `src/features/editor/LakeEditor.tsx` / `EditorTab.tsx` | 附件点击（媒体内嵌/非媒体系统打开） |
| `src/core/assetUrl.ts` / `assetNaming.ts` | 共享 URL 生成/解析、媒体判定 |
| `capacitor.config.ts` | androidScheme http |
| `vite.mobile.config.ts` | CSP（img/media/connect-src 放行 127.0.0.1） |

## 5. 当前问题

- **视频大播放三角**（video 未播放时原生 controls 的大播放按钮）：用户觉得不美观，但本次已回退优化
  （恢复原生 controls），**用户计划后续用多模态模型处理**——不要重新改（用户明确回退过）。

## 6. 下一步计划

- 移动端 UI 细节打磨（多模态模型处理视频大三角）。
- 一般待办见 `docs/TODO.md`；AGENTS.md 的项目规则仍适用。
- 手机测试环境：serial `50950385`（小米），S3 已配置 `ab-test-verify` 前缀。

## 7. 踩过的坑（重要！新会话必读）

1. **Lake 音频卡机制**（反编译 lakex dist）：
   - `allowAudioPlayer=false`（默认，语雀版权）→ 卡渲染成链接，点击跳系统浏览器打开附件 URL；
   - 上传结果需带 `audioId`（handleUploadSuccess 读 video_id/audioId 作播放源 id）；
   - 播放 URL 靠 `queryAudioUrl`（配置）或 queryURL 轮询（应用无此端点）；
   - **viewer（只读）实例无 onTranscodeSuccess**，需 setAudioInfo(url)+sync(true)+rerender 三者齐。
2. **混合内容**：移动端页面 https://localhost + `<audio>/<video>` 加载 http://127.0.0.1 = 混合内容
   → WebView 媒体管线拒绝（网络 206 成功但 SRC_NOT_SUPPORTED）；img 宽松所以图片正常。
   解法：androidScheme http（页面变 http）。**不要用 blob 绕**（用户明确反对，要求用附件服务能力）。
3. **Range 请求**：浏览器 seek 需要 206；**Java `Range: bytes=start-`（end 未指定）响应
   Content-Length=0**（end 保持 -1）→ 媒体拿到 0 字节 SRC_NOT_SUPPORTED（video 13MB 触发，
   audio 小文件走完整请求不触发）。
4. **MIME**：Android MimeTypeMap 的 wav → audio/x-wav（WebView 不认）→ 需覆盖为 audio/wav。
5. **isDesktop() 误判移动端**：移动端也映射 window.lakeNative → isDesktop() 返回 true。
   移动端平台判定用 `window.Capacitor.isNativePlatform()`。
6. **Lake 配置项 generateDisplayUrl 无效**（内核不消费）——不要用它做显示 URL 转换。
7. **vite8 CSP 占位符丢失**：transformIndexHtml 收到的 html 里 %VITE_CSP% 已消失，需正则替换
   （vite.config.ts + vite.mobile.config.ts 都有此修复）。
8. **七牛 Kodo S3**：连接测试必须 ListObjectsV2（HeadBucket 对存在的桶也 404）；
   forcePathStyle=false 正确；endpoint https://s3.cn-north-1.qiniucs.com。
9. **androidScheme http 后 IndexedDB origin 隔离**：手机本地数据（sql.js 快照/S3 配置）在新 origin
   不可见 → 需重新配置 S3 同步（开发数据可重建）。
10. **CDP 调试**：移动端 `adb forward tcp:9295 localabstract:webview_devtools_remote_<pid>`
    （app 重启后需重 forward）；桌面 `LAKE_CDP_PORT=9222 npx vite --port 1421`。
11. **run_code 模板字符串陷阱**：代码里含 `${}`/反引号会解析失败——用数组 join 或 write 脚本文件。
12. **webPreferences.plugins: true** 桌面 PDF 内嵌必需（默认 false）。

## 8. 环境与调试速查

- 移动端构建：`npx vite build --config vite.mobile.config.ts && npx cap sync android && cd android &&
  JAVA_HOME=.../jdk-21.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  ./gradlew assembleDebug` → `adb -s 50950385 install -r .../app-debug.apk`。
- 桌面 dev：`LAKE_CDP_PORT=9222 npx vite --port 1421`（主进程代码改动需重启 dev）。
- Node 24：`$HOME/.nvm/versions/node/v24.18.0/bin`。
- 数据目录：移动端 FilesDir/note-assets（run-as com.lakenotes.mobile 查看）；桌面
  ~/Library/Application Support/lake-notes-dev。
