# 进度与交接

> **给零上下文新会话：先读本文的「★ 最新交接」，再按需读 DEVELOPMENT / ARCHITECTURE / TROUBLESHOOTING。**

---

## ★ 最新交接（2026-08-03 会话）：代码审计 15 项修复 + 安全加固 ✅（已合入 master）

> 状态：用户实测整体流程无问题，`fix/audit-2026-08-03`（d95a338 + d9e52b4）已 **fast-forward 合入 master 并推送 Gitee**。

### 任务目标（本会话）

1. 阅读 `docs/CODE-AUDIT-2026-08-03.md`（15 项问题 + 6 个复现重点），逐条独立核验并给出二次判断
2. 参考 opus4.8 评审（已收到 1–14 条；第 15 条被截断，由我方补全）
3. **在独立分支 `fix/audit-2026-08-03` 上修复**（未直接改 master），含新增风险条目 16–23
4. 全部修复经 vitest（82→100 用例）+ Playwright 驱动真实 Electron 实测

### 已完成（按审计条目）

**第一梯队（数据一致 + 安全）**
- **#1 同步清空资源清单（高）**：`sync.ts` 上传阶段资源清单改为**每次同步恒重扫**（正文 hash 未变也保留 assets），
  上传仍增量（远端同 hash 跳过）。修复"带图笔记连续同步两次后 manifest 丢失资源"。
- **#2 删除墓碑只保留一次同步（高）**：删除 `pruneTombstones` 调用；墓碑**永久保留**并恒写入 manifest；
  下载到 deleted 标记时若本地无此笔记也 `rememberDeleted`（学习墓碑，设备可接力保管标记）。
  三设备推演测试：A 删除+两次同步 → 离线 C 上线不复活；A 清空后 C 仍持有墓碑。
- **#3/#17 manifest 目录穿越 + notePath 缺口（高）**：路径校验下沉——`notePath`/`noteAssetsDirFor`/`importRemoteNote`
  统一 `isSafePathSegment`（拒绝空、`./..`、`/`、`\`）；manifest 增加**运行时 schema 校验**（`validateManifest`）；
  sync 下载循环对 `rn.id`/`asset.filename` fail fast；`save_note`/`read_note` 的任意 id 不再能读写工作区外 `.lake`。
- **#4 远端资源无完整性校验（高）**：下载资源缺失即中止导入（不再静默跳过）；下载后校验 `size` 与 sha256。
- **#5 SSRF 可绕过（高，实测确认比报告更糟）**：`ssrf.ts` 新增 `assertSafeRemoteHost`（DNS 解析 A/AAAA，
  任一地址命中本机/私网/链路本地/保留/组播即拒）；下载层改用 **`net.request` + `followRedirect:false`**
  逐跳手工跟随 + 每跳重新校验（`net.fetch` 的 `redirect:"manual"` 在 Chromium 抛 "Redirect was cancelled"，
  已实测）；**渲染层回退彻底移除**（原回退是刻意绕过主进程策略，`resourceUpload.ts:89-91` 注释为证）。
  实测矩阵：直连公网 ✓、302 跟随 ✓、重定向到私网/域名解析到私网（localtest.me→127.0.0.1）全拒 ✓。
- **#6 IPC 来源过宽 + 无导航拦截（高）**：`isTrustedSenderFrame` 改为**精确 URL + webContents 白名单**
  （dev 仅 1421 origin；prod 仅打包 dist/index.html pathname）；不再信任任意 file://、任意 localhost、
  devtools、about:blank；新增 `will-navigate` 拦截 + `setWindowOpenHandler` deny（外链交 `shell.openExternal`）。

**第二梯队**
- **#7 自动保存覆盖新编辑（中偏高）**：`App.tsx` 加每笔记 **revision 计数器**——保存请求发出后若期间有新编辑，
  旧响应不覆盖草稿、不清除 dirty。
- **#8 移动端旧快照（中低）**：`persistMobile`——移动端保存成功后同步 `mobileActive`/草稿，viewer 不再显示旧快照，离开也不再重复保存。
- **#9 树结构不变量（中）**：`assertParentCompatible`——notebook 只能根层、note 不能作父、group 只能挂
  notebook/group；`reorderTreeNodes` 校验重复/归属/完整性（必须含全部子节点）。
- **#10 FS 与 SQLite 非原子（中，删除路径高）**：`deleteTreeNode` 改 **DB 先提交、文件后删**（失败只留孤儿文件）；
  `importRemoteNote` 改 **staging 写入**（临时文件/临时目录 → DB 成功 → 原子 rename；失败清理临时产物）。
- **#12 孤儿删除失败仍报成功（低）**：仅删除成功/文件不存在才删记录并计数；失败保留记录可重试。
- **#13 Worker 崩溃后复用（低，改写描述）**：崩溃 worker **terminate + 替换**（in-flight 已 reject）；
  新增 **60s 单任务超时**（卡死也 settle + 报废 worker）；postMessage 抛错兜底。
- **#14 附件/Data URL 解码前无大小上限（中低）**：非图片附件统一 25 MiB 上限（读入前预检 file.size）；
  Data URL 按 base64 长度**解码前预检**（图片走 25 MiB，附件走 25 MiB）；图片路径原有上限保留。
- **#15 TOC 延迟水合参数错误 + 全局 DOM（低）**：裸函数位置修正——`lakeRuntime.ts:560-561`
  （onContentChange 600/1500ms）改箭头闭包传 host（513-514 原本正确，报告定位有误）；
  定时器统一登记 `pendingTimers` 并在 cleanup 清理；`refreshTocSidebar` 条目计数限定 `host` 内
  （多标签不再串扰）。实测双标签各自大纲 3/4 条正确。
- **#16 资产服务无鉴权 + CORS `*`（中，新增）**：Origin 门控——非 CORS 请求放行；Origin 非
  `http://127.0.0.1:1421`/`null`/`file://` 一律 403。实测恶意 Origin 403、应用页 fetch 200。
- **#18 移动+重排两次 IPC 非原子（低，新增）**：新增 `move_tree_node_ordered`（单事务原子移动+重排），
  App/preload/native 全部切换。
- **#19 manifest 无 schema 校验（低，新增）**：随 #3 的 `validateManifest` 一并修复（notes 非数组/字段缺失/版本不兼容均报错）。
- **#20 同步删除路径残留墓碑（低，新增）**：随 #2 一并修复（墓碑不再剪除 + 学习墓碑）。
- **#21 `upload_resource` IPC 输入侧无大小限制（低，新增）**：main 层预检 bytes 数组 ≤ 25 MiB。
- **#22 `detectOrphans` 事务外抛错误报保存失败（低，新增）**：saveNote 内 try/catch 隔离。
- **孤儿写时登记（防 S3 累积无用文件，用户要求）**：`uploadResource`/`downloadRemoteResource` 写盘即登记孤儿，保存时按正文引用撤销——杜绝「文件未登记孤儿就被同步上传」的窄窗口（否则 S3 会累积从未被引用的文件）。
- **#23 无 beforeunload 兜底（低，新增）**：窗口关闭时若有脏标签/移动端未保存草稿 → 阻止关闭 + 原生对话框
  + 尽力 flush 一次保存。

### 验证情况

- **vitest**：82 → **100 用例全绿**（新增 18：sync 6、store 6、ssrf 5、树/重排 3 等，详见测试文件）
- **tsc --noEmit**：通过
- **Playwright 真实 Electron 实测**（`fix/audit-2026-08-03` 构建）：
  - IPC 信任链（应用页正常调用 bootstrap/save）✓
  - SSRF 矩阵 6 项全过（见上）✓；导航拦截（location.href 被 preventDefault、window.open 被 deny）✓
  - 资产服务 CORS（恶意 Origin 403 / 应用页 200）✓；TOC 双标签各自大纲正确 ✓
  - 测试数据（3 个临时笔记 + 4 个资源文件 + 墓碑）已全量清理并验证无残留

### 行为变化（注意）

1. **墓碑不再自动剪除**：`deleted_notes` 会持续累积（每删一篇笔记一行）；manifest 恒带 deleted 标记。
   体积极小，换取"删除不可复活"的正确性。若未来需要回收，需引入版本向量/多设备确认。
2. **IPC 来源收紧**：若未来新增 dev 端口或打包路径变化，需同步更新 `isAppPageUrl`；窗口被导航到
   应用页之外（含本地文件）后 IPC 将拒绝。
3. **外链行为**：笔记内 http/https 链接点击 → 系统浏览器打开（window.open 被 deny）。
4. **`reorderTreeNodes` 要求完整子节点列表**：UI（App.moveTreeNode）已传完整列表；其他调用方需注意。
5. **删除笔记 = 先删 DB 后删文件**：删除后文件清理失败会留下孤儿文件（由孤儿清理兜底），不再是"DB 引用已删文件"。

### 遗留（有意未修/待立项）

- **S3 对象累积回收（GC）**：已同步过的图片从正文删除后，S3 对象永久留存（manifest 不再引用、对象不删）。
  思源靠「数据仓库瘦身/压缩」定期回收；本项目需 manifest 墓碑 + 多设备安全剪枝设计，暂未做（不紧急，属存储成本问题）。

### 下一步（建议）

1. 合入 master 前：跑 `VIRTUAL-RENDERING-TEST.md` 回归清单（本次改了 lakeRuntime 定时器/TOC 范围）
2. 打包版（.app）冒烟：导航拦截/资产 CORS/SSRF 在打包环境复测
3. 移动端路径回归（scrollNode 回退分支 + TOC）
4. 待办（未修，记录在案）：#8 移动端 viewer 旧快照（低）、#15 剩余 refreshTocSidebar 重试定时器未跟踪
   （editor 销毁后最多再跑 8 次，已由 kernel 空值 try/catch 兜底）

---

## ★ 最新交接（2026-08-02 会话）：虚拟渲染全链路修复 + 阶段 C 收尾 + 合入 master

### 任务目标（本会话）

1. 修复虚拟渲染分支遗留的 TOC 问题（滚出视口消失 / 无高亮不跟随 / 点击定位不准）
2. 修复代码块粘贴后不可见
3. Phase B：表格浮动工具栏 hover 消失
4. 试验收敛（清理探针/封顶重试轮询）并合回 audit 分支
5. 阶段 C：补 Store 层 DB 测试（双 ABI）+ S3 配置校验 + 孤儿资源 UI
6. 长大纲列表跟随（选中项滚动到 TOC 列表可视区）
7. 全部完成后合入 **master**，并将交接文档按类型拆分

### 已完成（含根因与实测）

**① TOC 三问题（commit `2c33875`）**
- 根因：高度链断裂——`.lake-editor-mount` 高度 auto 被内容撑高（实测 `.ne-editor-body`
  高 5809px），TOC（`position:absolute` 钉在 `.ne-editor-body` 上）随内容滚出视口；
  Lake 原生滚动层 `.ne-editor-wrap`（`height:100%; overflow-y:auto`）从未生效。
  高亮失效根因：Lake TOC watcher 用**二分查找**探测标题 DOM，虚拟渲染下视口外标题
  无 DOM → 中间探测项 null → 永远 -1 不选中。
- 方案：`.lake-editor-tab` 改 `overflow:hidden` 外壳 + `.lake-editor-mount`/`.ne-editor`
  补 `height:100%` 高度链 → `.ne-editor-wrap` 成为真实内部滚动容器；`scrollNode` 指向
  `.ne-editor-wrap`（`resolveScrollNode`）；自研 `setupTocScrollFollow` 滚动跟随高亮 +
  点击 50/200ms 精确校正。
- 实测：TOC 固定 121→792、高亮跟随/回顶正确、5 个深度条目点击偏差 0-4px。

**② 代码块粘贴不可见（同 commit `2c33875`）**
- 根因：cardLazyInit 下插入的卡片**永远停留在未水合空壳**（80px 空 `.ne-codeblock-content`）
  ——Lake 可见性观察器作用在 hole 节点，`hole.$appear` 不传播到卡片 UI；实测
  `卡片._neRef._virtualNode.$appear()` 可立即水合。
- 方案：`ensureCardsInViewHydrated` 修复性水合（contentchange/滚动/渲染批次后对视口内
  未 appear 的 `ne-card` 主动 `$appear()`）。cardLazyInit 保留（性能收益不变）。
- 实测：粘贴 300ms 内水合（CM6 完整）；历史卡壳卡片重开也修复。

**③ Phase B：表格浮动工具栏 hover 消失（commit `02dde5f` + 离开路径修复 `4a76c76`）**
- 根因：Lake 卡片工具栏 overlay 的显隐监听只挂在卡片 `_rootNode`（**表格是
  `ne-table-wrap`，不是 `ne-table-hole`**）的 mouseenter/mouseleave 上；工具栏渲染在
  卡片上方，鼠标从卡片移到工具栏即触发 mouseleave → 300ms lazyCancel 隐藏。
- 方案：`setupCardToolbarHoverBridge`——mouseleave 不冒泡但有**捕获阶段**，document
  捕获层先于目标监听器；真实 mouseleave 目标是卡片、relatedTarget 在工具栏上下文时
  `stopImmediatePropagation` 阻止隐藏；离开工具栏时向 `_rootNode`（含 ne-table-wrap
  子孙）补发合成 mouseleave 触发正常隐藏。
- 实测：悬停工具栏 1100ms 不消失、按钮可点击（maximize/borderVisible）、3 轮往返定位
  零漂移、移出才隐藏。

**④ 试验收敛（commit `4a76c76`）**
- 清理 `[lake-perf]` console 探针噪音（保留 `window.__lakePerfReport` 排查工具）
- `refreshTocSidebar` 重试 20→8 次、延时封顶 500ms；`setupTocScrollFollow` 轮询封顶 5s
- 删除死代码 `__disposeTocFollow`；试验/EXPERIMENT 措辞全部转正式
- 合回 `audit/code-optimization`（快进）

**⑤ 阶段 C 测试（commit `a7e41c8`）56→82 用例**
- 双 ABI 基建：`test-node-abi/` 装 Node ABI better-sqlite3（`scripts/setup-test-abi.sh`），
  vitest `resolve.alias` 指过去；`vi.mock("electron")` 提供 safeStorage/net 替身
- `electron/store.test.ts` 22 例：bootstrap/种子、笔记 CRUD、目录树（含 move 自移/子孙
  校验、递归删除+墓碑）、孤儿资源（登记/撤销/清理）、S3 配置（safeStorage 加密往返/
  明文回退/损坏容错）、同步状态、importRemoteNote 幂等、uploadResource
- `sync.test.ts` 增 4 例：S3 配置校验（未保存/字段为空/有效连通）

**⑥ 孤儿资源 UI（commit `c249e16`）**
- SyncPanel 新增「未引用资源（孤儿）」区块：数量/总量摘要 + 列表（文件名/大小/笔记 id）
  + 清理按钮（显示释放字节）；IPC 已有，UI 补齐
- 端到端实测：造孤儿 → 登记 → 面板展示 → 清理（释放 12 B）→ 文件删除

**⑦ 长大纲列表跟随（commit `cbdfc2c`）**
- 根因：Lake 的 TOC 列表跟随（`GY._makeVisible`：选中项超出可视带时把
  `.ne-toc-view-inner` 滚动到居中）挂在自身 watcher 的 `_reset(selected)` 上；虚拟渲染下
  watcher 失效永不触发。自研高亮直接改 DOM class 也绕过了 `_reset`。
- 方案：`apply()` 复刻 `_makeVisible` 居中滚动（10px 容忍带 + 滚动到列表中心）。
- 实测：滚动到任意深度（4000~20000）选中项 index 23/28/35/41/48 全部保持可视区内，
  列表 scrollTop 355→691→816 跟随；回顶恢复。

**⑧ 合入 master + 文档拆分（本提交）**
- 创建本地 `master` = 当前 HEAD，推送 Gitee `master`（快进）
- 交接文档按类型拆分为 README.md + docs/{PROGRESS,DEVELOPMENT,ARCHITECTURE,TROUBLESHOOTING}.md

### 当前问题 / 已知限制

1. **应用未签名、未公证**：dmg 首次打开需右键 → 打开；分发前需 Developer ID 签名 + 公证
   （教程见 `docs/RELEASE.md`，账号/证书认证工作由用户在 Apple Developer 侧完成）
2. ~~默认 Electron 图标~~ ✅ 已加：`build/icon.icns`（湖蓝渐变 + 文档页 + 波浪，程序化设计，含全尺寸）
3. ~~打包版与开发版共用 userData~~ ✅ 已隔离：dev 用 `lake-notes-dev`，打包版用 `lake-notes-electron`（main.ts）
4. **渲染包超大（已部分优化）**：画板已拆独立 chunk（drawnix 4.2MB），主 chunk 仍约 9.4MB
   （Lake 编辑器本体 + slate + react）；真正收益需编辑器懒加载（属 Lake 阶段，未动）
5. ~~远程仓库默认分支仍是 main~~ ✅ 已切换：Gitee 默认分支 = master，main 已设为保护分支
6. **表格 max-view 进出后工具栏定位偏移 ~28px**（重开自愈，不影响使用；Lake boundary
   popover 在 max-view 切换后的既有行为，非 hover 桥引起）
7. **移动端/单编辑器路径未回归**：`resolveScrollNode` 仅 `.lake-editor-tab` 启用内部滚动；
   移动端仍走外层 `.document-pane`，TOC 固定/跟随未验证（待移动端阶段一并做）
8. **npm 私有镜像不可达**：装新依赖必须显式用 npmmirror registry

### 下一步计划（建议顺序）

1. **发布完善（进行中）**：图标 ✅ 已加；代码签名 + 公证 + 重新打包由用户按 `docs/RELEASE.md` 推进（需 Apple 认证）
2. **移动端/单编辑器路径回归**（scrollNode 回退分支 + TOC）：待移动端阶段一并做
3. **安卓端同步**：复用同步协议（manifests/objects/assets 布局已是跨端设计）；独立开发阶段
4. ~~userData 隔离~~ ✅ 已完成（dev= lake-notes-dev / 打包= lake-notes-electron）
5. 渲染包优化（编辑器懒加载，属 Lake 阶段）；后续随 Lake 优化一起做
7. **Lake 体验优化（参考评审见 `docs/REFERENCE-REVIEW-2026-08-03.md`）**：
   ✅ P0+P1 已落地（2026-08-03）——偏好设置面板（字号/段间距/TOC/工具栏显隐）、字数统计；
   ⏸ **深色模式已回滚**（工具栏图标对比度差、成本高收益小，用户决定不做）；
   ⏸ **纯文本粘贴已回滚**（Cmd+Shift+V 在 Chromium 不触发 paste 事件；DOM 插入方案被
   Lake 内部文档模型重建清除——"粘贴文字很快消失"，需内核插入 API 才能真修，成本高，放弃）；
   待做——**Markdown 导出/导入**（调研完成见 `docs/MARKDOWN-EXPORT-REVIEW.md`：全文转 md 内核原生
   已验证、成本极低；选区转 md + 右键框架成本中等）、外部变更检测（AI 生成场景）、
   formatLake（保存格式化 .lake）、.lakebook 导入
6. （可选）max-view 后工具栏定位偏移修复（用户已确认可做，待深入 Lake 内部定位）

### 本会话踩过的坑（速览，细节见 TROUBLESHOOTING.md）

- Lake TOC watcher 二分探测视口外标题无 DOM → 永远 -1（自研高亮绕过）
- Lake TOC 列表跟随（_makeVisible）挂在 watcher 的 _reset 上，绕过后需自己复刻
- 表格卡片 `_rootNode` 是 **ne-table-wrap** 不是 ne-table-hole（hover 桥补发目标）
- mouseleave 不冒泡但有捕获阶段，document 捕获可拦截；`stopImmediatePropagation` 阻止 Lake 排定隐藏
- 双 ABI：Electron ABI 的 better-sqlite3 在 Node 报 NODE_MODULE_VERSION 1 → test-node-abi 单独装
- store.ts 运行时 import electron → vitest 必须 `vi.mock("electron")`
- grep .lake 文件内容：空格被 URL 编码（`const%20real`），直接 grep 会漏匹配
- Playwright：合成事件不触发真实焦点（用 `mouse.click` 真实点击）；node_repl 沙箱禁 `process`
- 虚拟渲染滚动补偿：`wrap.scrollTop` 会随渲染调整，定位元素要用实时 getBoundingClientRect
- e2e 测试 createNote 被调两次会残留笔记，测试后要清理并验证

---

## 经验总结（2026-08-02 会话沉淀，方法论 > 技巧）

### 方法论：永远实测，不猜
- **Playwright 驱动真实 Electron 调试**：`_electron.launch({ executablePath, args:["."], cwd })`
  直接起应用；主进程 `isDev = !app.isPackaged` 会去连 1421 dev server，用静态服务器
  serve `dist/` 即可跑生产渲染层（含真实 IPC/asset server/DB）。
- 流程：**先复现拿数据（DOM 几何/事件时序/控制台）→ 再反编译 Lake dist 确认机制 → 再改**。
  本次所有"怪问题"（TOC 滚走、无高亮、粘贴空壳、工具栏消失）都是这样定位的；不要靠
  读代码猜。
- 逐元素派发实验定位监听归属：不确定某个事件监听挂在哪个元素时，对候选元素逐个派发
  合成事件看谁生效（如表格工具栏的 mouseleave 监听最终定位到 `ne-table-wrap`）。

### 深层认识：Lake 编辑器与虚拟渲染
- **scrollNode 是虚拟渲染的命根子**：必须指向真实滚动容器（本项目高度链修复后是
  `.ne-editor-wrap`）；`body overflow:hidden` 时 Lake 默认回退
  `document.scrollingElement || document.body` 会拿错，视口测量/TOC 全乱。
- **Lake 的 TOC watcher 与虚拟渲染不兼容，不要修**：`TWe._checkIndex` 二分探测标题
  DOM（`querySelector('[id=...]')`），视口外标题无 DOM → 探测 null → 立即 -1 → 永远
  不选中。用自研跟随覆盖（高亮 + 点击校正 + 列表 `_makeVisible` 复刻三件套）。
- **Lake 内部对象要摸清归属再下手**（都靠反编译 + 实验确认）：
  - 卡片工具栏显隐监听绑在卡片 `_rootNode`——表格是 `ne-table-wrap`（`ne-table-hole` 的子孙）
  - 卡片水合要调**卡片**的 `_neRef._virtualNode.$appear()`（可见性观察器作用在 hole，
    `hole.$appear` 不传播到卡片 UI）
  - overlay 的 hover 状态只由卡片 mouseenter/mouseleave 驱动，工具栏渲染在卡片外
    （placement top），鼠标一移过去就触发隐藏
- **mouseleave 不冒泡但有捕获阶段**：document 捕获层先于目标监听器执行 →
  `stopImmediatePropagation` 可拦截"卡片→工具栏"的隐藏事件（hover 桥的核心）。
- **虚拟渲染滚动补偿**：滚动后 `wrap.scrollTop` 会因内容高度变化被 Lake 调整，定位元素
  必须实时 `getBoundingClientRect`。

### 工程实践
- **双 ABI 测试**：Electron ABI 原生模块（better-sqlite3）在纯 Node 报
  `NODE_MODULE_VERSION 1`。`test-node-abi/` 单独装 Node 构建 + vitest `resolve.alias`，
  配合 `vi.mock("electron")`，Store 层终于可测（22 例）。
- **探针收敛**：调试探针要收敛才能转正式——留 opt-in 工具（`window.__lakePerfReport`）、
  删 console 噪音、重试/轮询封顶（`refreshTocSidebar` 8 次、轮询 5s）。
- **数据安全**：e2e 测试写用户真实数据前先想好清理路径；`.lake` 是 HTML+URL 编码文本
  （空格→%20），grep 要用编码后的模式，否则漏匹配。
- **文档即交接**：每次会话结束把根因/方案/实测/坑写进交接文档；本次按类型拆分
  （README + docs/*），新会话先读 PROGRESS.md 的 ★最新交接。

---

## 已完成内容（历史）

### 5.1 阶段 A：资源归一化 + 第三方图片下载/复制修复 ✅（commit a703492）

**资源归一化**（仿思源）：
- 图片按 `note-assets/{noteId}/{timestamp}_{random8}.ext` 存储，URL `http://127.0.0.1:19876/{noteId}/{filename}`
- `orphan_assets` 表记录孤儿（saveNote 扫描 content 引用 vs 磁盘文件，不自动删文件）
- 删笔记 = 删 .lake + 整个 note-assets/{noteId}/ + 清 orphan
- IPC：`list_orphan_assets` / `clean_orphan_assets`（UI 已做，见 SyncPanel）

**第三方图片下载修复**（对齐 Rust + 思源）：
- 主进程用 **`electronNet.fetch`**（Chromium 网络栈 = Chrome JA3 TLS 指纹）解决知乎 CDN 403
- `Referer = 图片 URL 自身` + 浏览器 UA + 3 次重试 + SSRF 防护（拒绝 localhost/私网）+ 流式限量读取
- 用户验证：85 张图全部本地化、0 空 SVG

**粘贴修复**：`installPasteInterceptor()` 在 document 捕获阶段 patch `clipboardData.getData("text/html")`
（原生 paste DataTransfer 只读，setData 无效）→ 知乎懒加载空 SVG 替换为 data-actualsrc 真实 URL

**复制到微信**：`?base64=1` 端点用 sharp 把 webp/avif 转 png（Electron nativeImage 不支持 WebP，实测 isEmpty）

### 5.2 阶段 B：S3 备份同步 ✅（commit c57a3a4 / 898e7b9）

- `electron/sync.ts`：同步引擎（详见 ARCHITECTURE.md §五）
- `store.ts`：S3 配置存取（settings 表 `s3_settings`，secret 经 safeStorage 加密）、`sync_base` 表、`deleted_notes` 墓碑表
- IPC：`get/saveS3Settings`、`testS3Connection`、`syncNow`、`getSyncStatus`
- 同步面板：状态栏入口 → 配置表单 + 测试连接 + 立即同步
- **真实七牛同步验证通过**（本地 8 篇笔记 ↔ 云端 282 个对象逐字节一致）

### 5.4 阶段 C：代码审计与优化（commit 503742f）🚧

**审计范围**：`61ee469..HEAD` 全量（OCR delegate 模式 + 人工逐文件 4,250 行）。

**修复要点**：
- **安全**：SSRF 拦截 IPv4-mapped IPv6（`[::ffff:7f00:1]` 可绕过，已实测确认）；渲染层下载回退加
  25MiB 流式上限；S3 Secret 改用 `safeStorage` 加密落盘（兼容旧明文）；IPC 增加 sender frame 校验
- **健壮性**：asset server 全路由 try/catch（畸形 `%` 编码不再挂起连接）+ MIME 嗅探只读前 16 字节；
  WorkerPool worker 崩溃时拒绝 in-flight 任务
- **同步优化**：下载阶段消除 N+1 查询、资源并行下载；上传跳过云端同 hash 资源（增量零重传）；
  墓碑写入清单后剪除
- **并发/生命周期**：单实例锁（dev 与打包版不能同时运行）+ sync 并发锁
- **清理**：删除死代码 `electron/preload.ts`；`importRemoteNote` 去掉未用参数

**行为变化（注意）**：① 单实例锁 → 开 dev 前先退出打包版；② S3 Secret 下次保存时转加密存储，换机需重填。

**资源本地化（Lake 编辑器 CDN 全量离线）**：
- 35 个 `gw.alipayobjects.com` 资源镜像到 `public/vendor/cdn/`（含 codemirror 7.1.3、katex 0.16.8 + mhchem、25 个图标、hitu 插图）
- 主进程 `registerCdnRedirect()`：`session.webRequest.onBeforeRequest` 重定向 `*://gw.alipayobjects.com/*` → `http://127.0.0.1:19876/vendor/cdn/<path>`
- `index.html` / `lakeRuntime.ts` 的 `/vendor/...` 全部改为相对 `./vendor/...`（打包版 file:// 下绝对路径失效）
- 打包版实测 CDN 重定向 5/5 通过

### 5.5 大文档性能定位 + 虚拟渲染试验（2026-08-02）

- 实测定位「大文档图片裂 3.5s」根因：非网络/主线程/渲染，而是 Lake 卡片 UI 提交/hydration 调度（107 codeblock 卡片时）
- 虚拟渲染收益：首图 88ms、滚动渐进、工具栏置顶、多标签滚动独立
- 详细数据、补丁、遗留问题见上方「★ 最新交接」与 `VIRTUAL-RENDERING-TEST.md`
