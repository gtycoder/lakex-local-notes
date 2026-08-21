# 图片/附件轻量协议调研（test/adhoc 分支测试）

> 日期：2026-08-22 ｜ 分支：test/adhoc（基于 master 486d519）
> 目标：验证「有没有 Lake 内核支持的、比 HTTP 更轻量（无 TCP 三次握手/四次挥手）的协议来处理图片和附件，同时兼容桌面端和移动端」。
> 证据链：探针测试 electron/lakeProtocolProbe.test.ts（11 项全过）+ lakex bundle 反编译源码行号。

## 1. 现状：本地图片走的是什么

```
store.assetUrl() ──> markdown 里写 http://127.0.0.1:19876/{noteId}/{file}
        │
        ▼
<img src> 渲染进程发起 HTTP 请求（Chromium 网络栈：TCP 三次握手 + 四次挥手）
        │
        ▼
electron/assetServer.ts（本地 HTTP 服务器，监听 127.0.0.1:19876）读磁盘返回文件
        │
        ▼
主进程 onBeforeRequest 自动补 token（LAKE_ASSET_TOKEN）
```

移动端（Capacitor 8.5 WebView）：目前 POC 阶段图片渲染未落地；S3 传输走 CapacitorHttp（原生 OkHttp），
本地 WebView 内 Lake 渲染仍会是同一套 http://127.0.0.1:19876 引用（在 WebView 里不可达，需另行方案）。

## 2. 核心探针：Lake 内核（lakex）协议白名单

lakex 闭源 bundle 反编译（lakex-editor-react-component/dist/lakex-editor-react-component.es.js）：

**L41567-41578 协议白名单 qd：**
```js
qd = ["http:", "https:", "blob:", "data:", "dingtalk:", "ftp:", "mailto:", "fleamarket:", "alipays:", "qinpai:"];
```

**L41579-41585 Jd(e)（validUrl 核心）：** 白名单前缀 或 ./ 或 / 开头 或 不含 : → 放行；data:text/html 拒绝
**L41586-41588 Yd(e)：** 不过 Jd 的 URL 被清空（sanitize 后为空串）
**L41531-41535 sanitizeImageSrc(e)：** data:image/ 直接放行，其余过 Yd
**L115605/609/654 图片渲染链：** img src = sanitizeImageSrc(generateDisplayUrl(width))

### 探针结论（11 项测试全过）

| 协议形态 | Lake 内核放行？ | 说明 |
| --- | --- | --- |
| http://127.0.0.1:19876/...（现状） | ✅ | 白名单 http: |
| data:image/png;base64,... | ✅ | sanitizeImageSrc 特判放行；编辑态 markdown 图片识别也认（L58095） |
| blob:http://127.0.0.1:1421/uuid | ✅ | 白名单 blob: |
| ./images/x.png 相对路径 | ✅ | ./ 前缀放行（基于页面 base 解析） |
| /vendor/cdn/x.png | ✅ | / 前缀放行 |
| x.png 裸文件名 | ✅ | 无冒号放行 |
| lake-asset://note/x.png 自定义协议 | ❌ 拒绝，sanitize 后为空串 | 白名单无此协议 → img src 被清空，图片不显示 |
| file:///... | ❌ 拒绝 | 白名单无 file:（Electron 渲染层也默认禁 file 跨域） |
| data:text/html,... | ❌ 拒绝 | XSS 防护 |

> **关键发现：Lake 内核原生支持 data: 和 blob: 两种零网络栈协议，拒绝自定义 scheme（除非 patch lakex）。**

## 3. 候选方案对比

| 方案 | 握手 | 持久化 | 桌面 | 移动 | Lake 白名单 | 改造成本 | 代价 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. data: URL（base64 内嵌） | 零（无网络请求） | ✅ 可持久化进 markdown | ✅ | ✅ | ✅ 原生放行 | 低（已有 ?base64=1 能力） | 体积 +33%；大图内存翻倍；markdown 变大 |
| B. blob: URL（渲染时注入） | 零（进程内对象引用） | ❌ 页面级生命周期 | ✅ | ✅ | ✅ 原生放行 | 中（渲染层读文件建 blob + 替换引用） | 每次打开需异步读文件；与复制/导出链路需验证 |
| C. 自定义协议 lake-asset:// | 零（主进程 protocol.handle 直读文件流） | ✅ | ✅ | 需原生实现 | ❌ 需 patch lakex 白名单（1 行） | 高（Electron protocol.handle + 移动端 WebView scheme 拦截 + patch） | 侵入闭源内核；移动端原生代码量 |
| D. 相对路径 ./ | 零 | ✅ | ⚠️ base 依赖 | ⚠️ base 依赖 | ✅ 放行 | 中 | 桌面/移动页面 base 不同，解析不一致 |
| E. file:// | 零 | ✅ | ❌ | ❌ | ❌ | — | 两端渲染层均禁 file 跨域 |

### 方案 A：data: URL —— 最省事、Lake 原生支持

- Lake 内核 sanitizeImageSrc 特判 data:image/ 直接放行，markdown 图片识别（L58095）也认 → **零改内核**。
- 现有资产服务器已支持 ?base64=1 返回 data URL（electron/assetServer.ts L158-185，复制到微信用）。
- 持久化形态：markdown 里直接存 data:image/png;base64,... → 完全自包含，无任何网络请求，天然无握手。
- **代价**：base64 膨胀 +33%；extractAssetRefs（孤儿检测/同步 refs）按文件名正则 \d{13}_[0-9a-f]{8}\.ext 匹配 —— data URL 里没有文件名 → 文件引用丢失语义（需要另行登记，否则孤儿清理会误删文件）。
- 大图（>2MB）内存翻倍、markdown 同步体积暴增 —— 不适合大附件，适合小图。

### 方案 B：blob: URL —— 渲染时零网络注入

- Lake 白名单含 blob: → 原生放行。
- 做法：持久化 markdown 不变（仍存 http 引用或未来 lake-asset 引用），**打开文档 setDocument 前**把本地图片经 IPC 读成 Blob → URL.createObjectURL → 替换 img src → Lake 渲染 blob URL（进程内引用，无 TCP）。
- **零握手且不膨胀**（Blob 直接引用字节，不 base64）。
- 代价：每次打开要异步读全部图片；blob URL 生命周期页面级（重开失效，需重读）；Lake 复制/预览/导出对 blob 的处理需验证（_onPreviewImage 会取 cardNode.getAllImages() 的 src，blob 可正常取）。

### 方案 C：自定义协议 lake-asset:// —— 最协议化但需 patch 内核

- 桌面：Electron protocol.handle("lake-asset", ...) 注册自定义协议，主进程直接 createReadStream 返回文件 → **请求根本不进 TCP 栈，无握手无挥手**，URL 可持久化。
- 移动：Android WebViewAssetLoader/shouldInterceptRequest、iOS WKURLSchemeHandler 拦截自定义 scheme → 同样进程内读文件。Capacitor 需要自定义原生插件（capacitor-android 已有 WebViewLocalServer，扩展可行）。
- **障碍**：Lake sanitizeImageSrc 白名单拒绝自定义协议 → img src 被清空。**解决：patch lakex**。
  - 项目已有 patch-package 机制：vendor/npm/lakex-editor-react-component/patches/（postinstall 自动应用，README 说明流程，先例 @xiangfa+mindmap+0.7.1.patch）。
  - 改动量：在 qd 数组加 "lake-asset:" 一行（L41567-41578）。
  - 需同步排查 Lake 内部其他 URL 消费点：validUrl（链接卡片）、isFullHttpURL（判断完整 URL）、isCaptureImageURL（lakeRuntime L451 需排除 lake-asset 前缀，否则 Lake 会反复下载转存本地图片）、导出/复制 HTML 路径（Yd/sanitizeUrl）。
- **这是唯一既协议级轻量又能持久化的方案，但侵入闭源内核 + 移动端原生工作量最大。**

## 4. 桌面/移动兼容矩阵

| 能力 | 桌面（Electron 43 / Chromium） | 移动（Capacitor 8.5 WebView） |
| --- | --- | --- |
| data: URL 渲染 | ✅ 原生 | ✅ 原生 |
| blob: URL 渲染 | ✅ 原生 | ✅ 原生（Android WebView / iOS WKWebView） |
| 自定义 scheme 拦截 | ✅ protocol.handle | ⚠️ 需原生插件（Android shouldInterceptRequest / iOS WKURLSchemeHandler） |
| 读本地文件 | ✅ 主进程 fs | ⚠️ Capacitor Filesystem 插件或 sql.js blob |
| 现有 HTTP assetServer | ✅ | ❌ 127.0.0.1 在 WebView 不可达（POC 未落地渲染） |

## 5. 结论与建议

**Lake 内核原生支持的零握手协议只有 data: 和 blob:。** 自定义协议（lake-asset://）需要 patch 闭源 lakex 白名单。

按「兼容两端 + 改动小 + 零握手」排序：

1. **小图/图标**：data: URL 内嵌 —— 零改动内核、两端原生支持，已有 ?base64=1 能力可复用。适合 < 200KB 图片。
2. **一般图片**：blob: URL 渲染时注入 —— 零握手、不膨胀，但需渲染层 IPC 读文件 + 每次打开重建，且要验证 Lake 复制/导出链路。
3. **长期协议化方案**：自定义 lake-asset:// + patch lakex（1 行白名单）+ 桌面 protocol.handle + 移动端原生 scheme 拦截 —— 最彻底，但侵入闭源内核、两端原生工作量最大，需评估 patch 维护成本（lakex 升级会覆盖 patch）。

> **建议**：本分支先以「方案 A/B 的可运行 Demo」验证 Lake 渲染行为（data/blob 在真实编辑器中的显示、复制、导出），确认零握手落地后，再决定是否投入方案 C 的 patch 路线。
## 6. 真实 Electron 实测（CDP 驱动，开发实例 9222）

> 方法：通过 CDP 在真实 Lake 编辑器（开发实例已打开含 10 张本地图片的文档）里，对同一张图片分别注入
> `blob:` URL、`data:` URL、`lake-asset://` 自定义协议，对比渲染结果与网络栈行为。

### 6.1 渲染结果对比

| 协议 | naturalWidth | 渲染 | 说明 |
| --- | --- | --- | --- |
| `http://127.0.0.1:19876/...`（现状基线） | 935 ✅ | 正常显示 | 走 Chromium 网络栈 |
| `blob:http://127.0.0.1:1421/uuid` | 935 ✅ | **正常显示** | 进程内对象引用，零网络请求 |
| `data:image/png;base64,...` | 2698 ✅ | **正常显示** | base64 内嵌，零网络请求 |
| `lake-asset://note123/x.png`（自定义协议） | 0 ❌ | **不显示**（img error） | Lake `sanitizeImageSrc` 白名单拒绝，与探针结论一致 |

### 6.2 网络栈量化对比

| 指标 | http（现状） | blob: / data: |
| --- | --- | --- |
| resource timing 条目 | 123 个本地图片请求（有 startTime/duration/传输记录） | **0 个条目**（不产生网络请求） |
| TCP 三次握手 | ✅ 存在（每个请求经 127.0.0.1 环路） | ❌ 不存在（进程内对象引用 / base64 内嵌） |
| 四次挥手 | ✅ 存在 | ❌ 不存在 |
| 渲染结果 | 正常 | 正常 |

> **实测结论**：blob:/data: 在真实 Lake 编辑器中渲染正常且完全不经过网络栈——这正是用户要的
> 「效果与 http 相同、但没有 3 次握手/4 次挥手」。自定义协议（lake-asset://）需先 patch lakex 白名单才能用。

## 7. 可运行的验证产物

| 文件 | 用途 |
| --- | --- |
| `electron/lakeProtocolProbe.test.ts` | 探针测试：复刻 Lake 内核白名单逻辑，11 项断言（可纳入 vitest） |
| `scripts/cdp-probe.mjs` | CDP 探针：查看当前编辑器图片渲染状态 |
| `scripts/cdp-protocol-render-test.mjs` | 协议渲染对比实测（http vs blob vs data vs 自定义协议） |
| `scripts/cdp-timing-test.mjs` | 网络栈量化对比（resource timing） |
| 本报告 | 完整调研结论 |

## 8. blob: URL 方案深度讲解（用户要求）

### 8.1 blob: URL 是什么

`URL.createObjectURL(blob)` 生成的浏览器内部 URL，形如 `blob:http://127.0.0.1:1421/uuid`。
它指向**渲染进程内存中的一个 Blob 对象**，不经过任何网络栈——没有 TCP 三次握手、没有 HTTP 请求、没有四次挥手。
生命周期与创建它的页面绑定：页面刷新/关闭即失效，需 `URL.revokeObjectURL` 手动释放内存。

### 8.2 具体怎么用（以 Lake Notes 场景）

```
持久化（不变）:  markdown 里还是 http://127.0.0.1:19876/{noteId}/{file}（文件仍在 note-assets 独立管理）
     │ 打开文档
     ▼
渲染层:  对文档里每个本地图片引用 → 经 IPC 从主进程读文件字节 → new Blob([bytes]) → URL.createObjectURL()
     │ 替换
     ▼
Lake:    setDisplayUrl(blobUrl) 注入（源码确认：只写渲染态 _displayUrl，不动文档模型）
     │
     ▼
显示:    <img src="blob:..."> 进程内直接解码，零网络请求
     │ 关闭文档
     ▼
清理:    URL.revokeObjectURL() 释放内存
```

### 8.3 为什么必须走 setDisplayUrl 而不是改 img.src

实测 + 源码确认（L116155-116168）：
- `setDisplayUrl(url)` 只写渲染态 `_displayUrl` 字段；`getDisplayUrl() = _displayUrl || cardData.getSrc()`。
- **文档模型**（cardData attrs.value.src）始终是持久化的 http 引用 → `getDocument("text/lake")` 输出不变 → **保存不会污染** ✅
- 若裸改 DOM img.src：Lake 懒加载（intersectionObserver）/ 尺寸变化会**重渲染并覆盖回 http** ❌
- 所以 blob 注入的挂点：图片组件挂载后 `setDisplayUrl(blobUrl)`（或提供自定义 `generateDisplayUrl` 回调）。

### 8.4 对比 http 优缺点

| 维度 | http（现状） | blob:（注入） |
| --- | --- | --- |
| TCP 握手/挥手 | 有（每次请求经 127.0.0.1 环路） | **无**（进程内对象） |
| 网络栈开销 | 有（resource timing 123 个请求） | 无（0 个请求，实测确认） |
| 附件独立管理 | ✅ 文件在 note-assets，markdown 只存引用 | ✅ **不变**（这是核心） |
| Lake 内核白名单 | ✅ http: | ✅ blob:（原生放行） |
| 内存 | 低（流式读盘） | ⚠️ 图片全量驻留内存 |
| 打开文档 | 快（按需懒加载） | ⚠️ 需先读全部图片字节（或按需） |
| 生命周期 | 持久（URL 即文件） | ⚠️ 页面级，每次打开重建 |
| 复制/导出/预览 | ✅ Lake 内部走 http 引用 | ⚠️ 需验证 Lake 对 blob 的预览/复制路径 |
| 缓存 | ✅ Chromium HTTP 缓存 | ❌ 无（每次重建） |
| 主进程复杂度 | 需 assetServer + token 注入 | 可去掉 assetServer（简化） |
| 移动端 | ❌ 127.0.0.1 不可达 | ✅ WebView 原生支持 blob |

### 8.5 主要风险

1. **内存驻留**：所有图片一次性进内存。10 张 2MB 图 = 20MB+ 渲染进程内存。大文档/多图场景需 LRU 或按视口懒加载。
2. **生命周期短**：刷新/重开标签页全部失效，每次打开要重建（读盘 + createObjectURL），首屏可能变慢（可并行读 + 按需注入缓解）。
3. **保存污染风险（已排除）**：源码确认 setDisplayUrl 只写渲染态，getDocument 输出不变 → 持久化安全 ✅。但必须走对注入路径，不能裸改 DOM。
4. **复制/预览链路**：Lake 的图片预览（previewImgs）取 cardData.getAllImages() 的 src（文档模型 http 引用）——预览框可能走 http；复制富文本的 HTML 里 src 也是 http。这些场景会回到 http（不影响正确性，只是不省那部分）。
5. **移动端文件读取**：移动端没有主进程 fs，需从 sql.js / Capacitor Filesystem 读字节再建 blob——链路与桌面不同，需适配层。
6. **Lake 升级兼容**：blob 注入依赖 setDisplayUrl 私有 API 形态，lakex 升级需回归验证。

### 8.6 最大好处（一句话）

**在「附件完全独立、Lake 不膨胀、持久化零改动」的前提下，把图片加载从网络栈请求变成进程内对象引用——渲染侧零握手零挥手，且桌面/移动 WebView 原生支持，不碰闭源内核。**

对比 data:（用户已否决）：data: 是"内嵌"，图片进 markdown/DB，体积 +33% 且同步体量暴增；blob: 是"引用 + 进程内对象"，文件仍独立管理，markdown 不膨胀。这正是 http 当初被选中的原因，blob 保留了这一点，只把"传输"从网络栈换成进程内。

## 9. blob 实测数据（真实 Electron 环境，文档含 107 张图）

### 9.1 同一张图：http 路径 vs blob 路径

**http 路径**（持久化内容里存的就是它）：
```
http://127.0.0.1:19876/09032fc3-25d8-4561-94ae-5b99cde53db1/1787122226116_66775a3f.png
```
- scheme: http / host: 127.0.0.1:19876（assetServer 端口）/ noteId / 文件名
- **语义：请求 → 网络栈 → 服务器读盘 → 返回**

**blob 路径**（渲染时临时生成）：
```
blob:http://127.0.0.1:1421/44d0805e-a704-4c5b-b11d-d4f408d47396
```
- scheme: blob: / host: 页面 origin / **随机 UUID**（每次 createObjectURL 都不同）
- **语义：渲染进程内存里的对象地址，直接解码，零网络**

两者指向**同一个文件**（同一张 32160 字节的 PNG），只是传输方式不同。

### 9.2 实测数字（本机真实环境）

| 指标 | 数值 | 含义 |
| --- | --- | --- |
| 单图 blob 创建 | **1.3ms** | fetch + blob + createObjectURL 一次完整流程 |
| 重建 50 次平均 | **0.49ms/次** | 每次"读图→建 blob"的成本 |
| 8 张图串行读 | 4.1ms | for 循环逐张 |
| 8 张图并行读 | **2.0ms** | Promise.all 并发 → 约 2 倍加速 |
| 8 张图总字节 | 988 KB（~1MB） | 驻留内存量级 |

> 注意：以上 fetch 走的是本地 http（assetServer 读盘）。真实 blob 方案里渲染层经 IPC 读文件后直接建 blob，**不经过网络栈**——成本只会更低。

### 9.3 你的三个问题

**Q1：驻留内存如何处置？**
- blob 数据在渲染进程内存，只有 `URL.revokeObjectURL(url)` 才释放。
- 处置策略（按需 + 生命周期）：
  1. **文档关闭时**：组件卸载（useEffect cleanup）统一 revoke 该文档全部 blob URL。
  2. **tab 切换时**：不可见 tab 的 blob 可 revoke（切回来重建）——但重建只有 0.5ms/图，成本可忽略。
  3. **大图阈值**：超过阈值（如 5MB）的图不走 blob，回退 http 流式读——避免单图爆内存。
  4. **按视口懒加载**：视口内的图才建 blob，滚出视口 revoke（对齐 Lake 自带 intersectionObserver 懒加载）。
- 实测量级：1MB ≈ 8 张图。百图文档约 10-20MB 渲染内存，可接受但需上述策略防失控。

**Q2：先读图如何并行、缓解多少？**
- 并行方式：渲染层拿到文档后 `Promise.all(图片引用.map(读文件 → blob))`，浏览器/主进程并发读盘。
- 实测：8 张图串行 4.1ms → 并行 2.0ms（约 **2 倍**）。本地 SSD 读盘是微秒-毫秒级，瓶颈不在 IO 而在调度。
- 缓解效果：文档打开总延迟 ≈ 单批最慢一张（并行）而非总和（串行）。百图文档按 8 并发分批，预计 <50ms 可全部就绪；配合按视口懒加载，首屏只建视口内几张，几乎无感。
- 主进程侧：IPC 读文件可并行（better-sqlite3/fs 都不互斥），或一次 IPC 批量读多文件减少往返。

**Q3：每次重建是什么意思？**
- blob URL 的生命周期**绑定创建它的页面会话**：页面刷新、关闭标签页、重新打开文档，内存中的 Blob 对象就没了，之前生成的 blob: URL 全部失效（指向空）。
- 所以**每次打开文档都要重新走一遍"读文件 → 建 Blob → createObjectURL"**，不能像 http 那样"URL 永远有效、浏览器自己缓存"。
- "重建"成本实测：0.5ms/图（单图），并行下百图 <50ms——**成本极低，是可接受的代价**。
- 对比 http：URL 即文件路径，永远有效，重启应用后依然能访问——这是 http 的唯一结构性优势（换来的是每次请求的网络栈开销）。

## 10. 内容链路验证（另一会话建议：先补探针再决策 canonical）

### 10.1 已完成的验证矩阵

| 链路 | 结果 | 证据 |
| --- | --- | --- |
| patch lakex 白名单 + protocol.handle + CSP | ✅ 渲染 935×430 | 真实 Lake 编辑器，与 http 一致 |
| setDocument 含 lake-asset:// → 渲染 | ✅ naturalWidth 935 | CDP 实测 |
| **编辑 → 保存 → getDocument 保留 lake-asset://** | ✅ 持久化保留 | 可编辑文档（eree）插入 lake-asset card → 编辑打字 → .lake 里 lake-asset 保留 + 编辑内容写入 |
| 持久化不触发同步/快照 | ✅ sync_state 不变 / 0 快照 | DB 检查 |
| **复制路径（clipboardHtml.normalizeImage）** | ❌ lake-asset:// 被跳过（return null） | 源码 L85-102 只认 LOCAL_ASSET_PREFIX |
| **导出路径（localAssetMdImgRe/HtmlImgRe）** | ❌ lake-asset:// 不匹配 | 真实正则测试 4 项（http 匹配 / lake-asset 不匹配） |
| **addAssetAccessToken/strip** | ❌ 只处理 http://127.0.0.1 形态 | assetPort.ts L14-44 |

### 10.2 决策结论（按另一会话建议框架）

**内容链路核心（setDocument → 编辑 → getDocument）通过** → 支持 lake-asset:// canonical。
但**复制/导出/引用识别链路不通过**：4 处 http 正则/前缀判断不认 lake-asset://。

→ **需要 AssetUrlResolver（进 core）统一处理**，否则 lake-asset canonical 会导致：
1. 复制图片到剪贴板 → 图片丢失（normalizeImage 返回 null）
2. 导出 HTML/资料包 → 漏图（正则不匹配）
3. addAssetAccessToken/strip → 不处理 lake-asset（token 语义缺失）

### 10.3 需要 AssetUrlResolver 统一的 4 处

| 位置 | 现状 | lake-asset 下需要 |
| --- | --- | --- |
| `src/features/editor/clipboardHtml.ts` L87 | 只认 LOCAL_ASSET_PREFIX | 识别 lake-asset → 转 data URL（IPC 读文件） |
| `electron/store.ts` L99-107 导出正则 ×3 | 只认 http://127.0.0.1:{port} | 识别 lake-asset 形态 |
| `src/lib/assetPort.ts` L14-44 | 只处理 http 形态 | 识别 lake-asset（token 或跳过） |
| `src/features/editor/lakeRuntime.ts` L451 isCaptureImageURL | 排除 http asset 前缀 | 排除 lake-asset 前缀（防反复下载转存） |

### 10.4 最终建议

- **方案 C（lake-asset:// canonical）可行**，核心编辑链路已验证，但需先做 AssetUrlResolver 进 core 统一 4 处识别，再全面落地（否则复制/导出会坏）。
- 移动端：同样走 lake-asset:// canonical（Capacitor 原生 scheme 拦截），解析器两端共用（core）。
- 兜底：若 AssetUrlResolver 改动风险大，可退回 **http:// canonical + blob 渲染注入**（方案 B）——存储零改动，只在渲染层注入。

## 11. 复制/导出路径改造（AssetUrlResolver 落地）

### 11.1 新增核心解析器（进 core）

`src/core/assetUrl.ts` —— 统一识别两种本地资产形态：
- http 形态：`http://127.0.0.1:{port}/{noteId}/{file}`（含 quick-notes 前缀）
- lake-asset 形态：`lake-asset://{noteId}/{file}`

API：
- `parseLocalAssetUrl(url)` → `{ space, noteId, filename } | null`
- `isLocalAssetUrl(url)` → boolean
- `lakeAssetToHttp(url, port)` → http 形态（复制路径拉 base64 用）
- `httpToLakeAsset(url)` → lake-asset 形态（渲染注入用）

### 11.2 消费点改造

| 位置 | 改动 | 验证 |
| --- | --- | --- |
| `src/core/assetUrl.ts`（新） | 解析器 | 12 项单测 ✅ |
| `src/features/editor/clipboardHtml.ts` | normalizeImage 用 isLocalAssetUrl 判定；assetUrlToDataUrlSync 支持 lake-asset → http 转 base64 | 16 项（含新增 lake-asset 判定）✅ |
| `electron/store.ts` 导出正则 ×3 | LakeSrcRe/HtmlImgRe/MdImgRe 双形态匹配 | 6 项真实正则测试 ✅ |
| `src/features/editor/lakeRuntime.ts` | isCaptureImageURL 排除 lake-asset 前缀（防反复下载转存） | 编译/边界 ✅ |
| `src/lib/assetPort.ts` | 导出 ASSET_PORT（供 lakeAssetToHttp 用） | 编译 ✅ |

### 11.3 行为语义

- **复制**：lake-asset:// 图片被识别为本地资源 → 转 http 形态 → assetServer `?base64=1` 拉 data URL → 复制自包含（效果与 http 一致）。
- **导出 HTML/资料包/.lake**：正则双形态识别 → 从 note-assets 复制文件 / base64 内嵌（lake-asset 与 http 同路径）。
- **渲染**：lake-asset:// 由主进程 protocol.handle 直读文件（零网络栈），isCaptureImageURL 不误转存。

### 11.4 质量门禁

442 passed（+assetUrl 12 / +导出正则 2 / +复制路径 1）/ tsc / core 边界 0 违规 / diff 干净。

## 12. 遗漏排查：复制到微信 / 图片下载 / 全面消费点

### 12.1 复制到微信链路（✅ 端到端验证通过）

复制路径改造后，lake-asset 图片复制到微信的完整链路：
```
lake-asset://{noteId}/{file}.webp
  → lakeAssetToHttp → http://127.0.0.1:19876/{noteId}/{file}.webp
  → assetServer ?base64=1 → sharp webp→png 转换
  → data:image/png;base64,...（微信可渲染）
```
**实测**：webp 图片经此链路返回 `data:image/png`（463KB），转换完整。✅

### 12.2 图片下载流程（✅ 无影响）

`downloadRemote`（resourceRepository L47-51）强制校验 `http:`/`https:` 协议，
lake-asset:// 会被拒绝（`parsed.protocol !== "http:" && !== "https:"` → 抛错）。
且 `isCaptureImageURL`（lakeRuntime L451）已排除 lake-asset 前缀 → Lake 不会对 lake-asset:// 触发下载转存。✅

### 12.3 全面消费点排查结论

| 消费者 | 是否受影响 | 说明 |
| --- | --- | --- |
| 复制 clipboardHtml | ✅ 已改 | isLocalAssetUrl 判定 + lakeAssetToHttp 转 base64 |
| 导出 store 正则 ×3 | ✅ 已改 | 双形态匹配 |
| isCaptureImageURL | ✅ 已改 | 排除 lake-asset |
| assetPort token | ✅ 无影响 | lake-asset 不需 token（协议 handler 直读文件） |
| 图片下载 downloadRemote | ✅ 无影响 | 只认 http/https，lake-asset 进不去 |
| store.assetUrl() 生成 | ✅ 无影响 | 保持 http 生成（canonical 未切换，生成后仍可被复制/导出识别） |
| quickNotes URL 生成 | ✅ 无影响 | 保持 http 生成；解析器已支持 quick-notes 前缀 + staging |
| lakeRuntime 性能统计 | ⚠️ 仅诊断 | resource timing 过滤 http，lake-asset 不统计（功能不受影响） |
| sync/httpFetcher/ssrf/cdnRedirect | ✅ 无影响 | 处理远端 URL，不碰本地图片引用 |
| mdToHtml/markdownClean | ✅ 无影响 | 原样保留 src，导出时由 store 正则处理 |

### 12.4 补充：quick-notes staging 支持

assetUrl 解析器补充 staging 草稿形态（`/quick-notes/staging/{draftId}/{file}`），
新增 1 项测试（共 13 项）。

### 12.5 质量门禁

443 passed / tsc / core 边界 0 违规 / diff 干净。
