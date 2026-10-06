# CSS 审计与验证工具（scripts/css-audit/）

这套脚本是 2026-09-15/16 那六轮「多层覆盖清理」用出来的，做两件事：**找出多余的样式声明**，以及
**证明删掉它们之后界面一个像素都没变**。判定只认整页计算值比对与像素批次，不认"看着像冗余"。

## 前置

- Node 24（`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`）。
- 一个跑起来的 dev 实例，CDP 端口 9222：`npm run dev`（或 `vite` 长驻 1421 + 手动 `electron --remote-debugging-port=9222 .`）。
- 跑之前**必须钉死状态**：主题（浅/深）、大纲增强、侧栏模式、当前文档。脚本内部会自己钉，但手工插脚本时必须照做——
  上一轮因为"上次测试留下的深色"和"两次打开不同文档"各误判过一次 5.9% / 29% 的假回归。

## 数据目录

所有中间产物默认写进仓库根的 `.css-audit/`（已 gitignore），可用环境变量 `LK_CSS_AUDIT_DIR` 改到别处。
**别放 `/tmp`**：重启就没了，上一轮就吃过这个亏（工具还在、数据没了）。

## 「同一交互多套实现」审计（260930）

上面那套是查**冗余声明**的；这两条是查**散落重复的操作模式**（用户 260930 要求把相同操作模式做成正式原语）：

```bash
node scripts/css-audit/audit-lookalike.mjs 0.62 7   # 像原语却没复用（命中数就是"还有多少没统一"）
node scripts/css-audit/audit-primitives.mjs         # 跨文件规则体重复族
```

判定与口径见 `AGENTS.md` §3#14「样式统一」与 `HANDOFF.md` §3 第 10 条（含已暂缓项与接手姿势）。

## 常用流程

```bash
cd <仓库根>

# 0) 采一次"实际加载顺序"（后面所有静态分析都以它为准）
node scripts/css-audit/drive.mjs 9222 scripts/css-audit/loadorder.mjs    # → loadorder.json

# 1) 证明验证装置本身是可信的：注入"未改动副本"，噪声必须为 0
node scripts/css-audit/drive.mjs 9222 scripts/css-audit/ab2.mjs "" self
# 对照组：注入一份"改后文本"，应该报出差异（若报 0 差异，说明装置坏了，别信后面的结果）
PLAN_FILE=<数据目录>/plan-applied.json node scripts/css-audit/drive.mjs 9222 scripts/css-audit/ab2.mjs "" plan

# 2) 像素批次（端到端兜底；批次内顺序必须固定，单屏不能当基线）
node scripts/css-audit/drive.mjs 9222 scripts/css-audit/shotset.mjs before "<屏列表>"
#   改完再跑一次 after，逐通道比对 PNG
```

`ab2.mjs` 的模式（第一个参数是状态过滤，`""` = 全部；第二个是模式）：

- `self`：注入未改动副本 → 噪声基线，必须 0。
- `plan`：读 `PLAN_FILE`（默认 `plan-applied.json`），对文件文本应用计划后注入 → 差异即"这计划会改变什么"。
- `control`：读 `plan-control.json`，用于证明装置能抓到真改动。

## 快照重烤的快速路径（260906 起：**态自包含**）

**先说结论**：改了某个界面后**不用再整轮跑 42 态**（一轮约 8 分钟）。装置已做到「每个态自包含」——
任意一个态单独采集，结果与整轮跑出来的**完全一致**（实测 `settings:1315:light` / `resources:1315:light`
单采指纹与全量逐字节相同）。所以只烤 / 只检改动到的那 1~2 个态即可，**秒级**：

```bash
cd <仓库根>
# 只采你改动到的态
node scripts/css-audit/drive.mjs 9231 scripts/css-audit/stylesnap.mjs myfix "resources:1315:light"
# 只复检这几个态（带了 --states，未采的态不在作用域内，不再报「本次未采集」）
node scripts/css-audit/check-stylesnap.mjs --port 9231 --states "resources:1315:light"
# 把这几态写进基线（--write-baseline 是整份覆盖；多态增量用脚本合并或全量重烤）
```

自包含靠三件事，都在 `stylesnap.mjs`：

1. `pin()` 每个态都 `Page.reload` + 钉主题/侧栏/大纲模式 + **清 `lake-notes-v3.dialog-states`**（否则夹具副本会带上「上一台机器把弹窗拖到哪、拉多大」，所有 settings 态整体位移）；
2. 每个态都**显式设置 CDP 媒体模拟**（没写的清空），避免 reduced-motion / transparency 泄漏到下一态；
3. 末态**归位鼠标并等「块拖动把手」收干净** —— 它带过渡，而 `settle()` 只等 DOM/几何稳定、不等过渡结束，
   否则 `settings:1315:light` 这类态连拍两份会出现「元素数相同、指纹不同」的 11 条假差异（260906 实测）。

**例外**：宽度 560/760 的窄窗态仍**跨实例世代不稳**（内核原生大纲 hover/resize 时序态），照旧只采集入库、
比对时跳过（`check-stylesnap.mjs` 的 `UNSTABLE`）。单独采窄窗态只为留档，**不能**用来判「没变」。

### 夹具 = **合成夹具**（260906 起；不含任何真实数据）

快照的输入有两份：**代码 + 数据**。早期夹具是「开发工作区的副本」，于是**用户每次增删文档都会让所有态一起漂**
（实测少 2 篇 = 每态 −40 个元素，看着像 CSS 变了），逼着整份重烤。现在夹具是**合成**的：
由 `scripts/css-audit/make-fixture.mjs` 走应用自己的 IPC 造出来，内容固定、零真实数据，怎么改自己的库都不影响基线。

```bash
cd <仓库根>
FX="$HOME/Library/Caches/lake-notes-css-audit/fixture"   # 冻结位置（缓存目录，不进 git）
RUN=/tmp/lake-fixture-build

# ① 空用户目录起实例（必须空：生成器要从零造）
rm -rf "$RUN"
env -u ELECTRON_RUN_AS_NODE LAKE_USER_DATA="$RUN" LAKE_ASSET_PORT=19810 \
  ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9231 .

# ② 造数据（另开一个终端）
node scripts/css-audit/drive.mjs 9231 scripts/css-audit/make-fixture.mjs

# ③ 收尾：删掉一个孤儿文件以造成「缺失」态 → 结束实例 → 冻结（DB 必须走 .backup，别 cp 热文件）
rm "$RUN/workspace-default/note-assets/<noteId>/<orphan 文件名>"
rm -rf "$FX" && mkdir -p "$FX"
cp -R "$RUN/workspace-default" "$RUN/Local Storage" "$RUN/Preferences" "$FX/"
/usr/bin/sqlite3 "$RUN/workspace-default/metadata.sqlite3" ".backup $FX/workspace-default/metadata.sqlite3"
rm -f "$FX/workspace-default/metadata.sqlite3-wal" "$FX/workspace-default/metadata.sqlite3-shm"

# ④ 整份重烤基线（只有**换夹具**时才需要整轮；平时改 CSS 只烤单态）
RUN2=/tmp/lake-run && rm -rf "$RUN2" && cp -R "$FX" "$RUN2"
env -u ELECTRON_RUN_AS_NODE LAKE_USER_DATA="$RUN2" LAKE_ASSET_PORT=19811 \
  ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9231 .
node scripts/css-audit/drive.mjs 9231 scripts/css-audit/stylesnap.mjs base
node scripts/css-audit/check-stylesnap.mjs --from .css-audit/snap/base.json --write-baseline
```

**合成夹具覆盖**（生成器保证）：富文本文档（标题/列表/代码/表格/图片）· 第二篇 · 表格 · 多维表 · 画板 · 两篇**同名**回收站文档
（守住「分组 key 不能只用 title」这条回归）· 小记 2 篇 · 四种资源：在正文被引用 / **只被历史引用**（历史保护）/ **纯孤儿**（可删）/ **登记在但文件已删**（缺失）。

**什么时候要重新生成 + 整份重烤**：只有想改基准数据时（改生成器、补覆盖面）。笔记 id 是 uuid ⇒ 每次生成都换一套 id，
所以重新生成之后必须整份重烤一次；平时改 CSS 只烤单态（见上一节）。

## 各脚本干什么

| 脚本 | 作用 |
| --- | --- |
| `drive.mjs` | 极简 CDP 驱动（Node 24 内置 WebSocket），`node drive.mjs <端口> <脚本.mjs>` |
| `inpage.mjs` / `css-audit.mjs` | 页内探测原语（计算值、简写→长属性映射、伪元素、屏与状态定义 `nav`/`SCREENS`） |
| `stylesnap.mjs` | 27 个状态的整页计算值快照（每元素 × ~90 属性 + 几何 + ::before/::after） |
| `ab2.mjs` | 文本级 A/B：注入改后的整份 CSS 文本，逐元素比计算值（0 容差） |
| `shotset.mjs` | 多屏 × 宽度 × 主题的静态截图集（像素批次） |
| `loadorder.mjs` | 采当前实际加载顺序 → `loadorder.json` |
| `imp-scan.mjs` | 扫 `!important`，挑出"同选择器文本下没有更晚的非 important 竞争者"的候选 |
| `imp-safe.mjs` | 对每个候选逐状态判定"去掉后仍赢"→ `imp-safe.json` / `imp-risky.json` |
| `plan-imp.mjs` | 生成可执行清单 `plan-imp.json`（剔除移动端入口也加载的文件） |
| `allsel.mjs` / `condcollect.mjs` | 收集全部选择器 / 全部 `@media` 条件 |
| `fingerprint-all.mjs` | 为每个选择器跨状态打"命中了哪些元素"的指纹 → `fingerprints-all.json`（~3.4 MB，按需重生成） |
| `plan-l2-shadowed.mjs` | 找"整条规则被更高层同名选择器完全压制"的可删规则（同 `@media` + 同单选择器 + 高层覆盖全部属性）；`--apply` 按源码区间删除并剪掉变空的 `@media` 壳 |
| `l3-plan.mjs` | L3 安全筛选（260923）：零命中 **且** 类名在应用代码里无生产者（含动态模板串前缀，保守）才判可删；依赖 `fingerprints-all.json` |
| `audit-lookalike.mjs` | **260930 大统一**：以 kit 的 `.ln-*` 控件级原语为签名，找「**长得像原语却自己写了一套**」的规则（加权相似度：同名同值 1.0 / 同名长度类 0.45 / 阈值 0.62）。用法 `node scripts/css-audit/audit-lookalike.mjs [阈值] [原语最小声明数]` |
| `audit-primitives.mjs` | **260930 大统一**：找**跨文件、跨类名的规则体重复族**（同一套声明被写在多个不同选择器里）——同类里出现 ≥2 个不同「身份」才报。用法 `node scripts/css-audit/audit-primitives.mjs` |

典型链路：`loadorder` → `allsel` → `fingerprint-all` → `condcollect` →（`drive` 跑 `cond-eval`）→ `imp-scan` → `imp-safe` → `plan-imp`。

## 六条已经踩过的坑（改这些脚本前先读）

1. **伪元素**：`querySelectorAll(".a::before")` 不抛错、直接返回 0 ⇒ 伪元素规则会被误判成"没命中元素"。要显式识别 + 用 `getComputedStyle(el, "::before")` 读值。
2. **页内读值不可信**：改完 CSSOM 后页内 `getComputedStyle` 可能仍返回旧值，CDP 读才是新值。判定要一致地用同一条路径。
3. **简写属性**：`getPropertyValue("background")` 返回空串，`removeProperty("background")` 也不连带移除展开出的长属性 ⇒ `background` 简写的自动删除一律不做（19 条候选经批次实测确实承重）。
4. **keyframes 在 CSSOM 里没有 `selectorText`**：按 `r.selectorText && r.style` 枚举会整段跳过子规则，做"磁盘 vs 浏览器"对齐或按序号操作时必须排除它们。
5. **空壳规则**（`selector { }`）会让"选择器第几次出现"的序号与浏览器对不上：要么整条删（并断言守恒），要么不动。
6. **单屏像素不能当基线**：设置面板会记住尺寸/位置，单独跑与整批跑同一屏差 17.7%。像素基线必须"同一批、同一顺序"重跑。

## 七、`@import` 内联带来的验证陷阱（260916 踩了两次，务必先读）

`src/styles.css` 现在只是一个 `@import` 编排入口：**`app/*.css` 会被 Vite 内联进 `styles.css` 那一张表，
它们没有独立的样式表**。由此有两个必踩的坑：

1. **按文件名注入"改动前"会静默失效**：`ab2` 的 spec 里写 `{file: "src/styles/app/quick-notes.css", ...}`，
   注入器找不到这张表 → 报 `missing`、根本不生效，于是"改动前后 0 差异"是**假的**。
   正确做法：把改动前的**整份内联内容**按 manifest 顺序拼接，注入到 `src/styles.css` 那一张表。
2. **跨层搬家（规则换到另一张表）必须把目标表也换回改动前**，否则规则在两处各出现一次、
   等于"重复应用"，给出的差异/一致都不可信。260916 就因此误判过一次"合并安全"：
   正确口径实测是 **4906 处计算值差异**（典型：`.activity-rail` 的 `padding` 从基础层搬到壳层后反超
   `b3/layout.css` 的 `padding-top: var(--topbar-height)`，活动栏整体上移 38px）。

**判据**：一条规则"从前面的层搬到后面的层"是否安全，等价于问"它原来是不是**故意输给**后面那些规则的"。
本项目里这类"自愿认输"的规则不少（这也是"基础层 + 覆盖层"两层结构的由来），所以跨层合并只能逐条二分，
没有整批搬的安全路径。

## 八、像素批次的状态漂移（同批同序也救不了）

`shotset` 的屏幕靠 `nav.rail(i)` 切视图。它原先用**写死坐标** `(19, 54/86)` 点活动栏，
而按钮实际在 `y=2/34` ⇒ 点击落空或点错按钮，截图落到别的视图（曾因此报出 74% 的"差异"，实为状态漂移）。
现在改为**按 DOM 取第 i 个 `.activity-button` 的中心**。排查这类问题用 `probe-list.mjs`：
`node drive.mjs 9222 probe-list.mjs ".activity-button"` 直接列出全部匹配元素的几何。

## 状态矩阵

`stylesnap.mjs` 里的 `STATES` 是判定"是否真的没变"的覆盖面。当前 **42 个**：浅/深/warm × 1315/760/560 ×
（资料库 / 小记 / 搜索 / 设置各页 / **资源空间** / 悬停行 / 右键菜单 / 属性面板 / 大纲展开 / 拖拽注入 / 已删标签 / 浮侧栏 / reduced-motion / 画板注入…）。
**260906**：设置·资源已从设置弹窗**提出来成独立空间**（`resources`），对应态由 `settings-assets` 换成 `resources:1315:light`。
**已知空缺**（要动编辑器内部或标签相关样式时先补）：多标签、大纲缩放中、编辑器内部态（代码块/表格/文件卡）、
选区与粘贴态。

**⚠️ 覆盖不足 ⇒ L3「零命中」会假阳性（260923 实测）**：`fingerprint-all` 的 42 态**不覆盖**"大纲增强=开"、多维表、编辑器内部态，
于是 `.outline-sidebar`、`.bt-*`、quick-notes 内部类等**活功能**在全部 42 态都零命中——直接按 L3 删会误删这些功能的样式
（`outline.css` 253 声明、`bitableEditor.css` 856 声明都会被带出）。**L3 必须叠加"类名在应用代码里没有生产者"过滤**
（`l3-plan.mjs`），或先把状态矩阵补到覆盖这些功能；否则只能用 L2（层叠判定，与状态覆盖弱相关）。
**但 260923 实测：真正的约束是"代码生产者"而非覆盖** —— 42 态 1112 个零命中里，**1099 个的类名在应用代码中都有生产者**（含 \`outline-item__level--\${d}\` 这类动态模板串，故过滤要按"前缀"保守判定）。
叠加该过滤后只剩 3 个选择器 / 1 条整规则 ⇒ **L3 在本仓并无可证的死代码**，补矩阵不会增加安全产出。
