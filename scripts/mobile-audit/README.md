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

## 实测设备事实（260923）
- viewport **412×842**（dpr 2.625；设备 1080×2209）
- `#root` → `div.mobile-app`（已过 booting）；`window.lakeNative` 存在
- 首页：`.mobile-home` / `.mobile-home-tabs` / `.mobile-htab`（小记 · 知识库）/ `.home-section` / `.home-recent` /
  `.doc-card`（最近文档）/ `.nb-shelf` / `.nb-shelf-card`（笔记本书架）/ `.mobile-bottom-bar__item` /
  `.toolbar__button`（设置 / 切换列表）
- ⚠️ 模拟器沙盒里有**历史数据**（多笔记本/笔记）⇒ 快照状态必须**先钉死到确定入口**，不能依赖现场数据。

## 待办（下一步）
1. `mobile-states.mjs`：状态列表（首页·小记 / 首页·知识库书架 / 知识库列表 / 打开文档 / 编辑器 Dock / 小记编辑 / 设置抽屉），每态 DOM 导航 + 等静默。
2. `mobile-snap.mjs`：复用桌面 `stylesnap` 的 SNAP（body * × ~90 计算属性 + 几何 + 伪元素，DJB2 哈希）。
3. `check-mobile-snap.mjs`：CDP 存活检查 → 生成 → 与紧凑基线（每态元素数 + 合并哈希）比对 → 有差异 exit 1；去抖重跑。
4. `package.json` 加 `check:mobilesnap`；基线入库（几 KB）。
5. 装置自证：同条件连拍两份 0 差异 + control（改一个 CSS 值必须被抓到）。
