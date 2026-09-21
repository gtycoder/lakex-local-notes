# 02 · 字体（可替换机制 + 候选清单）（P3）

> 目标：字体**可替换**（用户要「多试几个再定默认」）。本轮只建机制 + 试用切换器，**默认字体待用户选定后**写回令牌。

## 1. 三个令牌（都在 `src/styles/themes/base.css`，主题无关）

| 令牌 | 作用 | 现状 |
| --- | --- | --- |
| `--lake-font-family` | **界面**字体（外壳/菜单/设置/列表） | 系统栈（SF Pro + 苹方/冬青黑/雅黑） |
| `--lake-font-family-reading` | **正文**（编辑器）字体；缺省跟随界面 | 系统栈 |
| `--lake-font-family-mono` | **等宽**（代码块/键名） | `ui-monospace, SFMono-Regular, SF Mono, Menlo, …` |

技术事实：**内核不暴露字体变量**，但编辑器正文字体一直由我们自己的规则控制（`src/styles/feature.css` 的 `.lake-editor-mount .ne-viewer-body/.ne-engine`）⇒ 属「外围」，不算改内核。
旧规则在 legacy 层 `styles/editor.css`，feature 层同选择器天然胜出（已实测）。

## 2. 开发期试用切换器（仅 dev）

`src/lib/fontTrial.ts`，由 `src/main.tsx` 在 `import.meta.env.DEV` 下动态 import：
- **不进设置项、不落盘**；刷新即回到默认。
- **生产产物里已被 tree-shake**（实测 `dist/assets/*.js` 搜不到 `__lakeFontTrial`）。
- dev 控制台/自动化：

```js
__lakeFontTrial.list()            // 候选 + 本机是否可用（document.fonts.check）
__lakeFontTrial.apply("songti")   // 试用（只改三个 CSS 变量）
__lakeFontTrial.current()         // 当前 id
__lakeFontTrial.reset()           // 还原默认
```

## 3. 候选清单（本机实测可用性）

本机字体目录实测：**有** 冬青黑体（Hiragino Sans GB）、宋体（Songti）、黑体-简（STHeiti）、Menlo；**未见** 苹方（PingFang）与思源黑体的独立字体文件（CSS 里保留在栈中，装了就自动生效）。

| id | 名称 | 首选字体 | 本机 |
| --- | --- | --- | --- |
| `system` | 系统默认（SF Pro + 苹方/冬青黑） | `-apple-system, BlinkMacSystemFont` | ✅ |
| `pingfang` | 苹方 PingFang SC | `PingFang SC` | 待确认（未见字体文件） |
| `hiragino` | 冬青黑体 Hiragino Sans GB | `Hiragino Sans GB` | ✅ |
| `songti` | 宋体 Songti SC（衬线） | `Songti SC` | ✅ |
| `heiti` | 黑体-简 STHeiti | `STHeiti` | ✅ |
| `kaiti` | 楷体 Kaiti SC（衬线） | `Kaiti SC` | 待确认 |
| `sourcehan` | 思源黑体 / Noto Sans CJK SC | `Source Han Sans SC` | 待确认 |
| `lxgw` | 霞鹜文楷 LXGW WenKai | `LXGW WenKai` | 需自行安装 |

> `__lakeFontTrial.list()` 的 `available` 字段是本机实时判断，比本表准。

## 4. 验证（P3 实测）

- 门禁：`tsc` 0 · `vitest` 1210 passed/16 skipped · `check:core` 0 · `check:bundle` app-css 195KB/2MB · `git diff --check` 干净。
- 字体令牌生效：把 `--lake-font-family` / `--lake-font-family-reading` 设为 `"Songti SC", "Songti TC", serif` 后，
  `getComputedStyle` 实测 **界面 body / 目录行 / 编辑器正文** 三处同时变为该栈，截图可见全文宋体。
- 生产 tree-shake：产物搜不到 `__lakeFontTrial`。

## 5. 待用户决定

1. 默认字体最终选哪款（试完告知即可，我写回 `base.css`）；
2. 是否**开放给用户**在设置里换（属新功能；本轮只做机制）。
