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

典型链路：`loadorder` → `allsel` → `fingerprint-all` → `condcollect` →（`drive` 跑 `cond-eval`）→ `imp-scan` → `imp-safe` → `plan-imp`。

## 六条已经踩过的坑（改这些脚本前先读）

1. **伪元素**：`querySelectorAll(".a::before")` 不抛错、直接返回 0 ⇒ 伪元素规则会被误判成"没命中元素"。要显式识别 + 用 `getComputedStyle(el, "::before")` 读值。
2. **页内读值不可信**：改完 CSSOM 后页内 `getComputedStyle` 可能仍返回旧值，CDP 读才是新值。判定要一致地用同一条路径。
3. **简写属性**：`getPropertyValue("background")` 返回空串，`removeProperty("background")` 也不连带移除展开出的长属性 ⇒ `background` 简写的自动删除一律不做（19 条候选经批次实测确实承重）。
4. **keyframes 在 CSSOM 里没有 `selectorText`**：按 `r.selectorText && r.style` 枚举会整段跳过子规则，做"磁盘 vs 浏览器"对齐或按序号操作时必须排除它们。
5. **空壳规则**（`selector { }`）会让"选择器第几次出现"的序号与浏览器对不上：要么整条删（并断言守恒），要么不动。
6. **单屏像素不能当基线**：设置面板会记住尺寸/位置，单独跑与整批跑同一屏差 17.7%。像素基线必须"同一批、同一顺序"重跑。

## 状态矩阵

`stylesnap.mjs` 里的 `STATES` 是判定"是否真的没变"的覆盖面。当前 27 个：浅/深 × 1315/760/560 ×
（资料库 / 小记 / 搜索 / 设置九个页 / 悬停行 / 右键菜单 / 属性面板 / 大纲展开 / 拖拽注入 / 已删标签 / 浮侧栏…）。
**已知空缺**（要动编辑器内部或标签相关样式时先补）：多标签、大纲缩放中、编辑器内部态（代码块/表格/文件卡）、
选区与粘贴态。
