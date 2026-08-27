# Lake Notes 安卓端技术方案（2026-08-23）

> 供架构评审/GPT 优化咨询用。当前移动端「本地优先」架构：canonical URL + 本地资源服务器，与桌面端统一。

## 一、整体架构

- **Capacitor WebView**（页面 origin: http://localhost）：React 应用 + Lake 编辑器（lakex 卡片渲染）+ bridge（JS 桥：sql.js DB + S3 同步）
- **AssetServer.java**（本地 HTTP 资源服务器）：ServerSocket 127.0.0.1:19876，4 线程 daemon，
  流式服务 FilesDir/note-assets/{noteId}/{file}，支持 Range/206、MIME、CORS、HEAD、目录穿越防护
- **本地数据**：sql.js 全库快照 → IndexedDB；S3 配置 → localStorage + 密钥 → IndexedDB（加密）；
  资产文件 → FilesDir/note-assets（与桌面 userData/note-assets 同构）

## 二、核心设计

1. **canonical URL 本地可达**：http://127.0.0.1:19876/{noteId}/{file}（与桌面一致），
   Lake 原生渲染图片/媒体/附件，无 blob 注入（存储零污染，value 始终 canonical）
2. **页面 scheme http**（capacitor androidScheme: http）：避免 https 页面加载 http 资源的混合内容
   （WebView 媒体管线会拒 audio/video，img 宽松所以图片正常）
3. **媒体播放**：audio/video 卡内嵌播放（Lake 原生卡 + AssetServer 提供源 + Range 支持 seek）；
   附件（file 卡）媒体内嵌播放、非媒体系统应用打开
4. **同步**：S3（七牛 Kodo）manifest v4 协议，本地为真相

## 三、AssetServer.java 实现细节

- **启动**：MainActivity.onCreate → AssetServer.start(this)（幂等静态单例）。
  new ServerSocket(19876, 8, 127.0.0.1) + 固定 4 线程 daemon 池 + daemon acceptor 线程。
  **启动开销 <10ms，不阻塞主线程**（bind 后立即返回，accept 在后台线程）
- **请求处理**：每连接一个任务，解析 GET/HEAD + Range 头，流式读文件（64KB buffer）
- **Range**：bytes=start-end / -N / start-  → 206 + Content-Range + Accept-Ranges；越界 416
- **MIME**：扩展名映射（覆盖 Android 系统表不正确的 audio/x-wav 等）+ 图片魔数嗅探兜底
- **安全**：canonical path 前缀校验（防目录穿越）、仅绑定 127.0.0.1、CORS 允许 *
- **生命周期**：进程级共享单例，daemon 线程随进程退出自动结束；不随 Activity 销毁

## 四、App 启动流程与耗时分布（约 5s）

| 阶段 | 说明 | 估算耗时 |
| --- | --- | --- |
| 系统/WebView 初始化 | Capacitor WebView 创建、加载本地页面 | 1~2s |
| JS bundle 加载 + React 挂载 | dist-mobile bundle 解析执行 | 0.3~1s |
| bridge.init | sql.js WASM 加载 + IndexedDB 快照读入 + schema 初始化 | 1~2s（主要可变耗时） |
| 资产载入 | 遍历 Filesystem 读所有已下载资产字节到内存（base64 解码） | 资产多时 0.5~2s |
| 小记图片迁移检查 | 遍历 quick_note_assets 检查文件是否落盘（幂等） | 小记多时 0.1~0.5s |
| AssetServer.start（Java） | ServerSocket bind + daemon 启动 | <10ms |
| S3 配置读取/首屏 | getS3Settings（IndexedDB 密钥解密）+ 列表渲染 | 0.1~0.3s |

**结论：5s 主要来自 WebView 初始化 + sql.js WASM/快照加载 + 资产字节载入，Java 服务本身毫秒级。**

## 五、优化方向（供 GPT 咨询）

### 5.1 启动路径（数据/JS 层，收益最大）
- **资产载入懒加载/移除**：资产字节当前同步全量载入内存（assets Map），但 canonical 显示已走
   AssetServer 读文件——内存 Map 已非必需，可移除或按需；小记迁移检查可后台异步
- **sql.js WASM 优化**：WASM 编译缓存、快照读取优化；或评估换 SQLite 原生（Capacitor SQLite 插件）
- **bundle 体积**：vite 代码分割、按路由懒加载（当前单 chunk 大）
- **首屏后置**：S3 配置读取、同步检查放首帧渲染后

### 5.2 AssetServer（Java，非启动主因但可优化）
- 当前每连接一个任务（4 线程池）——本地单用户连接少，开销可忽略
- 可评估 NIO（Selector）替代阻塞 IO（收益小）；或轻量框架（NanoHTTPD）减代码
- 缓存：文件 stat + 响应头缓存（Cache-Control immutable 已生效，WebView 磁盘缓存兜底）

### 5.3 WebView/系统层
- Capacitor WebView 初始化是系统级，难优化；可评估启动占位页减少白屏感知

## 六、关键数据点

- 资源服务器端口：19876（与桌面一致）
- 页面 origin：http://localhost（androidScheme http）
- 数据目录：FilesDir/note-assets（与桌面 userData/note-assets 同构）
- S3：七牛 Kodo（endpoint s3.cn-north-1.qiniucs.com，forcePathStyle=false）

