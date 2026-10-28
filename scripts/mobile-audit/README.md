# scripts/mobile-audit — 移动端 UI 走查 / 快照门禁（W0-b）

## 为什么不能只用浏览器预览
`scripts/mobile-preview.sh` + `scripts/mobile-audit/shell`（390×844 Electron 壳）只加载 `dist-mobile/index.html`；
但移动端启动依赖 **Capacitor 原生 SQLite**（`window.Capacitor.Plugins.CapacitorSQLite`）—— 浏览器里只有 web 壳、
没有原生实现 ⇒ **实测停在 `MobileApp` 的 booting 态**（`<div class="poc-center">启动中…</div>`）。
⇒ **快照门禁必须跑在模拟器（真实原生桥）上**。`shell/` 保留备用（等移动端有 web 回退实现时可直接启用）。

## ⚠️ 两个装置用法（261013 实测）

1. **走查必须"单独冷启动"跑**：把它紧接在 `check:mobilesnap` 之后跑会 **整屏全 ERR**（判据 `goHome: 卡住（找不到退出控件）`）——
   因为快照门禁最后一态把 App 停在「设置 · 外观」子页，走查的 `goHome()` 从那里恢复不回来。
   正确顺序：`am force-stop` → `am start` → `emu-cdp.sh 9336` → 走查。
2. **键盘状态会干扰导航**：深链进「小记」写作卡后键盘是弹着的（自动聚焦），此时直接跑走查同样可能卡住 ⇒ 同上，先冷启动。

## ⚠️ 门禁跑在**专用实例**上（261013 起，硬约定）

**为什么**：`home-quicknotes` / `home-doc` 这些态的元素数与指纹**直接由设备里的数据决定** ——
用户在模拟器上随手记一条小记，该态就 +17 元素、门禁报"两轮一致 ⇒ 真差异"，而代码一行没动（261013 实测踩到）。
⇒ **门禁固定跑在专用 AVD `lake_gate`（emulator-5556）上**，用户自己那台随便改数据都不影响门禁。

```bash
# 1) 起专用实例（首次）
export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"   # avdmanager 需要 JDK17+
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
emulator -list-avds | grep -qx lake_gate || echo no | avdmanager create avd -n lake_gate -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_6
nohup emulator -avd lake_gate -no-snapshot -no-boot-anim -gpu host &

# 2) 装包 + CDP 转发到 9336（别占用用户那台的 9335）
export ANDROID_SERIAL=emulator-5556
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.locallakexnotes.mobile/.MainActivity
bash scripts/emu-cdp.sh 9336

# 3) 灌固定夹具（幂等；**先 pm clear 保证干净**）
adb shell pm clear com.locallakexnotes.mobile && adb shell am start -n com.locallakexnotes.mobile/.MainActivity && sleep 8
bash scripts/emu-cdp.sh 9336
node scripts/cdp-eval.mjs 9336 @scripts/mobile-audit/gate-fixture.mjs

# 4) 跑门禁（--port 9336）
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336
```

**夹具口径**（`gate-fixture.mjs`）：默认笔记本「个人笔记」下 **5 篇文档** + **4 条小记**。
5 篇是**走查**的下限（它要 doc-0..doc-4 五行；3 篇时 doc-3/doc-4 会 ERR "not found: doc row #3/#4"，261013 实测）。
文档必须挂在**默认笔记本**上 —— 门禁的 `home-doc` 态是"点书架第一张卡"进的，另建笔记本会让第一张卡是空的默认本、抽屉里没有文档行（261013 实测）。
该实例**不配 S3**（`pm clear` 后即未配置）⇒ 不走同步 ⇒ 少一层取样抖动。

**重烤基线**（只在专用实例上做；配方 = 先采一份暖态，再以它为基线）：
```bash
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336 --tag gate-warm      # 第一次采样常拿到"冷态"，丢弃
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336 --from .css-audit/snap/gate-warm<N>.json --write-baseline
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336                       # 连跑两次应 0 差异
```
⚠️ **基线绑定"专用实例 + 该夹具"**：拿它去比"用户的真实数据"必然 6/6 态红，那是预期，不是回归。
⚠️ **261016 实测到的确切成因**：`home-doc` 的指纹 row key 里带**文档节点 id**（形如 `ne-p$<uuid>-body#0`）⇒ 每次 `pm clear` + 重灌夹具都会生成**新 id**，
即使元素数完全相同，指纹也会变（本次实测 `1880 → 1880` 但指纹不同，逐行对拍只差这一条）⇒ **重灌夹具后必须重烤**；只盯元素数会误判成"没变"。

## 编辑面不变量（261014 起，动 dock / 输入法 / 键盘适配时必跑）

```bash
bash scripts/emu-cdp.sh 9335
node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/edit-surface-invariants.mjs          # 两条编辑器都跑
node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/edit-surface-invariants.mjs quicknote # 只跑小记
```

五条不变量（依据 = 261014 修掉的 5 个真缺陷 + 261020 面板错位回归）：**I1 几何恒定**（键盘/面板/收回三态的
kernCh·kernSt·firstY 逐项相同）· **I2 光标存在**（面板态 activeElement 仍是正文、选区在、inputmode=none）·
**I3 光标在工具栏上方**（caret.bottom < tb.top）· **I4 不自关/无闪**（点＋后 1.2s 面板仍在；每次开/关 resize ≤1）·
**I5 面板贴视口底**（面板打开时 `panel.bottom === innerHeight` 且 `toolbar.bottom === panel.top`；任何把 fixed
包含块变成 layer 盒的改动——常驻 transform/will-change——都会让它红）。失败即 exit 1 并逐条打印实际取样值。

## 插入面板几何（261015 起，动 dock 面板 / 插入项排布时必跑）

```bash
bash scripts/emu-cdp.sh 9335
node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/insert-panel-geometry.mjs
```

面板没开时装置会**自己进编辑态**（首页 ＋ → 空白小记）并真实点开「＋」。六条不变量（形态 = 用户 261015 点单的**方块网格**）：
**G1 单一列宽** · **G2 每行填满（仅末行可不足）** · **G3 溢出可滚 + 滚到底时末行完整可达**（允许上下滑，但绝不允许"滚到底也够不到 / 末行被裁一半"）·
**G4 零截断** · **G5 命中区 ≥44** · **G6 方块形态**（`flex-direction: column` + 居中 + 有圆角与底色 ⇒ 不是"图标左文字右"的行）。
失败 exit 1 并逐条打印取样值。

> ⚠️ **快照 6 态与走查 23 屏都不覆盖这个面板** —— 别拿"门禁绿了"代替它。
>
> ⚠️ **设备截图裁切必须算状态栏**：页面 CSS `y=0` ↔ 设备 **`y=128`**（本机 1080×2400 / 412×842，dpr 2.625）⇒
> `ffmpeg crop` 的 y = `CSS_y × 2.625 + 128`。261015 实测：直接按 CSS 值裁会把面板最后一行切掉，**看起来像"产品裁切"，其实是裁切窗口短了 47px**（差点误判）。

## ⌨ 键盘开合（261015 起，动 dock / 输入法 / 外壳高时必跑）

```bash
bash scripts/emu-cdp.sh 9335
node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/keyboard-toggle.mjs
```

用户报「有键盘时点 ⌨ 能收、没键盘时点 ⌨ 不弹」。装置**状态驱动**（不假设初始有没有键盘：先归一到"键盘弹起"，再跑收/展/收）：

- **K1** 有键盘 + 点 ⌨ ⇒ 收起，且 `inputmode="none"` 且 `activeElement` 仍在正文（**光标留住**）；
- **K2** 无键盘 + 点 ⌨ ⇒ 弹起，且 **`inputmode` 已摘除**；
- **K3** 再点 ⇒ 又收起（可反复开合）。

> ⚠️ 两条根因见 `docs/LAKEX-CONTRACT.md` §5.38.1：① 展开前必须 `restoreIme()`；② `viewportShell` 的稳定外壳高
> 会被 IME 过渡里失真的 `innerHeight` 污染（几何上看不出来）。**改 `viewportShell`/`useKeyboard` 时必须连同
> `edit-surface-invariants.mjs` 一起跑**（那是它的下游地基）。

## 原生滚动 / 横向分页的 CDP 验证（261019 实测）

动首页横向分页（小记 ↔ 知识库）、或任何"靠浏览器原生滚动"的交互时，验收姿势不一样：

- **`Input.dispatchTouchEvent` 只把事件送进 JS**（自研 touch 手势能测到），**不驱动浏览器原生滚动** —— 页面 `scrollLeft` 恒 0，别据此判"没生效"。
- 原生滚动/分页用 **`Input.synthesizeScrollGesture`**（`gestureSourceType:"touch"`）：
  `xDistance` 正 = 往**上一页/左**滚，负 = 往**下一页/右**滚；`yDistance` 负 = 向下滚。
- 带惯性（`preventFling:false`）时"短距离高速滑"也会翻页 ⇒ **复核"未过半吸附回原页"必须用 `preventFling:true`**
  （实测 120/160/200px 吸附回、260px 翻页；`preventFling:false` 时 120px 也会翻）。
- ⚠️ **手势被吃掉的两类原因**（本轮都实测踩到）：
  1. 内层滚动容器的**两轴** `overscroll-behavior: contain` 会掐断横向滚动链 ⇒ 只写 `overscroll-behavior-y: contain`；
  2. `touch-action` 只取"**最近滚动容器**"的交集 —— 在远处祖先写 `pan-y` 挡不住内层把横向手势链上去；
     要锁横滑就锁**最近容器**（或直接 `overflow-x: hidden`）。
- 模拟器上 **`adb shell input tap/swipe` 与 `sendevent` 对本 App 都无效**（只有 CDP `Input.dispatch*` 有用）；
  原生滚动的"跟手"性质属于浏览器默认行为，验证到"容器可滚 + 吸附 + 页码回写"即可，别硬造手势。

## 环境（260923 实测可用）
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/local-lakex-notes
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
