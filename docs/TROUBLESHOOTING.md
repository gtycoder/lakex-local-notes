# 踩过的坑（按主题整理，修改前必读）

## A. 打包与发布（electron-builder）

1. **preload 必须纯 JS，绝不能混 TS 语法**：曾把 `: (progress: unknown) => void` 类型注解写进 `electron/preload.cjs` → 开发/打包全部 `SyntaxError: Unexpected token ':'`（以 sandbox_bundle 或 makeContextifyScript 两种面目出现，曾误判为沙箱/asar 冲突）。**preload.cjs 里禁止任何 TS 语法。**
2. **build.files 必须包含 `electron/preload.cjs`**：漏配 → asar 里没有 preload → `lakeNative` undefined → 页面空白。
3. **产物目录必须独立**：输出目录用 `dist/` 会把上一轮的 dmg/zip/.app 递归打进 asar（曾膨胀到 1GB）。必须 `directories.output: "release"`。
4. **vite 8（rolldown）需要 Node ≥ 20.12**：系统 node 18 报 `styleText` 缺失；用 nvm v24。
5. **asar CLI extract-file 会剥离目录**：`asar extract-file app.asar dist/index.html` 会把文件写到**当前目录**（不是 dist/），曾覆盖根 index.html → `git checkout -- index.html` 恢复。
6. **防御性配置（实测可用，暂勿回退）**：`webPreferences.sandbox: false`（contextIsolation 仍开）+ `asarUnpack: ["electron/preload.cjs"]` + 打包版 preload 直接指向 `path.join(__dirname, "../../app.asar.unpacked/electron/preload.cjs")`。
7. **打包版必须用相对路径加载 vendor**：`file://` 下 `/vendor/...` 会指向系统根目录。`index.html` 与 `lakeRuntime.ts` 用 `./vendor/...`（dev 下等价）。

## B. 资源本地化（CDN）

8. **CDN 重定向 handler 不要 decodeURIComponent**：asset server 统一 decode 一次即可；hitu 文件名是双编码 `%25E5...`，二次 decode 会 404。
9. **math.KaTexURL 传数组**（katex + mhchem）；插件对 string/array 都兼容，但 mhchem 需要数组第二个元素。
10. **vendored codemirror.js 要与包默认版本逐字节一致**：实测 7.1.27 与 CDN sha256 一致才可离线工作；另有 7.1.3（代码块卡片回退）也要镜像。

## C. 图片下载与复制（阶段 A 核心）

11. **Node fetch 的 TLS 指纹被 CDN 识别（403）**：知乎等做 JA3 检测，curl/Go/undici 时 200 时 403。解法：主进程 `electronNet.fetch`（Chromium 栈 = Chrome 指纹）+ `Referer=图片URL自身` + 浏览器 UA + 3 次重试 + SSRF 防护。
12. **原生 paste 的 clipboardData 只读**：`setData` 无效（合成事件可写会骗过测试）。解法：`installPasteInterceptor()` 在 **document 捕获阶段 patch `getData("text/html")`**，且必须在编辑器创建前安装。
13. **验证剪贴板必须走真实路径**：用 `webContents.paste()` + 系统剪贴板；合成 `dispatchEvent` 会骗过自己。
14. **Electron nativeImage 不支持 WebP 解码**（`createFromBuffer` 实测 isEmpty）：复制到微信的 webp/avif 转换必须用 **sharp**。
15. **同步 XHR 不支持 arraybuffer**：`responseType="arraybuffer"` 静默失败、`overrideMimeType` 会丢字节。解法：服务器 `?base64=1` 直接返回 base64 文本，客户端零转换。
16. **navigator.clipboard.write() 对 macOS 原生应用无效**：微信读不到 text/html。必须 `event.clipboardData.setData()` 同步写入（因此用了同步 XHR）。
17. **复制到微信的空行**：Lake 图片前后有空段落（零宽字符 `\u200B`、`<span><br></span>`）。`normalizeClipboardHtml` 末尾正则清理。
18. **Lake copy handler 优先级**：用捕获阶段 + `stopImmediatePropagation()` 确保先于 Lake 内部 handler。
19. **`isCaptureImageURL` 必须排除本地 URL**：否则每次 `setDocument` 都重新下载上传本地图片，产生冗余文件与竞态。当前实现已排除 `http://127.0.0.1:19876/`。

## D. 编辑器与 CSS

20. **性能优化破坏 TOC（历史教训，已被 2026-08-02 会话推翻/解决）**：历史上 `content-visibility: auto`、`virtualRendering`、Tab 离屏销毁、MutationObserver 懒加载都曾破坏 TOC。**现已证明可行**：`virtualRendering` + `scrollNode` 指对真实滚动容器（`.ne-editor-wrap`）+ setDocument 后重放 `tocChange`，TOC 正常工作（打开时延迟 ~600ms 出现）；高亮/点击/列表跟随由自研 `setupTocScrollFollow` 补齐。
21. **overflow 修改影响 Lake 浮动 UI（已演进）**：`.multi-tab-editor`/`.tab-panels` 设 overflow 曾裁剪表格工具栏与 TOC 按钮。最终方案：**每标签独立滚动容器**——`.lake-editor-tab` 固定高度外壳（`overflow:hidden`）+ 高度链让 Lake 原生 `.ne-editor-wrap`（`height:100%; overflow-y:auto`）内部滚动；`.multi-tab-editor` 用 `height:100%`（确定高度）而非 `min-height`（否则内容撑高、内部滚动失效、外层裁剪）。
22. **`-webkit-app-region: drag` 原生层吃点击**：`pointer-events: none` 无效。`.tab-bar` 设 drag、`.tab-item` 设 no-drag。
23. **CSS 修改铁律**：改前先 `diff lake-notes-tauri-poc/src/styles.css src/styles.css`；绝不加 `content-visibility`/`contain` 到引擎层。
24. **Drawnix CSS 不能直接 import**：包的 exports 没导出 CSS。复制到 `src/vendor/` 从本地路径导入。
25. **DefaultEditorConfig 必须递归深合并**：一层合并丢嵌套配置（`deepMerge` 已实现）。
26. **scrollNode 必须指向真实滚动容器**（虚拟渲染/大纲定位前提）：本项目桌面多标签下是 `.ne-editor-wrap`（高度链修复后）；`body` 是 `overflow:hidden`，Lake 默认回退 `document.scrollingElement || document.body` 会拿错，导致视口测量/TOC 全乱。
27. **新建标签元素在编辑器创建时尚未布局**：`useEffect` 同步阶段 `clientHeight=0`，虚拟渲染初始视口按 0 算 → 首屏/大纲异常。`scrollNode` 函数里读一次 `offsetHeight` 可强制 reflow。
28. **TOC 侧边栏创建时用空 toc 渲染（Lake 行为）**：`ready` 事件早于 `tocChange` 时侧边栏永远不会被填充 → 打开文档大纲为 0，编辑后才出现。补丁：`refreshTocSidebar()`（`kernel.getDocExtraContent().toc` 取权威数据 + `kernel.emitPluginEvent("tocChange", data)` 走官方路径重放 + 重试）。
29. **TOC 条目是 `div.ne-toc-item`，不是 `<a>`**：探测/选择器用 `a` 会数出 0 造成误判。
30. **多标签共用滚动容器 → 滚动位置共享**：`.document-pane` 包所有标签时，A 标签滚到中部，切 B 也在中部。解法：每标签独立滚动容器。
31. **`npm run dev` 会启动两个 Electron**：`vite-plugin-electron` 默认自动拉起 Electron，脚本里再 `wait-on && electron .` 就是双实例 → 单实例锁冲突 + ERR_FAILED。已修：dev 只跑 vite（commit 3b7db20）。
32. **打包版卸载后 SingletonLock 残留**：`~/Library/Application Support/lake-notes-electron/SingletonLock|SingletonSocket|SingletonCookie` 残留会挡 dev 启动（"Failed to create SingletonLock: File exists"）。确认无进程后改名 `.stale-bak` 即可（沙箱禁 `rm -f`，用 mv）。
33. **埋点/日志坑**：`console.debug` 被 DevTools 默认过滤（改用 `console.log`）；HMR 不重建已创建的编辑器实例（测新埋点必须 Cmd+R 或重启）；`editor.on("tocChange")` 收不到内核事件（要走 `editor.kernel.onPluginEvent`）。
34. **docInitPerf 探针**：monitorLog 走内核 emitter，`editor.on("monitorLog")` 收不到（facade 不转发）；当前 `__lakePerfReport` 的 docInitPerf 采集是否生效取决于订阅路径，非功能问题。

## E. 环境与工具

35. **杀进程误杀 Trae CN**：永远用 `grep "lake-notes-electron"` 精确匹配，禁 `pkill -f Electron`。
36. **npm 私有镜像不可达**：显式用 `registry.npmmirror.com` + 独立 cache 目录。
37. **better-sqlite3 ABI**：装完必须 `@electron/rebuild`（Node ABI ≠ Electron ABI）。
38. **React StrictMode**：useEffect 双执行，setOpenTabs 需去重（`tabs.some(...)`）。
39. **Tauri 自定义协议闪退**：当初不做资源归一化的原因；Electron 无此问题，用 HTTP 方案。

## F. S3 / 七牛

40. **七牛报 `UnknownError` = Bucket 名不存在**（404 的字面 message）。先 `ListBuckets` 确认真实空间名，再排查网络。
41. **Endpoint 必须是区域级地址**：bucket 专用虚拟主机地址（`local-lake-hebei.s3.cn-north-1.qiniucs.com`）+ path-style 会 404，不勾 path-style 会拼出双 bucket 域名导致 TLS 失败。用 `https://s3.cn-north-1.qiniucs.com` + path-style。
42. **Region 填 `cn-north-1`**，不是空间名。
43. **单实例锁（audit 新增）**：dev 与打包版共用 userData/SingletonLock，不能同时运行；开发前先退出打包版。
44. **S3 配置校验**：`sync.ts` 的 `validate()` 要求 endpoint/bucket/accessKeyId/secretAccessKey 非空（trim），否则抛「Endpoint、Bucket 和访问密钥均不能为空」；`testConnection`/`syncNow` 未保存配置时抛「请先保存 S3 配置」。

## G. 虚拟渲染 / 调试（2026-08-02 会话新增）

45. **Lake TOC watcher 二分探测失效**：`TWe._checkIndex` 用二分 `querySelector('[id=...]')` 探测标题，虚拟渲染下视口外标题无 DOM → 探测 null → 立即返回 -1 → 永远不选中。**不要试图修 watcher，用自研跟随覆盖（`setupTocScrollFollow`）**。
46. **Lake TOC 列表跟随挂在 watcher 的 `_reset` 上**：`GY._makeVisible`（选中项超出可视带 ±10px 时把 `.ne-toc-view-inner` 滚动到居中）只由 watcher change 触发；绕过高亮后必须自己在 `apply()` 里复刻（10px 容忍带 + `scrollTop += r.top - (vp.top + vp.height/2)`）。
47. **表格卡片 `_rootNode` 是 `ne-table-wrap` 不是 `ne-table-hole`**：卡片工具栏 overlay 的 mouseenter/mouseleave 监听绑在 `_rootNode`（表格为 `ne-table-wrap`，hole 的**子孙**）上；补发合成事件必须命中 `_rootNode`，只发到 hole 无效。
48. **表格工具栏 hover 消失机制**：overlay 的 `hovered` 状态只由卡片根节点的 mouseenter/mouseleave 驱动，工具栏渲染在卡片外（上方），鼠标一移过去就触发 mouseleave → 300ms lazyCancel 隐藏。解法：`mouseleave` 不冒泡但有**捕获阶段**，document 捕获层先于目标监听器；目标为卡片且 relatedTarget 在工具栏上下文（`.ne-card-toolbar` / `.ne-ui-boundary-popover` / `ne-overlay-tmp` / `[data-event-boundary=overlay]`）时 `stopImmediatePropagation`；离开工具栏时补发合成 mouseleave（untrusted 放行）触发正常隐藏。
49. **卡片水合与 `$appear`**：cardLazyInit 下新插入的卡片可能永远停在空壳——Lake 可见性观察器作用在 hole 节点，`hole.$appear` 不传播到卡片 UI；直接调 `卡片._neRef._virtualNode.$appear()` 可立即水合（`ensureCardsInViewHydrated`）。
50. **双 ABI 测试基建**：Electron ABI 的 better-sqlite3 在纯 Node 报 `NODE_MODULE_VERSION 1`；`test-node-abi/` 单独装 Node 构建 + vitest `resolve.alias`。`electron/store.ts` 模块加载即 import `electron`，测试必须 `vi.mock("electron")`。
51. **grep .lake 内容坑**：.lake 是 HTML+URL 编码文本，空格等字符被编码（`const real` → `const%20real%20%3D%201`），直接 grep 原串会漏匹配。排查用编码后的模式或解码后再查。
52. **Playwright 驱动 Electron 调试**：合成 `dispatchEvent` 不触发真实焦点（真实点击用 `page.mouse.click`）；node_repl 沙箱禁 `process`；electron 主进程 `isDev = !app.isPackaged` 会去连 1421 dev server——用静态服务器 serve `dist/` 即可跑生产渲染层。
53. **虚拟渲染滚动补偿**：滚动后 `wrap.scrollTop` 会因内容高度变化被 Lake 调整（scroll 补偿），定位表格/元素要用**实时** `getBoundingClientRect`，不要缓存旧坐标。
54. **e2e 测试残留**：测试里 `createNote` 被调两次会残留笔记/资源目录；每次测试后要验证清理（`listOrphanAssets` + 笔记文件数）。
