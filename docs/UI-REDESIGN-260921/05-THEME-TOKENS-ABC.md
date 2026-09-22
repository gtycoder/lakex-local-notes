# 05 · 三套主题取值（A 亮蓝 / C 亮橙 / B 暗紫）

> 状态：**用户已确认三套全保留**（2026-09-22）  
> 映射到现有键名：`src/styles/themes/*.css`（**只改值、少加键**，组件 CSS 不动）  
> 关联：`04-LAYOUT-SPACE-SPEC.md` · 交互预览 `space-icon-variants.html` / `style-directions.html`

---

## 1. 主题注册（`src/lib/themes.ts`）

| id | 显示名 | colorScheme | 文件 | 角色 |
| --- | --- | --- | --- | --- |
| `light` | 亮 · 蓝 | light | `themes/light.css` | **默认浅色（A）** |
| `warm` | 亮 · 橙 | light | `themes/warm.css` | 浅色备选（C，MiMo×笔记） |
| `dark` | 暗 · 紫 | dark | `themes/dark.css` | **深色基线（B）** |

- `data-theme` 驱动；「跟随系统」仍不做（原决策）。
- `themes/base.css`：几何/动效/阴影结构/媒体查看器等**主题无关**值，三套共用。

---

## 2. 设计语义（三套共用键名）

沿用 `--lake-*` 既有键，语义不变：

| 组 | 键 |
| --- | --- |
| 表面 | `bg-window / bg-panel / bg-canvas / bg-block / bg-raised / bg-sunken / bg-hover / bg-press` |
| 文字 | `text-1..4` · `text-on-accent` |
| 边框 | `border-1 / border-2 / border-strong` |
| 主色 | `accent / accent-ink / accent-ink-hover / accent-ink-press / accent-tint / accent-text` |
| 状态 | `status-sync/pending/ok/error` + `-soft` |
| 选区/焦点 | `select-bg` · `scrim` · `scrollbar-*` · `focus-halo` · `focus-ring-*` |
| 阴影 | `shadow-card / shadow-popover / shadow-dialog / shadow-drag` + `shadow-color-*` |

**新增键（布局需要时）**：无强制；空间图标软底直接用 `accent-tint` + `accent-text`。

---

## 3. A · 亮 · 蓝（默认浅色）

气质：MiMo Desktop —— 近白侧栏、软卡片、蓝点缀、大留白。

### 3.1 表面

| 键 | 值 | 说明 |
| --- | --- | --- |
| `bg-window` | `#f4f5f7` | 窗口/顶栏底 |
| `bg-panel` | `#ffffff` | 侧栏卡片/面板 |
| `bg-canvas` | `#ffffff` | 正文纸面 |
| `bg-block` | `#f0f2f5` | 分组卡/输入底 |
| `bg-raised` | `#ffffff` | 选中段/浮起块 |
| `bg-sunken` | `#eef0f3` | 进度槽 |
| `bg-hover` | `#e9ebee` | hover（实色，延续优化批次） |
| `bg-press` | `#e4e7eb` | press |

### 3.2 文字 / 边框

| 键 | 值 |
| --- | --- |
| `text-1` | `#17191c` |
| `text-2` | `#4a5158` |
| `text-3` | `#6d757e` |
| `text-4` | `#9aa1aa` |
| `text-on-accent` | `#ffffff` |
| `border-1` | `#e8eaee` |
| `border-2` | `#f0f2f5` |
| `border-strong` | `#d5d9de` |

### 3.3 主色（蓝）

| 键 | 值 |
| --- | --- |
| `accent` | `#3d7eff` |
| `accent-ink` | `#2f66e0` |
| `accent-ink-hover` | `#2a5ccc` |
| `accent-ink-press` | `#244eb0` |
| `accent-tint` | `#eaf1ff` |
| `accent-text` | `#1f4fc2` |

> 注：优化批次曾用 `#4f6bb8`。本规格 A 取更亮的 MiMo 蓝 `#3d7eff`；若要更沉，可回退 `#4f6bb8`（一键改 `accent` 族）。

### 3.4 状态（可沿用现值）

`status-*` 与现 `light.css` 保持一致即可（对比度已过 AA）。

---

## 4. C · 亮 · 橙（warm 文件 · MiMo×笔记）

气质：同 A 的结构，主色换 MiMo 橙；侧栏略沉一档；阅读区保持纯白。

### 4.1 表面（与 A 的差异加粗）

| 键 | 值 | 与 A 比 |
| --- | --- | --- |
| `bg-window` | `#f6f7f8` | 同 |
| `bg-panel` | `#ffffff` | 同 |
| `bg-canvas` | `#ffffff` | 同 |
| `bg-block` | `#f0f2f4` | 略沉 |
| `bg-raised` | `#ffffff` | 同 |
| `bg-sunken` | `#eef0f3` | 同 |
| `bg-hover` | `#e9ebee` | 同 |
| `bg-press` | `#e4e7eb` | 同 |

### 4.2 文字 / 边框

| 键 | 值 |
| --- | --- |
| `text-1` | `#1a1d21` |
| `text-2` | `#495057` |
| `text-3` | `#6f7780` |
| `text-4` | `#939aa3` |
| `border-1` | `#e4e6ea` |
| `border-2` | `#eef0f3` |
| `border-strong` | `#d0d4da` |

### 4.3 主色（橙）

| 键 | 值 |
| --- | --- |
| `accent` | `#ff6a00` |
| `accent-ink` | `#e85d00` |
| `accent-ink-hover` | `#d15400` |
| `accent-ink-press` | `#b84a00` |
| `accent-tint` | `#fff1e6` |
| `accent-text` | `#c44e00` |

### 4.4 状态

| 键 | 值 |
| --- | --- |
| `status-ok` | `#2e7b54` |
| `status-ok-soft` | `#e9f2ec` |
| `status-pending` | `#9b610e` |
| `status-pending-soft` | `#f7f0e3` |
| `status-error` | `#b3413b` |
| `status-error-soft` | `#f8eae9` |
| `status-sync` | `#2c7684` |
| `status-sync-soft` | `#e8f1f2` |

---

## 5. B · 暗 · 紫（dark 文件 · Obsidian 向）

气质：深底分层 + 1px 描边，避免糊成一团；紫点缀。

### 5.1 表面

| 键 | 值 |
| --- | --- |
| `bg-window` | `#1a1b1e` |
| `bg-panel` | `#25262b` |
| `bg-canvas` | `#1e1f22` |
| `bg-block` | `#2a2b30` |
| `bg-raised` | `#2a2b30` |
| `bg-sunken` | `#141517` |
| `bg-hover` | `rgba(255,255,255,.06)` |
| `bg-press` | `rgba(255,255,255,.10)` |

### 5.2 文字 / 边框

| 键 | 值 |
| --- | --- |
| `text-1` | `#e3e4e6` |
| `text-2` | `#a8a9ad` |
| `text-3` | `#7c7d82` |
| `text-4` | `#5c5d62` |
| `text-on-accent` | `#ffffff` |
| `border-1` | `#2e2f34` |
| `border-2` | `#242528` |
| `border-strong` | `#3a3b42` |

### 5.3 主色（紫）

| 键 | 值 |
| --- | --- |
| `accent` | `#9b94ff` |
| `accent-ink` | `#7f76ff` |
| `accent-ink-hover` | `#8f87ff` |
| `accent-ink-press` | `#6f66f0` |
| `accent-tint` | `rgba(155,148,255,.14)` |
| `accent-text` | `#b7b1ff` |

### 5.4 状态

| 键 | 值 |
| --- | --- |
| `status-ok` | `#6cc392` |
| `status-ok-soft` | `rgba(108,195,146,.14)` |
| `status-pending` | `#e0ac63` |
| `status-pending-soft` | `rgba(224,172,99,.14)` |
| `status-error` | `#ef8b84` |
| `status-error-soft` | `rgba(239,139,132,.14)` |
| `status-sync` | `#6fc0cc` |
| `status-sync-soft` | `rgba(111,192,204,.14)` |

### 5.5 阴影（深色更重）

| 键 | 值 |
| --- | --- |
| `shadow-card` | `0 1px 2px rgba(0,0,0,.40)` |
| `shadow-popover` | `0 0 0 1px rgba(255,255,255,.07), 0 24px 56px -18px rgba(0,0,0,.62)` |
| `shadow-dialog` | 同 popover 再加一层深投影（可沿用现 dark） |

---

## 6. 不随主题变（`themes/base.css`）

- 间距阶、圆角阶、字号阶、动效时长/缓动
- `--lake-media-*`（媒体查看器恒暗底）
- 焦点环宽度/偏移结构
- 滚动条**结构**（色值可随主题，见现文件）

---

## 7. 第三方桥接（只映射，不改内核）

| 目标 | 做法 |
| --- | --- |
| lakex `--lakex-editor-*` | 映射到 `accent` / `select-bg` / `bg-canvas` / `text-1` |
| FortuneSheet / drawnix | 容器壳用 `bg-canvas` + `border-1`；内部观感不动 |
| 内核原生大纲 | **不接主题桥**（零改动） |

---

## 8. 对比度门槛

- 正文 `text-1/2` vs `bg-canvas` ≥ **AA (4.5:1)**
- 次要 `text-3` vs 面 ≥ **4.5:1**（说明文）或 **3:1**（大字/图标）
- `accent-text` vs `accent-tint` ≥ 4.5:1（选中行）
- 实现后跑一次对比度脚本（P2 曾用），三套全过再提交

---

## 9. 落地步骤（编码会话）

1. 改 `themes/light.css` → **A** 取值；`themes/warm.css` → **C**；`themes/dark.css` → **B**。
2. `src/lib/themes.ts` 显示名改为「亮 · 蓝 / 亮 · 橙 / 暗 · 紫」。
3. 跑 `node scripts/ui-metrics.mjs`（颜色字面量仍只准出现在 `themes/`）。
4. 逐屏截图：主界面 / 设置 / 回收站 / 小记 × 三主题。
5. 对比度脚本过 AA。

**不要**改 kit/chrome 的选择器结构来「适配颜色」；颜色只走令牌。
