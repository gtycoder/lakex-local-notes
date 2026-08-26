# Lake Notes 会话交接文档（2026-08-26）

> 写给完全没有上下文的新会话。本会话（2026-08-26）核心工作：**桌面图片点击放大预览 + 附件功能（桌面/移动端共享分层）**。
> 项目根：/Users/admin/file/local-lake/lake-notes-electron。先读 AGENTS.md（核心原则）+ 本文件 + docs/TODO.md。
> 分支：feat/attachments-image-preview（**7 个提交，未合并**，待用户验收）。

## 1. 任务目标（本会话，用户已确认的 scope）

1. **桌面端图片点击放大预览**：单击放大 + 画廊 + 滚轮缩放/拖拽，Esc/背景关闭
2. **附件功能**（桌面完整 + 移动端一并接入，共享分层）：
   - Lake **原生 file 卡片**（用户确认，不冗余进文档——卡片 value 只存引用元数据，文件本体落盘 note-assets/{noteId}/{file}，与图片同构）
   - 附件大小**可配置**（maxAttachmentBytes：25/50/100 MiB 档位，默认 25；协议上限 100MiB）
   - 桌面**方案 B 预览**：PDF embed 内联 / 音视频 audio/video 内联 / 其他类型系统应用打开 / 在文件夹中显示
   - **移动端**：file 卡片点击 → blob 内联预览（复用同一 overlay）+ navigator.share 分享
3. **S3 上传**（用户问是否断点续传，参考思源 dejavu 后确认）：
   - **不做 Multipart/断点续传**（思源也只是整对象 PutObject + 幂等重传；我们上限 100MiB 远低于 5GB 单对象上限）
   - **做流式上传**（桌面 fs.createReadStream + 显式 Content-Length）+ **HEAD 存在性探测**（替代整对象 GET 判存在）

## 2. 已完成（7 commits，全部在 feat/attachments-image-preview）

| commit | 内容 |
|---|---|
| a2e5009 | 附件共享核心层 + 上传链路 |
| 662f632 | 流式上传 + HEAD 探测 |
| eef1c43 | 图片点击放大预览（ImageLightbox） |
| 1399d24 | 附件打开/预览（桌面方案 B） |
| 8be4020 | 移动端附件接入 + MIME 收敛 |
| 806a7bd | 七牛兼容性实测脚本 |
| 4e2546c | isNoSuchKey 兼容 HeadObject NotFound |

### 2.1 共享核心层（src/core/，桌面/移动端共用）
- **assetNaming.ts**：资产命名/引用提取单一事实源。ASSET_NAME_RE 覆盖图片+附件扩展名（{13ts}_{8hex}.{ext}，任意 ≤10 位小写字母数字扩展名）；buildAssetFilename/mimeTypeForFilename/extractAssetRefs。storeUtils re-export 保持旧 import 面
- **fileCard.ts**：Lake file 卡片 value 解析/构建/扫描（纯函数）+ 类型分流（fileKindOf：pdf/audio/video/document/archive/other）+ formatFileSize
- **storeLimits.ts**：MAX_ATTACHMENT_BYTES=100MiB（协议上限）、DEFAULT_MAX_ATTACHMENT_MB=25、档位 [25,50,100]
- **settings.ts**：maxAttachmentBytes（localStorage 本地偏好，不参与同步）

### 2.2 上传链路（非图片不再 base64 内嵌）
- resourceUpload.ts：非图片 File → native.uploadResource 落盘资产（原 base64 内嵌已删除）
- resourceRepository.ts：upload() 按字节嗅探分流——非图片格式走 attachmentOutput（保留原扩展名、协议上限校验）
- **IPC bytes 改 Uint8Array**（原 number[] 对 100MiB 附件内存爆炸；跨 IPC 结构化克隆高效）
- 移动端 bridge.uploadResource 复用 buildAssetFilename 命名（两端文件名互认）

### 2.3 流式 + HEAD（syncEngine 共享引擎）
- S3Store 可选方法：exists(key)（HEAD 判存在）、putObjectStream(key, size, open)（流式上传）
- scanLocalAssets：HEAD 优先探测 + 流式优先上传；端口不支持走字节路径回退（移动端零改动）
- ObjectStore.headObject（HeadObjectCommand）+ putStream（Body=Readable + **显式 ContentLength**，规避 aws-chunked）
- syncAdapters：openLocalAssetStream（fs.createReadStream）+ adapter 实现
- **sync.test mock 需支持 HeadObjectCommand + 流式 body**（collectStream）

### 2.4 图片点击放大预览
- **关键发现**：Lake 内置 allowClickToMaximize 在该构建**未传导到渲染层**（实测 o2e 组件收不到该 option，点击不派发 previewImgs）——**不要依赖 envAdapter.previewImgs**
- 实现：imagePreview.ts 模块级单例控制器（open/close/navigate + 订阅）+ attachImagePreviewClick(host) DOM 捕获监听 img.ne-image **双击**，收集宿主内全部图片（画廊）
- **交互（用户 2026-08-26 晚确认调整）**：双击触发（单击留给选中/改图片大小，防误触）；背景用 backdrop-filter blur(14px) **思源式模糊**（非全黑遮罩）；点击非图片/非工具栏区域关闭（图片上单击仅重置缩放）
- ImageLightbox.tsx：Portal 全屏预览（滚轮光标为中心缩放、拖拽平移、←/→ 切换、Esc/背景/按钮关闭）
- 挂载：桌面 EditorTab（编辑/锁定态）+ 共享 LakeEditor（移动端）

### 2.5 附件打开/预览（桌面方案 B）
- IPC：open_attachment（shell.openPath）/ show_attachment_in_folder（shell.showItemInFolder），noteId+filename 双段安全校验
- assetServer MIME 扩展（pdf/office/音视频/压缩包）——内联预览依赖正确 Content-Type
- attachmentPreviewController.ts：控制器 + attachFileCardClick 宿主监听
  - **file 卡片 DOM 形态**：inline 卡片 .ne-card-file（图标/文件名/大小芯片），**无 href 不可点击**——src 只能从 **React fiber 的 cardData**（getSrc/getName/getSize）读取，href 兜底
- AttachmentPreview.tsx：PDF embed / audio/video / 其他类型信息面板；工具栏「用系统应用打开 / 在文件夹中显示 / 关闭」（平台动作注入式）

### 2.6 移动端
- LakeEditorPrefs.attachment：resolveDisplayUrl（本地字节→blob URL）+ onOpenAttachment（系统应用打开）；桌面缺省走 native
- **移动端实机验证完成（2026-08-26，小米 133ee490 + CDP 9295）**：
  - file 卡片显示修复：cardBlobInject 扩展支持 file 卡片（src=canonical 127.0.0.1 手机不可达 → Lake 渲染
    ne-error-tips「文件上传失败」→ 注入本地 blob，卡片正常显示图标/名称/大小，errTips 0；保存 restore 还原）
  - 系统应用打开：原生插件 OpenFilePlugin（ACTION_VIEW + FileProvider，MainActivity 注册）；
    附件预览统一「打开」面板（PDF/文档/音视频/其他全部系统应用，不再内联/分享）——实测系统「打开方式」选择器弹出
  - 沉浸顶栏：AttachmentPreview 打开 SystemBars.setStyle(Dark)（深色背景白图标），关闭恢复 Light
  - 保存不污染：file 卡片 blob 纳入 blobToCanonical + restore()（明文/URI 编码/带参三形态），blobRestore 回归测试
  - CSP：桌面+移动端 connect-src 补 blob:（fetch(blob) 根因）；两端 transformIndexHtml 改正则强替换（vite8 占位符丢失）
  - 弃用分享面板（Android WebView 无 navigator.share），卸载 @capacitor/share
- 上传方向：共享 uploadLakeResource → lakeNative.uploadResource → bridge 落盘，**零额外改造**

### 2.7 七牛实测（scripts/verify/qiniu-stream-head-verify.mjs）
- 流式上传（2MB Readable + ContentLength）OK / HeadObject 存在 200 / 缺失 404 OK / GET 回读一致 OK
- **isNoSuchKey 修复**：七牛 HeadObject 缺失返回 name=NotFound, message=UnknownError（GetObject 是 NoSuchKey）——旧逻辑把缺失当真实错误，scanLocalAssets 中断导致 manifest.assets 变空。已修（name 判定加 NotFound）
- 端到端同步验证：HEAD MISS → put-stream 83B → manifest.assets 含 PDF（filename/size/hash）→ S3 对象确认

**测试基线：705 passed | 1 skipped**（基线 676 + 新增 29：assetNaming/fileCard/imagePreview/attachmentPreviewController/syncEngineStreaming/isNoSuchKey/附件上传路径）。

## 3. 待办 / 已知未做

1. **移动端实机验证**：手机连接后走构建流程（vite build --config vite.mobile.config.ts → cap sync android → gradle → adb install），验证 file 卡片点击预览/分享、附件上传
2. **file 卡片插入入口实测**：Lake 斜杠菜单「本地文件/本地视频/本地音频」→ 文件选择器 → createUploadPromise 走附件落盘（代码路径已通，未实测 UI 插入）
3. **音视频内联预览实测**：PDF 已实测（embed + 正确 MIME）；音频/视频未实测（机制相同，建议造个小 mp3/mp4 验证）
4. **桌面设置面板 UI**：maxAttachmentBytes 档位选择器未加（配置字段已通，UI 待补）
5. **「在文件夹中显示」实测**：IPC 已通（shell.showItemInFolder），未实测点击
6. 附件大小上限后续放宽（>100MiB）时，需同步调 MAX_ATTACHMENT_BYTES 与 syncEngine 下载上限

## 4. 踩坑记录（本会话新增）

1. **Lake 内置 allowClickToMaximize 无效**（该构建 option 未传导到渲染层）——图片预览走 DOM 监听，别碰 envAdapter
2. **file 卡片 inline 形态无 href**——src 从 React fiber cardData 读（fiber key 在 .ne-card-file 芯片上，不在 ne-card 根）
3. **七牛 HeadObject 缺失 = name:NotFound**（message 是 UnknownError）——isNoSuchKey 必须按 name 判
4. **macOS 文件系统大小写不敏感**：attachmentPreview.ts 与 AttachmentPreview.tsx 冲突 → 控制器改名 attachmentPreviewController.ts
5. **run_code 模板字面量**：代码字符串里的反引号/中文引号会 parse error（HANDOFF-260823 第 6.7 条再现）——用 bash heredoc（'EOF' 定界）或数组 join 或 write 工具
6. **vite dev server GPU 崩溃**（HANDOFF-260823 第 4.5 条再现）：重启即可；窗口被遮挡时 CDP Input 点击不生效（visibilityState hidden），需真实用户操作或 osascript activate
9. **CSP object-src 'none' 拦截 PDF embed**：主进程日志 "Loading plugin data ... violates CSP: object-src 'none'"——PDF 预览空白、音视频同理（media-src 缺本地资产源）。已修（vite.config.ts object-src/media-src 放行 127.0.0.1:*）
10. **vite8 transformIndexHtml 占位符丢失**：transform 收到的 html 里 %VITE_CSP% 已被处理成实际值，字面 replace 不匹配 → 旧 CSP 残留。必须用正则强替换 CSP meta content
11. **contextBridge 暴露对象属性只读**：window.lakeNative.openAttachment = ... 静默失败（无异常），无法用 monkey-patch 观察 IPC 调用——验证按钮链路改用渲染进程 console.log（进主进程日志）
12. **PDF 内嵌预览空白 = webPreferences.plugins 默认 false**（electron.d.ts 注释确认）：<embed> 插件渲染被禁用，Chromium PDF viewer 不工作（iframe 也一样——内嵌 PDF 都走插件/扩展渲染）。修复：main.ts webPreferences.plugins: true。注意 Electron 43 类型里没有 pdfViewerEnabled（别加）
13. **CSP frame-src**：iframe 加载本地资产 URL 需 frame-src 放行（默认 fallback default-src 'self'=1421）
14. **附件 filename 字段语义 = 展示名**：uploadResource 返回 filename 用原始文件名（Lake 卡片 name 展示）；磁盘/URL/同步用 URL 里的生成名（孤儿登记必须用 URL 末段，不能用 filename）
7. **class 成员末尾不能有逗号**（写新方法时注意）
8. **Uint8Array 跨 IPC**：structured clone 高效；number[] 对 100MiB 附件内存爆炸

## 5. 关键命令

```bash
export PATH=$HOME/.nvm/versions/node/v24.18.0/bin:$PATH
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit && npm test -- --run        # 705 passed | 1 skipped
# 桌面 dev（CDP 9222）
LAKE_CDP_PORT=9222 npx vite --port 1421
bash scripts/cdp-util/cdp-eval.sh 9222 'expression'
# 七牛兼容性实测
node scripts/verify/qiniu-stream-head-verify.mjs
# 移动端构建
npx vite build --config vite.mobile.config.ts && npx cap sync android
```

## 6. git 状态

- feat/attachments-image-preview 分支，7 commits（a2e5009 ~ 4e2546c），基于 master（0224144）
- 未合并未推送，等用户验收
- 工作区：prototype/（.gitignore 已加，勿提交）