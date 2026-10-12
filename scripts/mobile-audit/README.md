# scripts/mobile-audit — 移动端 UI 走查 / 快照门禁（W0-b）

## 为什么不能只用浏览器预览
`scripts/mobile-preview.sh` + `scripts/mobile-audit/shell`（390×844 Electron 壳）只加载 `dist-mobile/index.html`；
但移动端启动依赖 **Capacitor 原生 SQLite**（`window.Capacitor.Plugins.CapacitorSQLite`）—— 浏览器里只有 web 壳、
没有原生实现 ⇒ **实测停在 `MobileApp` 的 booting 态**（`<div class="poc-center">启动中…</div>`）。
⇒ **快照门禁必须跑在模拟器（真实原生桥）上**。`shell/` 保留备用（等移动端有 web 回退实现时可直接启用）。

## 环境（260923 实测可用）
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
bash scripts/emu-up.sh --no-window              # AVD lake_mobile；起来后 adb devices 应见 emulator-5554
bash scripts/android-build.sh --sync --install  # sync dist-mobile → gradle assembleDebug → adb install → 启动 App
bash scripts/emu-cdp.sh                         # 转发 webview_devtools_remote_* → tcp:9335
curl -s http://127.0.0.1:9335/json/list         # 校验 type==page
```
收尾：`adb emu kill`（**不要** pkill emulator / Electron）。

> ⚠️ **每次 `android-build.sh --install` 之后必须重跑 `emu-cdp.sh`**：APK 重装会重启 App，
> WebView 的 devtools socket 名会变 ⇒ 旧的 9335 转发指向**死 socket**（实测：重装后直接快照会让 Node 直接崩，
> 快照文件缺失，进而把门禁误报成"未报差异"）。

## 实测设备事实（260923）
- viewport **412×842**（dpr 2.625；设备 1080×2209）
- `#root` → `div.mobile-app`（已过 booting）；`window.lakeNative` 存在
- 首页：`.mobile-home` / `.mobile-home-tabs` / `.mobile-htab`（小记 · 知识库）/ `.home-section` / `.home-recent` /
  `.doc-card`（最近文档）/ `.nb-shelf` / `.nb-shelf-card`（笔记本书架）/ `.mobile-bottom-bar__item` /
  `.toolbar__button`（设置 / 切换列表）
- ⚠️ 模拟器沙盒里有**历史数据**（多笔记本/笔记）⇒ 快照状态必须**先钉死到确定入口**，不能依赖现场数据。

## 261012 重烤与装置修复（移动端 UI 独立化 P0 前置）

- **基线重烤（用户 261012 授权）**：旧基线是 **260923 空库态**采集的（每态 51/35/129 元素），
  与当前真实库（1755/1840/1833 元素）差 6/6 态 ⇒ 每次门禁都红，门禁形同虚设。本轮在
  **设备 1080×2400 / density 420（无 override）**、lake_mobile AVD、应用为 261012 批构建的
  条件下重烤：node scripts/mobile-audit/check-mobile-snap.mjs --write-baseline。
  **重烤后连跑两轮门禁 = 6 态 0 差异**（装置自证通过）。
- **装置缺陷修复（真因，非产品问题）**：mobile-snap 复用的 stylesnap 表达式里，
  「内核自动发的正文文本节点 id（形如 u 加十六进制，跨 reload 不稳定）」原本只按 **≥6 位**忽略；
  移动端内核实例发的是 **4 位**（实测 u80ff / u0e0b）⇒ home-quicknotes 态两条内核兜底预览
  每轮换一个 key 前缀，表现为「元素数相同、指纹不同」，连拍两份必红。
  修法 = stylesnap.mjs 导出 snapExpr(kernelIdMinLen)（**表达式仍是同一份**，不另写第二套），
  桌面用 6、移动端用 4。桌面 check:stylesnap 的表达式未变（SNAP_EXPR = snapExpr(6)）。
- **模拟器分辨率**：重烤前把 wm size/density 从 override（540×1200 @210）**reset 回物理值**
  （1080×2400 @420）⇒ CSS viewport 412×842，与本文档「实测设备事实」一致，避免基线绑在非常规档位。

## ⚠️ 261012 P2 实测：首页态的「冷/暖」取样差异（重烤必须从暖态取）

- 现象：同一个构建连跑门禁，**首次运行**（恰好跟在上一轮设备走查之后）home-library 取到 **1784** 元素，
  之后每次都是 **1755**；home-library-list 偶发 1691/1755。差值 29 ≈ 三个文档卡。
- 判定：**装置取样时机问题**，不是产品差异 —— 首页「最近文档」在启动后会随一次异步刷新重排。
- 处置：① settle() 从「3 次稳定 × 200ms」收紧到「6 次稳定 × 300ms」且要求无瞬时提示条；
  ② **基线必须从暖态取**：先跑一次拿到 .css-audit/snap/warm1.json，再
  node scripts/mobile-audit/check-mobile-snap.mjs --from .css-audit/snap/warm1.json --write-baseline。
  直接用 --write-baseline（= 第一轮取样）会把 1784 烤进基线 ⇒ 之后每次都红。
- 待办：把「最近文档」的异步重排时机钉死（或在该态显式等待列表条目数稳定），从根上去掉这个坑。

## 待办（下一步）
1. `mobile-states.mjs`：状态列表（首页·小记 / 首页·知识库书架 / 知识库列表 / 打开文档 / 编辑器 Dock / 小记编辑 / 设置抽屉），每态 DOM 导航 + 等静默。
2. `mobile-snap.mjs`：复用桌面 `stylesnap` 的 SNAP（body * × ~90 计算属性 + 几何 + 伪元素，DJB2 哈希）。
3. `check-mobile-snap.mjs`：CDP 存活检查 → 生成 → 与紧凑基线（每态元素数 + 合并哈希）比对 → 有差异 exit 1；去抖重跑。
4. `package.json` 加 `check:mobilesnap`；基线入库（几 KB）。
5. 装置自证：同条件连拍两份 0 差异 + control（改一个 CSS 值必须被抓到）。
