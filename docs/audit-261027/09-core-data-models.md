# 09 · src/core 业务语义补审：文档数据模型、序列化方言与「打开=只读」

| 项 | 值 |
|---|---|
| 范围 | `src/core` 的**文档数据模型**四族：多维表（`bitableDoc`/`bitableMutations`/`bitableCsv`/`bitableReadOnly`/`bitableHistory`）、表格（`usheetDoc`/`usheetCsv`/`usheetExcel`）、手写板/画板（`inkDoc`/`boardDoc`）、文档格式（`lakeDocForm`/`mdToHtml`/`docStats`/`lakeCaches`/`textStats`/`noteSearchText`/`colorPalette`） |
| 基线 | `master @ ea576a80` + 工作树 A 止血批未提交改动（未触碰）；`docs/audit-261027/` 只读 |
| 方法 | 由外到内：能力/契约（`docs/BITABLE-VIEWPORT.md`、`docs/LAKE-CONTENT-WRITING.md`、`AGENTS.md` §3#19/§4、`05`/`07`）→ 模块导出面 → 代码；`read/grep/wc/node` 只读；性能在 `$TMPDIR` 副本上实测 |
| 明确不重审 | 同步协议（`05` 已审）、v4 RFC 的编排层设计（`07`）、移动端 UI 状态机（`04`） |
| 写入 | 仅本文件 |

> 证据一律「文件 + 符号」为主、行号为定位参考（A 批改动会让行号漂移）。**实测口径**统一写在 §1.4，引用数字时注明，不与其他文档的旧数字混用。

---

## 0. 结论摘要

1. **边界是干净的，问题在方言**：四族正文都能在 `src/core` 内解析/序列化，且 `inkDoc`/`boardDoc`/`usheetDoc`/`lakeDocForm`/`textStats` **零 import**；`check:core` 用正则硬门禁 `electron/node:/DOM/react`。**没有发现 core 越界读平台**。真正的缺口是「同一份字节语义」没有单一来源：规范化、失败语义、容量上限、字数口径各自散在多处。
2. **P1×4**：多维表筛选对 `markdown`/`ai` 字段**静默恒真**（CORE-01，已实测）；坏正文策略四类分叉、`usheet`/`board` 无只读保护（CORE-02）；「打开=只读」判据没有 core 入口、四个宿主四套实现且移动端 usheet 全缺（CORE-03，与 `04` MOB-05 同一根因，本文给 core 侧修法）；表格 `ff` 由**运行时 CSS 变量**决定、core 无法规范化（CORE-04）。
3. **P2×6**：bitable 导航归一活在 core 之外（CORE-05）；多维表每次编辑全表重算（CORE-06，实测 5k 行 ≈40ms / 20k 行 ≈100ms）；手写板每条笔迹 2 次全文序列化（CORE-07，10 MiB 正文 ≈108ms/笔）；「过去/未来 N 天」多算一天（CORE-08）；正文容量上限分散 5 个模块（CORE-09）；字数口径输入源未收口（CORE-10，未取证运行态）。
4. **幂等只对「本端写出的规范正文」成立**：四族实测 `serialize(parse(body)) === body` 全部通过；但对**非规范正文**会静默改写——ink 缺 `activePageId` 会补、坐标越界被 clamp；board 的 `plaitViewport`/`previewImage`/未知键被丢；bitable 缺 `createdAt` 会补**当前时间**。幂等不是格式性质，是「写路径规范 + 读路径保真」的联合性质，而这条路今天没有任何护栏测试。
5. **跨端同字节今天不成立**：桌面在每次写盘前 `applyFontPolicy(lakeFontFamily())`（读 `getComputedStyle`），移动端既不 normalize 也不 applyFontPolicy 且自建 `createUniver`（不走 `usheetUniverFactory`）。同一表格在两端各保存一次就会互判为「有编辑」。此条为**代码路径推断**，未做设备字节对拍。
6. **「打开=只读」在桌面四条路径都有实现，但四个实现互不相同**（usheet：首次 flush 对齐基线 + 内容输入判据；bitable：`lastSerializedRef` 由 `serialize(parse(disk))` 播种；board：同式但 capture 无条件返回；ink：无 baseline）。只有 usheet 有护栏，且是**源码字符串断言**（`usheetOpenReadOnly.test.ts` 读 `.tsx` 断言标识符出现）。
7. **大对象量级**（实测）：多维表 20k×14 正文 9.86 MiB、parse 32ms、筛+排 35ms、填色投影 41ms；对象模型 ≈ **正文 ×2.1–2.5**（2.72 MiB 正文 → 解析后 18.8 MiB heap）；`lakeHtmlToMarkdown` 处理 12.5 MiB `.lake` 110ms 出 2.4 MiB 文本。
8. **条件求值单一来源确实做到了**（AGENTS §3#19）：桌面 Grid/看板/画册/日历/表单、移动查看器、关联选择器临时筛选、条件填色全部走 `applyViewToRecords`/`evaluateFilterNode`/`buildBitableFillProjection`，grep 无第二套。**这是正面样本，重构时不得拆**。
9. **删除面很小**：本主题生产代码 4,885 行，无整模块死代码；候选只有 2 组同义常量、3 个测试专用导出、2 处错位 JSDoc、1 处过期头注释（§3）。
10. **与 v4 RFC 正交**：本主题不碰 wire format；唯一交集是「单实现」原则——**正文方言**与 RFC 要治的「同步语义双写」是同类病（同一语义多处实现），但修法、风险面、验收完全不同，**不要塞进同步内核迁移**（§4.3）。

---

## 1. 现状盘点

### 1.1 模块与规模（生产行数 / 导出数 / 生产引用方数 / 测试）

| 模块 | 行 | 导出 | 生产引用方 | 测试（例 / 行） |
|---|---:|---:|---:|---:|
| `core/bitableDoc.ts` | 2260 | **161** | **28** | 59 / 1314 |
| `core/bitableMutations.ts` | 348 | 14 | 3 | 14 / 244 |
| `core/bitableCsv.ts` | 297 | 15 | 3 | 7 / 127 |
| `core/bitableReadOnly.ts` | 87 | 10 | 2 | 7 / 74 |
| `core/bitableHistory.ts` | 38 | 2 | 1 | 3 / 30 |
| `core/usheetDoc.ts` | 214 | 17 | 9 | 8 / 105 |
| `core/usheetCsv.ts` | 113 | 6 | 1 | 6 / 76 |
| `core/usheetExcel.ts` | 491 | 16 | 1 | 8 / 159 |
| `core/inkDoc.ts` | 249 | 20 | 6 | 5 / 60 |
| `core/boardDoc.ts` | 181 | 12 | 6 | 7 / 96 |
| `core/lakeDocForm.ts` | 91 | 8 | 8 | 4 / 66 |
| `core/mdToHtml.ts` | 158 | 2 | 2 | 10 / 73 |
| `core/docStats.ts` | 65 | 6 | 1 | 10 / 58 |
| `core/colorPalette.ts` | 87 | 11 | 7 | **0 / 0** |
| `core/lakeCaches.ts` | 104 | 2 | 3 | **0 / 0** |
| `core/textStats.ts` | 70 | 2 | 3 | 7 / 46 |
| `core/noteSearchText.ts` | 32 | 2 | 7 | **0 / 0** |
| 合计 | **4,885** | 302 | — | 162 / 2,528 |

读法：`bitableDoc` 一个文件吃掉 46% 的行数与 53% 的导出，**161 个导出 / 28 个引用方**意味着它同时是「格式定义」「工厂」「统计」「展示」「关联图操作」「AI 提示词」「四种视图求值」「筛选引擎 + UI 配置文案」「填色投影」九件事的公共头文件——这是本主题最大的结构性负债（§4.2）。测试密度 0.52 行测试/行生产，其中三个**高扇出**模块 0 测试（`colorPalette` 7 个引用方、`lakeCaches` 3 个、`noteSearchText` 7 个）。

### 1.2 契约面（每个 kind 一对 parse/serialize + 一个搜索文本入口）

| kind | 解析 | 序列化 | 失败语义 | 搜索文本 |
|---|---|---|---|---|
| doc（Lake HTML） | 无 core 解析（内核负责） | `lakeDocForm.*` 只拼字符串 | `missingBody`/`store.readNote` 层 | `lakeCaches.lakeHtmlToMarkdown`（兜底实现） |
| usheet | `parseUsheetBody` → `UsheetDoc` 或 null | `usheetToBody` + `normalizeUsheetWorkbook`（**void 原地改**） | null → **宿主按空表打开（可编辑）** | `usheetToSearchText` |
| bitable | `parseBitableBody` → `BitableDoc` 或 null（内部 `normalize*` 五段） | `bitablesToBody` + 调用方补导航归一 | null → 宿主 `bodyUnreadable` → **只读 + 横幅** | `bitableToSearchText` |
| board | `parseBoardBody` → `BoardDoc`（**无 null 分支**） | `boardToBody` | 坏数据 → **空白画板（可编辑）** | `boardToSearchText` |
| ink | `parseInkBody` → `InkDoc` 或 null（严格校验 + 6 个容量上限） | `inkToBody`（超限 throw） | null → **只读 + `ink-invalid-banner`** | `inkToSearchText`（恒空） |

统一分派点是 `noteSearchText.searchTextForKind`——一条 32 行、**零测试**、7 个引用方的 switch。它是「正文格式 ↔ 索引」的唯一接缝，方向正确，但没有任何测试证明「每种 kind 的 searchText 都不是 JSON 碎片」（而这正是它存在的理由，见其头注释）。

### 1.3 已定稿决策（不重开，本文只在越界时标注）

| 决策 | 出处 | 本文态度 |
|---|---|---|
| 多维表导航（`activeTableId`/`activeViewId`）不进正文、写 localStorage | `useBitableSession` 头注释「261006 用户选 C」；AGENTS §4 | 遵守；只要求把「正文恒写第一表/第一视图」这条方言下沉 core（CORE-05） |
| 画板视口不进正文，走 `boardViewStore` | `boardDoc.BoardDoc.viewport` 注释「260926 B」 | 遵守；`viewport` 是历史兜底字段，不删 |
| 不抽桌面/移动公共 usheet **runtime** | HANDOFF §3#17③（`04` 引用） | 遵守；本文只主张**格式层**下沉 core，不动实例层 |
| 多维表记录全集求值、不按可见行裁剪 | `docs/BITABLE-VIEWPORT.md`「数据与渲染边界」 | 遵守；CORE-06 只提「减少重算次数」，不提「只算可见行」 |
| 不为旧数据写兼容/迁移 | AGENTS §3#7 | 遵守；非规范正文被改写属可接受，但**必须不标脏**（属 CORE-03） |
| 色板字面量集中在 `core/colorPalette` 合法 | `03` 的「hex 字面量 44 处」条目 | 遵守；但该文件 0 测试（§5） |
| 移动端 usheet 未接 `normalizeUsheetWorkbook` | AGENTS §4 已知；`04` MOB-05 | **不重复计问题**；本文给 core 侧一次性修法（CORE-03/04） |

### 1.4 度量与口径（本文所有数字的出处）

**实测装置**：把 `bitableDoc.ts` 与三个纯依赖（`assetNaming`/`dateFormat`/`colorPalette`）复制到 `$TMPDIR/core-bench/`，**仅把 import 说明符的 `.js` 改成 `.ts`**（Node 24 的类型剥离不解析 `.js`→`.ts`），其余代码零改动；`inkDoc`/`boardDoc`/`usheetDoc`/`lakeCaches` 无 import，直接从仓库路径 import。Node **v24.18.0**，本机 macOS，单进程 `hrtime`，每项取 1 次（**未做多次取中位数**，方差未测，量级参考）。合成夹具，非真实数据。

| 场景 | 规模 | 结果 |
|---|---|---|
| bitable 序列化 | 20k 记录 × 14 字段 | 26.1 ms → 9.86 MiB |
| bitable 解析（`parseBitableBody`，含五段 normalize） | 同上 | 31.6 ms |
| bitable 筛（3 条）+ 排（2 条） | 同上 | 35.2 ms（剩 14,978 行） |
| bitable 填色投影（20 条规则） | 同上 | 41.4 ms |
| bitable 取填色（全行×全列 28 万次） | 同上 | 56.5 ms |
| bitable 分组（单选 4 组） | 同上 | 19.6 ms |
| bitable 同样四项 | **5k 记录 × 14 字段** | 5.6 / 11.2 / 10.3 / 11.9 / 16.1 / 16.2 ms |
| bitable 对象模型内存 | 2.72 MiB 正文 | 解析后 +5.6 MiB ⇒ **×2.1**（5k 档 ×2.5） |
| ink 序列化 / 解析 | 100 页×200 笔×10 点 = 20 万点 | 53.8 / 64.1 ms，正文 10.17 MiB |
| ink 往返 | 同上 | `inkToBody(parse(x)) === x` **true** |
| board 序列化 / 解析 | 5,000 节点 | 1.3 / 2.0 ms，0.69 MiB；往返 **true** |
| usheet 序列化 / `deepClone`（宿主每次 flush 一份） | 2 万单元格 | 2.0 / 6.0 ms，0.51 MiB；往返 **true** |
| `lakeHtmlToMarkdown` | 12.5 MiB `.lake` | 110.5 ms → 2.41 MiB 文本 |

**未取证**：真实 Electron 渲染态（`applyViewToRecords` 在真实 renderer 的耗时/掉帧）、真实 5k×20 夹具（`npm run test:bitable:packaged` 未跑）、移动端真机字节对拍。

---

## 2. 问题清单

### CORE-01 [P1] 多维表筛选对 `markdown` / `ai` 字段静默恒真：操作符表与求值分支脱节

**证据**
- `bitableDoc.filterOperatorsFor`：`markdown`/`ai` 与 `text`/`link` 同组，返回 `startsWith/contains/isEmpty…` 8 个操作符。
- `bitableDoc.filterValueKindFor`：`markdown`/`ai` 也归 `"text"`（所以「规则未填值就不拦截」的守卫放行）。
- `bitableDoc.evaluateFilter` 的文本分支只写了 `field.type === "text" || field.type === "link"`；`markdown`/`ai` 一路落到函数末尾的 `return true`。
- **实测**（Node 24，§1.4 装置）：对值 `hello world`，`markdown`/`ai` 字段的 `contains("zero")` 与 `startsWith("zero")` 均返回 `true`；`applyViewToRecords` 用一条「不可能命中」的 markdown 筛选，仍返回 **2/2 行**。
- `bitableDoc.test.ts`「筛选能力矩阵：按字段类型给操作符，并按远端 lake 口径求值」只覆盖 text/link/number/date/select/multiSelect/boolean/attachment，**没有 markdown/ai 的求值断言**（AI 段落只断言「操作符/值类型来自 text 口径」，即只测了配置面，没测求值面）。

**影响**：用户能给「Markdown」「AI 摘要」列加筛选（UI 按 `filterOperatorsFor` 渲染），但加了等于没加——**不缩行、不报错、无任何提示**。「看起来生效的控件实际无效」比抛错更伤信任；且直接违背 AGENTS §3#19 的意图（来源统一了，但**类型到口径的映射**在求值侧漏了两个类型）。

**建议**
- **激进**：`evaluateFilter` 改为按 `filterValueKindFor` 的 kind 分派（`text/number/date/select/multiSelect/boolean/file` 七个分支），而不是按 `field.type` 逐条 `if`——「类型 → 口径」只保留 `filterValueKindFor` 一处，新增字段类型时不可能再漏求值侧。配套：把「筛选能力矩阵」测试改成**表驱动**（`BITABLE_FIELD_TYPES` × 操作符 × 命中/不命中各一例），漏一个类型就红。
- **保守**：文本分支补 `|| field.type === "markdown" || field.type === "ai"`（1 行）+ 补 2 条用例。

**成本** S（保守 0.5h / 激进 0.5d，含表驱动矩阵）

---

### CORE-02 [P1] 「正文解析失败」在四族之间四套策略：两类只读保护、两类静默给空白可编辑面

**证据**
- `inkDoc.parseInkBody` 头注释明确「坏正文返回 null，编辑器必须只读，不得用默认空文档覆盖原文」；`InkPad` 渲染 `ink-invalid-banner`「手写板正文无法解析，已进入只读保护。请从历史版本恢复…」。
- `BitableEditor`：`bodyUnreadable = parseBitableBody(content) === null` → `readOnly = readOnlyProp || bodyUnreadable` + 横幅。
- `usheetDoc.parseUsheetBody` 返回 `null`，但 `UniverSheetEditor` 挂载时 `const workbook = parsed?.workbook ?? emptyUsheetWorkbook()`，**不置只读、无横幅**；用户改一格 → `doFlush` → `changeRef.current(body)` → 原文被空白表覆盖（只剩历史/回收站）。
- `boardDoc.parseBoardBody` **没有失败态**（`catch { return createBoardDoc() }`），且 `boardDoc.test.ts`「坏数据 / 非画板正文一律退化成空白画板（不抛错，避免文档打不开）」把它锁成契约；`BoardEditor` 以 `parseBoardBody(content)` 播种 `lastSerializedRef`，用户画一笔即落盘「空白 + 新元素」的正文。

**影响**：同一句「正文损坏」在四种文档上给出四种行为，其中 `usheet`/`board` 会**静默覆盖**（可恢复性取决于历史快照是否恰好存在；AGENTS §4 对「缺正文」已定义「只读专用面板 + 从历史恢复」，本项是它的兄弟场景，却没进同一套判据）。另外 `board` 的「宽容」与其「元素完全不校验」叠加：坏场景树直达第三方引擎（有错误边界兜底，不会整窗崩），用户看到的是「空画板」，不知道正文里原本有东西。

**建议**
- **激进**：core 增加统一三态解析契约（`ok` / `unparsable` / `wrong-kind`，坏数据可带 `degraded`），四族共用；宿主对非 ok 一律「只读 + 横幅 + 从历史恢复」；`boardDoc` 保留宽松解析但返回 `degraded: true`（老数据仍能打开，语义从「静默」变「明示」）。
- **保守**：只补两个洞——`usheet` 照抄 bitable 三行（`bodyUnreadable` → `readOnly`）+ 横幅；`boardDoc.parseBoardBody` 增 `degraded` 布尔（解析失败/非 board kind 时为 true），`BoardEditor` 据此只读。不动 ink/bitable。

**成本** S（保守 0.5d）／M（激进 1–2d，含移动端两个 viewer）

---

### CORE-03 [P1] 「打开=只读」没有 core 判据：四个宿主四套实现，移动端 usheet 为零

**证据**
- core 侧只有 `usheetDoc.normalizeUsheetWorkbook(workbook): void`——**原地改、无返回值**，因此「是否真的变了」这件事 core 无法回答；字体策略（`applyFontPolicy`）更不在 core。
- 桌面 `UniverSheetEditor` 自己拼了 4 件套：`normalizedBodyOf`（磁盘原文 → 规范正文）、`baselineSettledRef`（首次 flush 只对齐）、`contentInputRef`（内容输入判据）、挂载时的 `canonicalBody`（把内核 `save()` 结果再规范化当基线）。
- `useBitableSession`：`lastSerializedRef = serializeBody(parse(disk).tables)`（构造式播种）+ `flushNow` 比对；`captureContent` **无条件**返回序列化正文（靠调用方的 dirty 闸门兜）。
- `BoardEditor`：`lastSerializedRef = boardToBody(initialDoc)`，`flush` 比对，`captureContent` 同样无条件。
- `InkPad`：无 baseline；`serializeDoc` 只做 try/catch，`captureContent` 返回 `inkToBody(parse(disk))`。
- 移动端 `MobileUsheetViewer.capture()` = `usheetToBody(state.book.save())`，无 normalize、无 baseline（`04` MOB-05 已登记）。
- 唯一护栏 `features/usheet/usheetOpenReadOnly.test.ts` 是**读 .tsx 源码断言标识符**（`baselineSettledRef`/`contentInputRef` 出现在正则窗口内），不是行为测试。

**影响**：这不是「移动端漏接一次」，而是**判据没有单一实现**——每加一个宿主/入口（历史快照预览、分屏第二栏、AI 生成后回填、未来的 web 端）就重演一次。而且四个实现的语义并不等价：bitable/board 的基线由「解析后重新序列化」得到（对非规范正文天然免疫），usheet 的基线由「内核 save() 再规范化」得到（依赖内核行为），ink 完全没有基线（任何一次保存都会把 parse 的 clamp/补字段写下去）。谁在何时被绕过，取决于宿主顺序，不取决于文档格式。

**建议**
- **激进**：core 新增纯函数 `settleDocBody(kind, diskBody, candidateBody, opts) → { body, changed }`（无 DOM，字体等外部输入作为 `opts` 传入），四族共用；`normalize*` 降级为内部实现；宿主只保留「何时 flush」，不再自己判断「算不算改」。配套一条**跨宿主契约测试**：给定 5 份夹具正文（规范 / 非规范 / 缺字段 / 坏正文 / 空），断言「未编辑即 `changed === false`」。
- **保守**：只把桌面的 `normalizedBodyOf` + `applyFontPolicy` 搬进 core（`usheetSettleBody`），桌面改为调用、移动端接同一函数（与 MOB-05 同一个 PR）；bitable/board/ink 暂不动，但在 AGENTS §4 登记「三类文档的 baseline 语义各不相同」。

**成本** M（1–2d；保守 0.5d）

---

### CORE-04 [P1] 表格正文字体族由运行时 CSS 变量决定：core 无法保证「同内容同字节」

**证据**
- `features/usheet/usheetFont.lakeFontFamily()` 读 `getComputedStyle(document.documentElement).getPropertyValue("--lake-font-family")`，取不到或含 `var(` 才回落 `MiSans, sans-serif`；令牌定义在 `src/styles/themes/base.css`（值含单引号 `'MiSans'`）。
- `UniverSheetEditor` 在**打开、首次 flush、每次 flush、挂载后取 canonical** 四处 `applyFontPolicy(workbook, lakeFontFamily())`，把该值写进 `defaultStyle.ff` 与**所有命名样式**。
- core 只有 `usheetDoc.normalizeFontFamily`：只把单引号族名换成双引号，**不决定值**；因此 `ff` 的真值在 core 之外。
- 移动端 `MobileUsheetViewer` 自建 `createUniver`（不走 `usheetUniverFactory`，后者才有 `customFontFamily` + `lakeFontFamily()`），且 `capture()` 不 apply 不 normalize。

**影响**
1. **跨端不同字节**：同一表格在桌面保存过（`ff` = 桌面解析出的栈）→ 移动端打开再保存，`ff` 不被重写（省了），但 `resources.data` 的 `""`/`"{}"` 与引号风格不会被归一 ⇒ 内容 hash 变 ⇒ 另一端判定「有编辑」⇒ 上传/拉取 ping-pong。这正是 261023「一打开就黄色待保存」的同类根因，当年只修了**引号**这一半。
2. **令牌变更 = 全库改写**：改 `--lake-font-family`（主题/字体设置）会让**每一张**表格的下次保存都改 `ff` ⇒ 全库 contentHash 变化 ⇒ 一次全量上传。
3. **core 自证不可能**：`05`/`07` 反复强调「同输入同字节」，但表格格式的关键字段值来自 CSS 运行时。

**建议**
- **激进**：确立「`ff` 的 canonical 值 = core 常量」（如 `USHEET_CANONICAL_FONT_FAMILY`），CSS 令牌只用于渲染、**永不进正文**；`normalizeUsheetWorkbook` 把任意 `ff` 归一到该常量（含缺失时补写）。需要用户口径：这会让存量表格在首次保存时统一改写 `ff`（一次性、可解释、不改观感），且跨端彻底稳定。
- **保守**：保留「取令牌值」但**下沉 core**——`settleUsheetBody(diskBody, workbook, { fontFamily })` 由宿主把值传进来（core 不读 DOM），两端调同一函数、同一顺序；至少保证「两端同值同字节」，并把「令牌值变化会全库改写」写进 `docs/USHEET-UPGRADE.md` 的已知代价。

**成本** M（激进含一次存量改写口径确认；保守 0.5d）

---

### CORE-05 [P2] 多维表「正文恒写第一表/第一视图」的方言活在 core 之外的**两份**拷贝

**证据**
- `bitableDoc.bitablesToBody(tables, activeTableId)` 只校验/回落**文档级** `activeTableId`，**不碰**每张表的 `activeViewId`。
- `useBitableSession.serializeBody`：`tables.map(t => ({ ...t, activeViewId: t.views[0]?.id ?? t.activeViewId }))` 后 `bitablesToBody(canonical, canonical[0]?.id)`。
- `mobile/bitable/mobileBitableEdit.ts` 同一段 map（逐字同义）。
- 已定稿：导航不进正文（261006 C）。缺的是**这条定稿的执行点**在 core 还是调用方。

**影响**：任何第三个写入口（新建多维表、CSV 导入落库、AI 生成回填、导出后回导、历史快照回滚）只要忘了这行 map，就会写出带「上次浏览的表/视图」的正文 ⇒ 与另一端不同字节 + 纯导航触发一次上传。今天正确只是因为两个调用方都抄对了。

**建议**
- **激进**：core 增 `bitablesToBodyCanonical(tables)`（内部做两级导航归一），新代码只用它；`bitablesToBody` 保留给需要保真导航的场景（历史快照预览）。
- **保守**：直接在 `bitablesToBody` 内部把每张表的 `activeViewId` 归一到 `views[0]`（两个调用方已在做，行为零变化），调用方那两行 map 删掉。

**成本** S（0.5h）

---

### CORE-06 [P2] 多维表「每次编辑 = 全表重算」：5k 行 ≈40ms、20k 行 ≈100ms 主线程块

**证据**
- `BitableEditor`：`viewRecords = useMemo(applyViewToRecords, [activeTable, activeView, clock])`、`fillProjection = useMemo(buildBitableFillProjection, […, clock])`、`rowItems`（含 `groupRecords`）、`dupValuesByField`（`duplicateValues`）——**任何**单元格提交都经 `setBitableCellValue` 产生新 `tables` ⇒ 全部 memo 失效 ⇒ 4 次以上全表扫描。
- 实测（§1.4）：5k×14：筛+排 10.3ms、填色投影 11.9ms、分组 16.2ms、查重 3.0ms ⇒ **单次编辑 ≈40ms**；20k×14：35.2 + 41.4 + 19.6 + 6.2 ⇒ **≈100ms**。
- `buildBitableFillProjection` 是 `records × rules` 双层循环（20k × 40 规则 = 80 万次 `evaluateFilter`），且对每条记录都从头扫全部规则；`isBitableFilterRuleConfigured`（配置判定）在**内层**每条记录每条规则都重算一次。
- `bitableFillBackgroundTokens` 每次调用都 `filter + sort + reverse` 新数组（20k×14 = 28 万次调用 56.5ms；只在视口内调用，故非热点，但可零成本改常数）。
- **契约约束**：`docs/BITABLE-VIEWPORT.md`「记录全集保留在模型中…按完整投影求值」是定稿 ⇒ 不能改成只算可见行。

**影响**：目标档（5k×20）单次编辑 40ms 意味着连打/粘贴多格时输入队列堆积；20k 行档 100ms 已到「可感知卡顿」。按 `BITABLE-VIEWPORT` 的用户口径（「不进入秒级即可接受」）**不是阻断项**，但它是**唯一随行数线性增长的编辑路径**，且填色投影是纯浪费（多数视图没有 20–40 条规则）。

**建议**
- **激进**：一次遍历同时算 filter/sort 键/填色命中（避免 4 次全表扫描）；填色投影改成「规则外层、记录内层」并把配置判定提到循环外；`clock` 只进 `viewRecords` 不进 `fillProjection`（今天填色会因「今天变了」重算整表）。
- **保守**：① `fillProjection` 依赖数组去掉 `clock`；② `buildBitableFillProjection` 前置过滤「未配置的规则」；③ 视图未配 `fillRules`/`highlightDuplicateFieldIds` 时直接跳过（今天仍会遍历）。三条都局部改，行为不变。

**成本** S（保守 0.5d）／M（激进 2–3d + 需 `test:bitable:packaged` 复测）

---

### CORE-07 [P2] 手写板每条笔迹 = 2 次全文档序列化；undo 栈对大正文只剩 2 步

**证据**
- `InkPad.commit`：`pushBoundedHistory(undoRef.current, inkToBody(docRef.current))` + `serializeDoc(next)`（内部再 `inkToBody`）⇒ 每落一笔 **2 次 O(全篇点数)** 序列化；`undo`/`redo` 同样 2 次。
- 实测：20 万点（100 页×200 笔×10 点）正文 10.17 MiB，`inkToBody` 53.8ms、`parseInkBody` 64.1ms ⇒ **每次抬笔 ≈108ms**，并产生 ~20 MiB 字符串垃圾。
- `features/ink/history.ts`：`INK_UNDO_LIMIT = 60`、`INK_UNDO_MAX_CHARS = 24 MiB` ⇒ 10 MiB 正文时 undo 实际只剩 **2 步**（与「60 步」的产品预期不符）；且每次 push 都 `stack.reduce` 全量重算。
- 容量：`MAX_TOTAL_POINTS = 300000` 与 `MAX_INK_BODY_CHARS = 16 MiB` 同一量级先到。

**影响**：长篇手写的输入手感随篇幅线性退化（触到 300k 点上限时单笔 ≈160ms）；大文档的撤销体验与产品宣称不符。这是本主题**唯一确定会随内容增长而破坏交互**的路径。

**建议**
- **激进**：`inkToBody` 增加增量形态——宿主只序列化「受影响的页」（或改分页存储），undo 存「操作差分」而非整篇字符串。
- **保守**：① 落笔只序列化**一次**（先 `nextBody`，再把上一份已序列化正文压栈，避免对 `docRef.current` 重复序列化）；② 撤销栈改存**页级**快照（`pages[i]` 序列化），单步成本降到 1/页数；③ 把「大正文只剩 2 步」写进 `docs/INK-PAD.md` 或按页给上限。

**成本** S（保守 0.5–1d）／L（激进，涉及格式）

---

### CORE-08 [P2] 「过去/未来 N 天」多算一天，且无测试覆盖

**证据**
- `bitableDoc.dateFilterRangeFor`：`last7days → addLocalDays(now,-7) … now`；`last30days → -30 … now`；`next7days → now … +7`；`next30days → now … +30`。
- **实测**（基准 `2026-10-28`）：`last7days = 2026-10-21..2026-10-28`（**8 个日历日**）、`last30days = 2026-09-28..2026-10-28`（**31 天**）、`next7days = 10-28..11-04`（8 天）。
- `bitableDoc.test.ts` 的日期段只断言 `thisWeek`/`lastWeek`（`:353-354`），三个滚动窗口**零覆盖**。

**影响**：文案是「过去7天内」，实际窗口 8 天 ⇒ 边界日的记录会多出。属「筛选结果与文案不一致」的小偏差，但在对账/审计场景会被当成数据错误。

**建议**
- **激进**：改为 `now-(N-1) … now`（含今天共 N 天），补三个模式 × 三个基准日（月初/月末/跨年）的表驱动用例。
- **保守**：只补测试，并把口径写进字段筛选项的注释（不推荐：与 UI 文案矛盾）。

**成本** S（0.5h）

---

### CORE-09 [P2] 正文容量上限分散在 5 个模块，board/bitable/usheet 无自身上限

**证据**
- `core/ipcLimits.MAX_NOTE_CONTENT_BYTES = 32 MiB`（全 kind 的 IPC 上限）、`inkDoc.MAX_INK_BODY_CHARS = 16 MiB`、`quickNoteModel.MAX_QUICK_NOTE_BODY_LENGTH = 4_000_000`、`lockedText.LOCKED_TEXT_MAX_CHARS = 200_000`；`boardDoc.parseBoardBody` **不设任何上限**（`elements` 完全未校验），`bitableDoc`/`usheetDoc` 无自身上限。
- 模型内存实测 ×2.1–2.5 ⇒ 32 MiB 的 board/bitable 在渲染层常驻 ≈70–80 MiB。

**影响**：「哪类文档多大算超限」没有单一答案，排查时要在 4 个文件里找；且 board 既无字节上限也无结构校验，坏场景树直达第三方引擎。

**建议**
- **激进**：`core/docLimits.ts` 一张表（kind → 字节上限 + 结构上限），`ipcLimits`/`inkDoc`/`quickNoteModel` 改为引用；`parseBoardBody` 加 `MAX_BOARD_BODY_CHARS` 与「elements 数量上限」。
- **保守**：只给 `boardDoc` 加字节上限（照 ink 的两行），其余在注释里登记「上限分散现状」。

**成本** S（0.5d）

---

### CORE-10 [P2] 字数口径：算法已收口，**输入源**仍两条（未取证运行态）

**证据**
- `textStats.countWords` 是内核 `wordCount` 的逐条同源实现（注释引 vendor 行号与三段正则），有 7 例测试——**算法层是正面样本**。
- 但 `docStats.resolveDocStats` 的兜底输入是 `docPlainText(content) = lakeCaches.lakeHtmlToMarkdown(content)`（HTML 剥标签 + 空行压缩 + 卡片只取 `text/plain`），而内核走 `getDocument("text/plain")`；桌面有内核实例时走内核，移动端属性页恒走 core。
- `docStats.computeDocStats` / `docPlainText` 在生产**零引用**（只有测试），`lakeCaches` 本身 **0 测试**。

**影响**：同一文档的「字数」在桌面状态栏与移动端属性页可能不一致（差异取决于卡片/表格/图片标题等结构性内容多少）。未做运行态对拍，**标为待取证**；但两侧入口确实喂给同一函数不同文本，属结构性风险。

**建议**
- **激进**：主进程已有的 `text_cache` 与移动端属性页统一走 `countWords(text_cache)`（同一输入），桌面有内核时仍用内核并**在差异 >1% 时打 debug 日志**（可观测而非猜）。
- **保守**：在 `docStats` 头注释登记「兜底与内核的输入源差异」，补一条已知差异用例（含 image card 的正文），并把 `computeDocStats`/`docPlainText` 降级为模块内私有。

**成本** S（0.5d，含一条实测）

---

## 3. 删除/合并清单

> 原则：本主题**没有整模块死代码**；以下都是「同义重复 / 测试专用导出 / 注释错位」，删除风险低、收益也小——按 AGENTS §3#17 不要为「更整洁」单独开 PR，随 CORE-01/05/09 的改动顺带做。

| # | 对象 | 证据 | 处置 | 风险 |
|---|---|---|---|---|
| 1 | `bitableDoc.BITABLE_IMPLEMENTED_VIEW_TYPES`（与 `BITABLE_VIEW_TYPES` **逐项相同**） | 两常量都是 `grid/form/kanban/gallery/calendar` 五项；`isImplementedViewType` 仅 2 处使用（`BitableEditor` 的 `showGridTools` 与回退分支） | 保留为**扩展点**（注释已写明「新增实现后加这里」），但把测试里「`toEqual` 同一字面量」的断言改成**行为断言**（未知类型走回退），否则它锁的是常量自身 | 无 |
| 2 | `bitableDoc.BITABLE_OPTION_COLORS`（`BITABLE_OPTION_PALETTE` 的别名） | 相邻两行，注释自称「兼容别名…新代码用 PALETTE」 | 唯一引用方 `BitableEditor` 改用 `PALETTE` 后删除别名 | 无 |
| 3 | `usheetCsv.escapeCsv`（私有）与 `bitableCsv.csvEscapeField`（导出但**外部零引用**） | 两者逻辑逐字等价（含逗号/引号/换行才包裹 + 引号双写）；BOM/EOL 常量也各写一份 | 合并为 `core/csvText.ts`（`escapeCsvField` + `parseCsv` + `CSV_BOM`/`CSV_EOL`），两处改为引用。**CSV 解析器只有 bitableCsv 一份**，别复制第二份 | 低（导出产物对拍一例） |
| 4 | `lakeDocForm.escapeLakeHtml` 与 `mdToHtml.escapeHtml`（私有） | 都是 `& < > "` 四字符替换 | 合并到 `core/htmlEscape.ts`；两者语义相同、无可观察差异 | 无 |
| 5 | 测试专用导出：`docStats.computeDocStats`、`docStats.docPlainText`、`inkDoc.inkStrokePointCount`、`boardDoc.boardDocFromCardValue`、`usheetDoc.normalizeFontFamily`、`usheetCsv.pickUsheetSheet`、`bitableCsv.coerceCsvCell` | 生产零引用，只被同名测试 import；`boardDocFromCardValue` 是「卡片 → 文档」方向，产品只用「文档 → 卡片」 | 降为模块内私有 + 用行为测试替代；`boardDocFromCardValue` 若要保留「互搬」能力，需在 `docs/STORAGE-LAYERS.md` 标注「未接线」 | 无 |
| 6 | `bitableDoc` 模块头「v1 字段 **7** 种…关联(占位)」+ `BITABLE_FIELD_TYPES` 上方「（v1 只暴露这 **7** 种）」 | 实际 17 种（含 boolean/link/rating/progress/createdTime/updatedTime/relation×2/ai/markdown），`BITABLE_FIELD_TYPE_LABEL` 也是 17 项 | 改注释（两处） | 无 |
| 7 | `bitableDoc` 两处**错位 JSDoc** | `computeColumnStat` 的说明块（「计算一列的统计值…」）悬在 `localMonthDiff` 之上，真正的函数在下方且无注释；`defaultRecordValues` 上方有**两个**连续文档块（前一个「字段默认值集合…」已过期） | 归位 / 删除多余块 | 无 |
| 8 | `colorPalette.COLOR_BOARD_VALUES` / `COLOR_BOARD_VALUE_SET` | 零引用 | 删除或标注「预留」 | 无 |

---

## 4. 重构建议（按收益/风险排序）

### 4.1 排序

| 序 | 动作 | 收益 | 风险 | 成本 | 依赖 |
|---|---|---|---|---|---|
| R1 | **CORE-01 修筛选类型映射** + 表驱动矩阵测试 | 直接修一个用户可见的功能失效；把「新增字段类型必漏求值」变成测试可见 | 极低（纯函数 + 测试） | S | 无 |
| R2 | **CORE-02 坏正文统一策略**（先补 usheet/board） | 消掉两条静默覆盖路径；与 AGENTS §4「缺正文只读面板」语义对齐 | 低（只加只读分支与横幅） | S | 无 |
| R3 | **CORE-05 / CORE-08 / CORE-09 的 core 侧收口** | 三个「小洞」一次补完，都是纯函数 + 一处调用方 | 低（行为不变或仅修偏差） | S | 无 |
| R4 | **CORE-03 抽 `settleDocBody`**（先 usheet 一族接上） | 把「打开=只读」从四个宿主各自的约定变成 core 不变量；移动端 MOB-05 顺手关掉 | 中（动桌面唯一有护栏的路径 + 移动端保存路径） | M | R5 的字体口径需先定 |
| R5 | **CORE-04 字体族 canonical 化** | 让「同内容同字节」第一次成为可验证性质；止住令牌变更导致的全库改写 | 中高（**一次性改写存量正文的 `ff`**，需用户口径） | M | 用户裁决 |
| R6 | **CORE-06 多维表重算收敛**（保守三条） | 5k 行单次编辑 40ms → 目标 <20ms；纯属浪费消除 | 中（多维表是本仓最敏感的性能面，需 `test:bitable:packaged` 复测） | S/M | 无 |
| R7 | **CORE-07 手写板单次序列化 + 页级 undo** | 长手写输入手感；undo 步数符合产品预期 | 中（动编辑提交路径） | S | 无 |
| R8 | **CORE-10 字数输入源** | 消除端间口径差（需先取证） | 低 | S | 一条实测 |

**明确不做**：拆 `bitableDoc.ts`（见 4.2）、把四族正文改成统一容器格式、给 board 写结构 schema、为旧正文写兼容分支（AGENTS §3#7）。

### 4.2 为什么不建议现在拆 `bitableDoc.ts`

161 个导出、28 个引用方、2260 行，内聚确实差（九件事）。但它**没有任何行为问题**，而拆分会同时动桌面/移动/主进程三条导入面，收益仅停在「文件变小」——正撞 AGENTS §3#17「收益只停在代码更整洁」。**若将来必须动**（例如要给移动端做 bitable 编辑的按需分包），推荐按**消费者**而不是按「概念」切：`bitableFormat`（类型 + parse/serialize + normalize，桌面/移动/主进程共用）、`bitableView`（统计/展示/四视图求值/筛选/填色，纯前端）、`bitableRelation`（双向关联图操作，仅编辑面）、`bitableAi`（AI 提示词，仅 AI 面）。届时先用 grep 证明每个子集的引用方集合不重叠。

### 4.3 与 v4 RFC（`07`）的关系

- **正交**：RFC 治「同步编排」，本文治「正文方言」。RFC 的 `SyncPlan` 明确「只带 key+hash+size，不携带字节」，因此**正文怎么序列化不在 RFC 范围内**；本文所有改动不触碰 pointer/index/declaration/key 布局，可独立发版、独立回滚。
- **同源病**：RFC §2 的「双端两写」「conformance 对账」与本文 CORE-03/04/05 是同一类病（同一语义多处实现 → 靠对账维持一致）。RFC 的解法是「单实现 + 端口」，本文的解法是「单纯函数 + 宿主只做 IO」，**措辞可以复用**。
- **顺序建议**：R1/R2/R3 属于「任何时候都可做」的止血，**建议排在 RFC 的 M0 对拍之前**（它们改的是正文，不是同步状态，越早改越少一轮回归面）；R4/R5 涉及正文改写，**必须避开 M2 双写过渡窗口**（那期间两端版本可能混合，正文改写会与「跨端混版」风险叠加）。
- **一条可借用的形式**：RFC §4 把不变量写成 I0–I6 并当验收标准。本文建议同样登记 **I-RO（读路径不得产生写）** 为正文层不变量，执行点就是 `settleDocBody`（CORE-03）——与 I0「云端胜出不得删除本地」同构：**都是「某个非用户动作不得产生副作用」**。

---

## 5. 测试与度量

### 5.1 覆盖空洞（按风险）

| # | 空洞 | 现状证据 | 该加什么 |
|---|---|---|---|
| 1 | **跨端/跨宿主「同内容同字节」零测试** | 全仓无任何测试比较桌面与移动的序列化产物；`04` MOB-05 的建议里提过但未落地 | 5 份夹具正文 × 4 kind，断言 `settle(disk) === disk` 且 `settle(canonical) === canonical`；再加一条「两端各自写出后 sha256 相等」 |
| 2 | **坏正文策略无契约测试** | ink/bitable 有横幅但只测 parser 返回 null；usheet/board 无测试 | `docCorruptBodyContract.test.ts`：四族喂坏正文，断言「只读 + 不复写原文」 |
| 3 | **`lakeCaches` / `colorPalette` / `noteSearchText` 零测试** | 三个模块 0 `.test.ts`，分别 3/7/7 个生产引用方 | `lakeCaches`：card 值里 `text/plain` 抽取、实体解码、`&nbsp;`、嵌套标签；`colorPalette`：`contrastTextColor` 在浅色档不返回白字；`noteSearchText`：每 kind 的产出**不含** JSON 碎片（这是它存在的理由，却没有断言） |
| 4 | **筛选「能力矩阵」只覆盖一半类型** | `bitableDoc.test.ts` 的矩阵缺 markdown/ai（CORE-01 因此没被发现） | 改成 `BITABLE_FIELD_TYPES` 驱动，缺一种类型就红 |
| 5 | **「打开=只读」只有源码字符串断言** | `usheetOpenReadOnly.test.ts` 读 `.tsx` 断言标识符 | 抽 `settleDocBody` 后给纯函数测试（行为），源码断言降级为结构提醒 |
| 6 | **日期滚动窗口零覆盖** | 只测 thisWeek/lastWeek（CORE-08） | 三个模式 × 月初/月末/跨年/闰日 |
| 7 | **性能没有任何门禁** | 全仓无 core 性能断言；`test:bitable:packaged` 只能人工执行 | 见 5.2 第 4 条 |

### 5.2 可加护栏（最小集，都能挂进现有门禁）

1. `src/core/docSettle.test.ts`（新）——「未编辑即 `changed === false`」× 4 kind × 5 夹具；纯函数、毫秒级，直接进 `npx vitest run`。
2. `src/core/bitableFilterKindMatrix.test.ts`（新）——类型 × 操作符 × 命中/不命中；顺手把 CORE-01 变成「修前红、修后绿」。
3. `src/core/docLimits.test.ts`（新，CORE-09 后）——表驱动，断言每个 kind 在「刚好上限 / 超 1 字节」两侧的行为。
4. **比值断言（不进默认门禁）**：`bitableDoc.bench.test.ts` 用 `it.skipIf(!process.env.LAKE_RUN_BENCH)`——20k 记录筛+排 < 80ms、填色投影 < 90ms（本机实测 35/41ms，留 2× 余量），只在 `LAKE_RUN_BENCH=1` 跑。口径（Node 版本、夹具形状、单次取值）必须写在测试注释里，否则下次又变成不可复跑的数字（`00` §6 已警告方差 3.2×）。
5. **一行护栏（零成本）**：`scripts/check-core-boundaries.mjs` 已禁 `document.`/`window.`；再加一条显式提示「`src/core/**` 不得出现 `getComputedStyle` / `localStorage`」，防止有人为了「规范化字体」把 DOM 读进 core（CORE-04 的错误修法）。

### 5.3 复测命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes

# 边界（本主题必跑；应输出「core 文件数：N，违规：0」）
node scripts/check-core-boundaries.mjs

# 本主题定向套件
npx vitest run src/core/bitableDoc.test.ts src/core/bitableMutations.test.ts \
  src/core/bitableCsv.test.ts src/core/bitableReadOnly.test.ts \
  src/core/usheetDoc.test.ts src/core/usheetCsv.test.ts src/core/usheetExcel.test.ts \
  src/core/inkDoc.test.ts src/core/boardDoc.test.ts src/core/lakeDocForm.test.ts \
  src/core/mdToHtml.test.ts src/core/docStats.test.ts src/core/textStats.test.ts
# ↑ 另需 colorPalette / lakeCaches / noteSearchText 三个新文件（§5.1 #3），建好后纳入

# 桌面唯一的行为护栏（仍是源码断言，改造前先看它锁了什么）
npx vitest run src/features/usheet/usheetOpenReadOnly.test.ts

# 多维表真包性能（人工；改动 CORE-06 后必跑）
npm run test:bitable:packaged

# 本次审计的实测装置（不写仓库；$TMPDIR 副本仅改 import 扩展名）
#   mkdir -p "$TMPDIR/core-bench" && cp src/core/{bitableDoc,assetNaming,dateFormat,colorPalette}.ts "$TMPDIR/core-bench/"
#   # 只改三个运行时 import 的说明符（.js → .ts）；aiProviders 是 import type，Node 剥离后不解析
#   sed -i '' 's|from "./assetNaming.js"|from "./assetNaming.ts"|; s|from "./dateFormat.js"|from "./dateFormat.ts"|; s|from "./colorPalette.js"|from "./colorPalette.ts"|' "$TMPDIR/core-bench/bitableDoc.ts"
#   node "$TMPDIR/core-bench/bench.ts" 20000     # 数字见 §1.4
```

### 5.4 需要用户裁决的两点

1. **CORE-04 的 canonical 字体族**：是否接受「`ff` 一律写成 core 常量」（存量表格首次保存时统一改写一次，观感不变，但会触发一轮全量上传）？否则只能保证「两端同函数同顺序」，无法保证「令牌变更不引发全库改写」。
2. **CORE-07 的 undo 语义**：大正文（>5 MiB）时接受「按页撤销」，还是保持「按整篇」并显式把 `INK_UNDO_MAX_CHARS` 的代价告知（当前 10 MiB 正文只剩 2 步）？

---

## 附：方法与局限

- **只读**：全部结论来自 read/grep/wc + `node`（Node 24 默认类型剥离）。未跑 build / Electron / gradle / npm install；未触碰正式数据目录；未改任何仓库文件。
- **性能数字口径**：合成夹具、单次取值、Node 进程内、**不含渲染**。真实 renderer 的耗时受 React 提交、虚拟窗口、样式重算影响，量级参考；凡引用请连带 §1.4 的口径，不要与 `00`/`05` 的旧数字直接比较。
- **未取证**：真实 Electron 交互帧耗时；真实 5k×20 夹具；移动端真机字节对拍（「跨端不同字节」是**代码路径推断**——桌面有 `applyFontPolicy`、移动端没有，不是设备实测）；字数在两端的具体差异值。
- **在途改动**：A 止血批（`pullAll` 归档、`executePending` 降级、`archived.folder`）只触碰同步层，本文证据均在 `src/core` 正文模型与 `src/features` 宿主，行号若漂移请以符号名定位。

---

## 6. 用户裁决与实施状态（261028）

| 裁决 | 结果 | 实施 |
|---|---|---|
| CORE-04 表格 `ff` | **不做换字体功能，直接收敛成 core 常量** | ✅ 已实现：`USHEET_CANONICAL_FONT_FAMILY`（= base.css 字体栈）+ `normalizeUsheetWorkbook` 强制归一 defaultStyle/全部命名 styles；桌面删除 `lakeFontFamily/applyFontPolicy`（`usheetFont.ts` 删除）；移动端挂载/基线/capture 同函数。护栏：`usheetDoc.test.ts` 跨端逐字节相同 + base.css 同值断言；`usheetOpenReadOnly.test.ts` 禁止再出现 `lakeFontFamily/applyFontPolicy`。 |
| CORE-07 ink undo | **走推荐方案（操作日志 + 页级快照、全局 undo）** | ✅ 已实现：`features/ink/history.ts` 改为页级 `InkPatch`（before/after 页快照 + 页顺序；60 条 / 16MiB 预算，按补丁字符计），`InkPad.commit` 每次只整篇序列化一次，落笔/橡皮/背景/加删页/移页走 patch，undo/redo 跨页应用；测试 12 例（含 10MiB/100 页 ≥30 步、预算边界、无别名）。 |
| CORE-02/03 坏正文与「打开=只读」 | 未决 | 仍待排期；与 v4 M3 的 lifecycle/备份区一起做更顺。 |

**遗留文档同步**：`AGENTS.md` 的「移动端 usheet 保存路径尚未接同一 helper」「lakeFontFamily 抽到 usheetFont.ts」两条描述已过期（本轮实现后应删/改），留给 HANDOFF 收口批处理。

### 261028 第四轮实施状态

| 项 | 状态 | 说明 |
|---|---|---|
| CORE-01 多维表 markdown/ai 筛选 | ✅ 已修 | `evaluateFilter` 把 ai/markdown 并入文本分支（`bitableDisplayValue` + `textMatches`）；补 contains/startsWith/endsWith/isEmpty 等用例 |
| CORE-03 `quickNoteKeys` 死模块 | ✅ 已删 | 全仓 grep 确认零生产引用；`s3v3Keys` 补唯一来源注释 |
| CORE-04 表格 `ff` | ✅ 已修（上一轮） | canonical 常量 |
| CORE-07 ink undo | ✅ 已修（上一轮） | 页级 InkPatch |
| CORE-02 坏正文策略 | ✅ 已修（261028 第六轮） | 新增 `core/docBodySafety.ts · checkDocBody(kind,raw)`（usheet/board/ink：空=可编辑、非空解析失败=unreadable）；桌面 usheet/board、移动 usheet/board 坏正文只读横幅 + 禁保存/capture 恒 null；测试 126 文件 898 例 |
| CORE-03 「打开=只读」core 判据 | ✅ 已修（261028 第七/九轮） | `core/docBaseline.ts`；usheet（桌面/移动）、board（桌面）、ink（桌面/移动共用 InkPad）均已接；historyPreview board 判据统一到 `parseBoardBodyChecked`；移动 board 宿主也已接（261029 第十一轮） |
| CORE-09 正文上限散落 | ✅ 已修（261028 第七轮） | `storeLimits.MAX_DOC_BODY_BYTES` 单一来源；ipcLimits/s3v3Engine/imageFormat/registerQuickNotes 引用；字面量 grep 护栏 |
| CORE-05 导航归一在 core 外 | ✅ 已修（261028 第八轮） | `canonicalBitableNav` 进 core；桌面/移动两份 map 删除 |
| CORE-06 每次编辑全表重算 | ✅ 部分（261028 第八轮） | `bitableViewNeedsClock`（仅动态日期条件才读 clock）+ 填色投影循环外提/命中即跳过；**全表求值仍为定稿口径**，记录级缓存未做 |
| CORE-08 过去/未来 N 天多算一天 | ✅ 已修（261028 第八轮） | 改为含今天共 N 个日历日；跨月/跨年/闰日/边界用例 |
| CORE-10 字数口径输入源 | ✅ 已修（261028 第八轮） | `countTextStats` 单入口；docStats + 桌面/移动属性页（Lead 补两处）接入 |