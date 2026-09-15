# 窄窗彻底统一（B 方案）· 新会话施工简报

> 用法：新会话第一句直接贴本文末尾的「启动语」。本文是自包含的——目标、配对关系、状态矩阵、
> 诊断手段、门禁、已知残留全在里面；配合 `HANDOFF.md §2.39` 使用。
> 起点：分支 `polish/ui-ux-260914`，基线提交 **`4a68071`**（工作区干净，master 已同步）。

## 1. 目标（用户拍板：选 B，要彻底，不要东拼西凑）

**壳层规则只留一份**：把现在写在 `@media (min-width: 761px)` 里的桌面壳层规则，**成对**搬到共用作用域；
窄窗块（`@media (max-width: 760px)`）里我手抄的那些副本全部删除，只保留"真·窄窗增量"
（例如：正文 `minmax(148px, 1fr)` 下限这类本来就需要按宽度变化的项）。

**验收（定义完成）**：把窗口从 1315px 连续拖到 416px，**只允许出现"列宽线性压缩"**；
不允许任何元素的位置、边框、底色、显隐在某个像素处突变。

## 2. 为什么必须"成对"（已翻车两次，务必先读）

| 事件 | 症状 | 教训 |
| --- | --- | --- |
| 只搬顶栏 `position: fixed` | 面包屑被顶栏压住（用户截图） | 顶栏几何 ↔ 文档区让位**是一对**，必须同一次搬 |
| 整块解开 20 个媒体查询（`9399c1d`） | 顶栏与面包屑叠字 | 一把梭必炸，已 `c9882c1` 回滚 |

## 3. 成对清单（搬 A 必须同时搬 B）

| 组 | A 侧（几何） | B 侧（让位/搭档） | 现所在位置 |
| --- | --- | --- | --- |
| 1 顶栏 | `.tab-bar { position: fixed; top/left/right: 0; height: var(--topbar-height); z-index: 400; background: transparent; border-bottom: 0 }` | `.document-pane { margin: calc(var(--topbar-height) + 4px) 0 0 }` | A：`b3/layout.css` 第 1 个媒体块；B：`styles.css` 约 1825 行（同在 min-width 块内） |
| 2 左轨 | `.activity-rail { margin-top: 0; padding-top: var(--topbar-height); background: transparent; border: 0 }` | `.activity-button { display: grid; place-items: center; width/height: 28px; margin: 2px 0; border: 0; border-radius: 6px; color: var(--lake-text-secondary); background: transparent }` | A：`b3/layout.css`；B：`styles.css` 约 553 行 |
| 3 顶栏按钮 | `.toolbar__item { border: 0; background: transparent }`；`.tab-switcher { border: 1px solid transparent; background: rgba(255,255,255,.48); border-radius: 8px }` | 自身成对 | `styles.css` min-width 块 |
| 4 标签与关闭 | `.tab-item { height: 28px; border: 1px solid transparent; background: rgba(255,255,255,.42) }`；`.tab-close` 的显隐 | 自身成对 | `styles.css` min-width 块 |
| 5 状态栏 | `.statusbar { position: static; background: var(--b3-body-background) }` | 无 | `b3/layout.css` |

搬完每组后，**同时**删掉 `styles.css` 窄窗块里对应的手抄副本：
`.tab-bar` / `.tabbar-leading` / `.tab-items` / `.tab-item` / `.activity-rail` / `.activity-button` / `.workspace { padding-top }`。

## 4. 状态矩阵（每种状态都要看，别只看一种）

`{760, 900} × {sidebar 收起(collapsed), 展开(docked)}` 四种；再补 `1315` 一档做宽窗基线。

## 5. 诊断手段（先看清谁在赢，再动手）

```js
await page.send("DOM.enable"); await page.send("CSS.enable");
const doc = await page.send("DOM.getDocument", { depth: -1 });
const q = await page.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: ".tab-bar" });
const m = await page.send("CSS.getMatchedStylesForNode", { nodeId: q.nodeId });
// m.matchedCSSRules[].rule.selectorList.text
// m.matchedCSSRules[].rule.style.cssProperties[].{name,value,important}
```
已知用它查出的两件事：`.tab-switcher` 的"框"来自 `background: rgba(255,255,255,.48)`（不是 border）；
`.tab-bar` 的 fixed 曾被窄窗块里一条遗留 `position: static` 覆盖（已删）。

## 6. 门禁（两条都过才允许提交）

- **门禁 A（窄窗）**：四种状态截图 + 量值 —— `bar box == [0,0,W]`、`document y == 42`、
  `rail button y` 与宽窗一致、`scrollWidth == 视口宽`、无重叠。
- **门禁 B（宽窗）**：1315px 改动前后像素 **0 差异**；先跑"同源连跑对照"得到噪声基线
  （设置弹窗会记住尺寸位置，噪声可达 3%，别把状态差当回归）。

任一门禁不过 ⇒ **该组整体回退**，不提交；不要用 `!important` 去压。

## 7. 已知残留（本轮未解，先诊断再改）

- 760px **收起态**下读到 `bar [38,4,718]`（应为 `[0,0,718]`）——该状态下另有规则覆盖 fixed 几何；
  按 §5 先定位来源，再按"成对"或"删除擦除层"的方式处理。
- 用户圈的"月亮右侧按钮有边框"= `button.tab-switcher` 的半透明白底（见 §5）。

## 8. 环境与工具

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev                # vite(1421) + electron(9222)，需 tty 长驻
npx tsc --noEmit && npx vitest run          # 期望 969 passed / 16 skipped
npx vite build && npx vite build -c vite.mobile.config.ts
```
- CDP 工具（上一轮留下的，可直接复用）：`/tmp/lkcdp/drive.mjs`（驱动）、`qtb.mjs`/`qcolor.mjs`/`qcaret.mjs`
  （量顶栏/轨/按钮）、`shots.mjs` + `pixdiff.mjs`（截图与像素比对，用 `sharp`）。
- 反复踩的坑：① 窄窗/宽窗都要看，别只测一档；② 像素比对必须先做同源连跑基线；
  ③ 点小记「编辑」会留下未保存草稿 → 之后导航会弹 **Electron 原生确认框**，会把 renderer 卡死。

## 9. 启动语（贴这句即可）

> 按 `HANDOFF.md §2.39` + `docs/NARROW-UNIFY-BRIEF-260915.md` 做窄窗彻底统一（B 方案）：
> 成对搬运壳层规则到共用作用域、删掉窄窗里的手抄副本，每一步都过"窄窗四状态 + 宽窗 1315 像素 0 差异"
> 双门禁后再提交；起点 `4a68071`。
