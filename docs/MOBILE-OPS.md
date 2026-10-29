# MOBILE-OPS.md — Android 端运行 / 调试 / 门禁（唯一运维手册）

> 261029 建立。**本文是 Android 端「怎么构建 / 怎么装 / 怎么连 CDP / 怎么跑门禁 / 怎么点按」的唯一来源**；
> 架构与分层见 `docs/MOBILE-TECH-STACK.md`、视觉见 `docs/MOBILE-DESIGN.md`、AI 见 `docs/MOBILE-AI.md`，
> 长期红线见 `AGENTS.md`（移动端：§3#14/#21、§7 #13–#20）。
> **脚本头注释 = 事实来源**：手写命令前先读 `scripts/android-build.sh` / `emu-up.sh` / `emu-cdp.sh` / `mobile-preview.sh`。
> ⚠️ 会过期的事实（在跑几台设备、哪个 serial、装的哪个包、端口）**只写在 §9**；正文不写死，换机器先看 §9 再现场复核。

## 1. 环境前置

| 项 | 值 / 说明 |
| --- | --- |
| Node | **24（必须）**：`$HOME/.nvm/versions/node/v24.18.0/bin` |
| JDK | **21**：`/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home` |
| Android SDK | `/opt/homebrew/share/android-commandlinetools`（`ANDROID_HOME` = `ANDROID_SDK_ROOT`） |
| gradle | **不走 wrapper**：复用缓存 `~/.gradle/wrapper/dists/gradle-8.14.3-bin/40dfek2kz346l18gf9ltjsnyd/gradle-8.14.3/bin/gradle`；缓存缺失时构建脚本直接报错退出（不出网下载） |
| AVD | 开发默认 `lake_mobile`（Pixel 6 / API 36 / arm64；`emu-up.sh` 缺则自动创建）；门禁专用 `lake_gate`（§5） |
| 环境变量 | 三个 android 脚本**已内置** `JAVA_HOME` / `ANDROID_HOME` / `PATH`，不需要外部预置 |
| `JAVA_HOME` 坑 | 本机默认 `java` 是 **1.8**（`/usr/libexec/java_home` 还挂着 jdk-1.8）⇒ **手跑 `gradlew` 必须显式指定 jdk-21**，否则 AGP 直接失败；走脚本则无此问题 |
| `ANDROID_SERIAL` | 多台设备/模拟器同时在跑时 adb 会报 *more than one device* ⇒ 先 `adb devices` 看 serial 再 `export ANDROID_SERIAL=<serial>`（脚本内所有 adb 调用都跟随它） |

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes
export ANDROID_SERIAL=emulator-5554    # 单设备可省略；多设备改成 adb devices 里要操作的那台
```

## 2. 构建与安装

| 命令 | 作用 |
| --- | --- |
| `bash scripts/android-build.sh` | 只跑 `gradle assembleDebug --no-daemon` |
| `bash scripts/android-build.sh --sync` | 先 `vite build -c vite.mobile.config.ts` → `npx cap sync android` → `assembleDebug` |
| `... --install` | 追加 `adb install -r <apk>` + `adb shell am start -n com.lakexlocalnotes.android/.MainActivity` |

- 产物：`android/app/build/outputs/apk/debug/app-debug.apk`（**debug 签名 + debuggable=true** ⇒ 才有 WebView 调试；release 变体虽也用 debug keystore 签，但 `debuggable=false`，连不上 CDP）。
- **`--sync` 是唯一把 web 产物送进 APK 的路径**：改了 `src/mobile/**` 却没加 `--sync` ⇒ 装上去的还是旧 bundle。
- 正式发布需 release keystore + `assembleRelease`（尚未配置；`npm run check:android-release` 只校验配置项）。
- **装完必须重跑 `emu-cdp.sh`**（socket 名带 App PID，见 §3）。

## 3. 运行与调试（模拟器 / 真机）

```bash
bash scripts/emu-up.sh                 # 启动 AVD lake_mobile 并等 sys.boot_completed（已在跑则复用）
bash scripts/emu-up.sh --no-window     # 无窗口启动（纯 CDP 远程会话）
bash scripts/android-build.sh --sync --install
bash scripts/emu-cdp.sh                # 转发到 tcp:9335（默认）
bash scripts/emu-cdp.sh 9336           # 门禁实例用 9336
curl -s http://127.0.0.1:9335/json/list   # 应看到 "type":"page"
```

- **`emu-cdp.sh` 的坑（本文最该记住的一条）**：WebView socket 名 = `webview_devtools_remote_<App 宿主 PID>`；App 重启或重装后**旧 socket 仍挂在 `/proc/net/unix`**，盲取 `tail -1` 会指向死 socket ⇒ `/json/list` 空、Node 侧 `fetch failed: other side closed`、装置报 `no page target`。**这不是 App 崩了**（`pidof` 仍在）。脚本已按当前 `pidof com.lakexlocalnotes.android` 精确取（取不到才回退），并在转发前 `adb forward --remove tcp:<port>`；**每次 App 重启/重装都要重跑它**。
- 手写等价命令（多设备时每条 adb 前加 `-s <serial>`，否则 adb 报 more than one device）：
```bash
PID=$(adb shell pidof com.lakexlocalnotes.android | tr -d '\r' | awk '{print $1}')
adb forward --remove tcp:9335
adb forward tcp:9335 localabstract:webview_devtools_remote_$PID
```
- CDP 驱动：`node scripts/cdp-eval.mjs <port> "<expr>"`（`@file` = 读文件）、`node scripts/css-audit/drive.mjs <port> <script.mjs>`（脚本导出 `default async ({ page, args }) => …`）。两者都要求 `/json/list` 里有 `type=page`。
- **截图必须是设备级**：`adb exec-out screencap -p > shot.png`。CDP `Page.captureScreenshot` **抓不到 GPU canvas 层**（usheet 网格整片空白）⇒ 拿 CDP 截图判断"表格空白"必误判。
- **真机**：流程相同（debug 包 + 已授权 USB 调试），只是必须显式指定设备：`adb -s <serial> …` 或 `export ANDROID_SERIAL=<serial>`。
- 收尾：`adb emu kill`（**不要** `pkill emulator` / `pkill Electron`）。

## 4. 浏览器预览的边界

```bash
bash scripts/mobile-preview.sh          # 默认 1422
bash scripts/mobile-preview.sh 1430     # 换端口
```

- 实际行为 = `python3 -m http.server <port> --directory dist-mobile`（`dist-mobile/index.html` 不存在时先跑一次 mobile build）。
- 两个入口都是真的，别混：

| 路径 | 是什么 |
| --- | --- |
| `/preview.html` | 把 App 包进 390×844 竖屏手机框（脚本回声给的是这个） |
| `/index.html` | App 真实入口（Capacitor 打进 APK 的也是它） |

- **能力边界（硬）**：浏览器里没有原生 Capacitor SQLite ⇒ 应用**停在 booting 态**（`<div class="poc-center">启动中…</div>`）。**只能看 UI 骨架与纯 DOM 逻辑，不能做任何验收**；`scripts/mobile-audit/shell/` 同款局限（同目录 README 已说明，保留备用）。
- 其它降级：native 桥（AssetServer / 原生文件 / SQLite）全部走 web 回退 ⇒ S3 上传与资产渲染会降级；正文在预览里是**内存**（刷新即丢），真机/模拟器才是文件。

## 5. 门禁装置

### 5.1 专用实例（硬约定，261013 起）

| 项 | 值 |
| --- | --- |
| AVD | `lake_gate`（与开发用的 `lake_mobile` 分开：用户在那台上随手改数据不影响门禁） |
| CDP | **9336**（别占 9335） |
| 夹具 | `scripts/mobile-audit/gate-fixture.mjs`：默认笔记本 `notebook-personal` 下 **5 篇文档 + 4 条小记**（走查要 doc-0..doc-4 五行；文档必须挂默认笔记本，否则抽屉里没有文档行） |
| 基线 | `scripts/mobile-audit/baseline/mobile-snap.json`（**入库**，几 KB：每态元素数 + 合并哈希） |
| 中间快照 | `.css-audit/snap/<tag>.json`（**gitignore**；同名 tag 会被覆盖，别当对拍依据） |

### 5.2 标准流程（干净重建 → 灌夹具 → 跑门禁）

```bash
export ANDROID_SERIAL=emulator-5554      # ← 改成 lake_gate 那台（adb devices 现场确认）
adb shell pm clear com.lakexlocalnotes.android
adb shell am start -n com.lakexlocalnotes.android/.MainActivity && sleep 8
bash scripts/emu-cdp.sh 9336
node scripts/cdp-eval.mjs 9336 @scripts/mobile-audit/gate-fixture.mjs
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336
```

- 6 态：`home-library` / `home-quicknotes` / `home-library-list` / `home-doc` / `settings` / `settings-appearance`；`--states a,b` 只跑受影响态（改动只涉及一屏时优先用它）。
- 首次比对有差异会自动重跑一遍（去抖），两轮都差异才 exit 1；CDP 不通 exit 2。

### 5.3 重烤基线（只在专用实例 + 该夹具上做）

```bash
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336 --tag gate-warm1   # 先采暖态（第一轮常拿到冷态，丢弃）
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336 --from .css-audit/snap/gate-warm1.json --write-baseline
node scripts/mobile-audit/check-mobile-snap.mjs --port 9336                      # 连跑两次应 0 差异
```

快照文件名就是 `.css-audit/snap/<tag>.json`（tag 自己起，别复用同名覆盖）。**必须重烤的时机**：改了外壳几何/构成、重灌夹具、`pm clear`、装了新构建 ⇒ 否则下次全量必红（一次性成本）。

### 5.4 走查（23 屏）

```bash
adb shell am force-stop com.lakexlocalnotes.android
adb shell am start -n com.lakexlocalnotes.android/.MainActivity
bash scripts/emu-cdp.sh 9336
node scripts/css-audit/drive.mjs 9336 scripts/css-audit/mobile-walkthrough.mjs
```

- **必须单独冷启动**：紧接 `check:mobilesnap` 之后跑会整屏 ERR（门禁最后一态停在「设置·外观」，`goHome()` 回不来）；深链进小记写作卡时键盘是弹着的，同样会卡住。
- 走查截图走设备级 `screencap`（GPU canvas）。

### 5.5 其他装置（只在动对应层时跑）

| 装置 | 命令 | 何时跑 |
| --- | --- | --- |
| 编辑面不变量 I1–I5 | `node scripts/css-audit/drive.mjs 9335 scripts/mobile-audit/edit-surface-invariants.mjs` | 动 dock / 输入法 / 键盘适配 |
| 插入面板几何 G1–G6 | 同上换 `insert-panel-geometry.mjs` | 动插入面板排布 |
| 键盘开合 K1–K3 | 同上换 `keyboard-toggle.mjs` | 动 ⌨ / `viewportShell` / 外壳高 |
| 长文档 DOM 探针 | `node scripts/mobile-audit/long-doc-dom.mjs 9336` | 动文档编辑面 / 查找；**会造数据 ⇒ 跑后重烤基线**，别在配了 S3 的机器上跑 |

（前三项前置都是 `bash scripts/emu-cdp.sh 9335`；口径与判据细节见 `scripts/mobile-audit/README.md` 与 `docs/MOBILE-LONG-DOC-PROBE.md`。）

### 5.6 假红成因（先排除这三条，再怀疑代码）

| 现象 | 成因 | 处置 |
| --- | --- | --- |
| 某态元素数差十几个 | 设备里有用户数据（随手记一条小记 = 该态 +17 元素） | 只认 `lake_gate` + 固定夹具，别拿日常机当基准 |
| 元素数一致但指纹不同 | `home-doc` 指纹 row key 带**文档节点 id**（`ne-p$<uuid>-body#0`）⇒ 每次 `pm clear` + 重灌夹具都生成新 id | 重灌夹具后**必须重烤**（只盯元素数会误判"没变"） |
| 首轮与次轮不同 | 首页「最近文档」启动后异步重排（冷/暖态差 29 元素 ≈ 三张卡） | 基线**必须从暖态取**（§5.3 第一步） |

## 6. 设备点按口径（自动化验收）

- 坐标一律取自 `getBoundingClientRect()`（**页面 CSS px**），点按走 CDP `Input.dispatchMouseEvent`（按下 + 抬起）：`el.click()` 不触发 App 里的导航。
- 长按 / 上滑这类 pointer 手势用 `Input.dispatchTouchEvent`（鼠标事件验不出 pointer 长按）；原生滚动/分页用 `Input.synthesizeScrollGesture`。
- **`adb shell input tap/swipe` 对本 App 不生效**（`keyevent` 正常）⇒ 别用 adb 点按验收交互。
- keep-alive 的隐藏视图仍在 DOM ⇒ 导航与可见性判据必须带命中测试（`elementFromPoint`），只 `querySelector` 会点到不可见元素。

## 7. 包名与数据

| 项 | 值 |
| --- | --- |
| applicationId / 包名 | `com.lakexlocalnotes.android`（`namespace` = `applicationId`） |
| 启动 | `adb shell am start -n com.lakexlocalnotes.android/.MainActivity` |
| 重装 | `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` |
| 清数据重建 | `adb shell pm clear com.lakexlocalnotes.android` |
| 数据位置 | 设备/模拟器的 **App 私有沙盒**（SQLite 库名 `lakex-local-notes-mobile` ⇒ `databases/lakex-local-notes-mobileSQLite.db`；正文是文件），**不在** macOS 数据目录 |
| 造数据 | 用产品自己的 `window.lakeNative`（`cdp-eval.mjs @脚本`，样板见 `gate-fixture.mjs`），**不要**手改 DB、不要猜正文格式 |

- **改名后 applicationId 变了 = 新 App**（261029）：旧包 `com.locallakexnotes.mobile` 的安装**不会被覆盖升级**，必须重装新包；两边数据不共享。
- 门禁实例**不配 S3**（`pm clear` 后即未配置 ⇒ 少一层取样抖动）。

## 8. 故障排查

| 现象 | 最可能原因 | 处置 |
| --- | --- | --- |
| `/json/list` 空、Node 侧 `fetch failed: other side closed`、装置报 `no page target` | CDP 转发指向 App 重启前的**死 socket**（App 没崩） | 重跑 `emu-cdp.sh <port>`；先 `adb shell pidof com.lakexlocalnotes.android` 确认进程在 |
| `gradle 缓存缺失: …gradle-8.14.3/bin/gradle` | `~/.gradle/wrapper/dists` 里没有 8.14.3 | 按脚本提示备好 `gradle-8.14.3-bin`（脚本**不出网下载**） |
| gradle 报 JDK / AGP 不兼容 | 手跑 `gradlew` 用了默认 JDK（1.8） | `export JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home` |
| adb `more than one device/emulator` | 多台设备/模拟器同时在跑 | `export ANDROID_SERIAL=<serial>` 或 `adb -s <serial>` |
| 快照门禁某态红 | 设备数据 / 夹具未重灌 / 指纹里的文档 id 变了（见 §5.6） | 按 §5.2 重建、按 §5.3 重烤 |
| 走查整屏 ERR（键盘态卡住） | 没单独冷启动（键盘弹着 / 停在设置子页） | 严格按 §5.4 的 force-stop → start → emu-cdp 顺序 |
| App 停在「启动中…」 | 在浏览器预览里跑（无原生 SQLite） | 换模拟器/真机（§4） |

## 9. 261029 设备现状（会过期，只写这里）

| 项 | 261029 实测 |
| --- | --- |
| Node / JDK / SDK | v24.18.0 / jdk-21 / `/opt/homebrew/share/android-commandlinetools`（与 §1 一致） |
| AVD 列表 | `lake_body` / `lake_gate` / `lake_lock` / `lake_meas` / `lake_mobile` / `lake_sheet`（6 个） |
| 在跑 | 3 台：`emulator-5554` / `emulator-5560` / `emulator-5562`；`lake_gate` 这轮落在 **`emulator-5562`**（CDP 转发 9336） |
| 已装包 | **`lake_gate`（5562）已装新包 `com.lakexlocalnotes.android`**（261029 16:13 构建安装；旧包 `com.locallakexnotes.mobile` 仍在、未卸）；`emulator-5554` / `5560` 仍是旧包 ⇒ 要跑它们先重装 |
| 门禁基线 | 261029 16:19 在 lake_gate 重烤（6 态元素数不变，仅 `home-doc` 指纹 `br6io → xy3qs9`，属文档 id 变化） |
| 设备画面 | 1080×2400 / dpr 2.625 ⇒ CSS viewport 412×842；按 CSS 值裁图时 y = `CSS_y × 2.625 + 128`（状态栏） |

⚠️ **serial 与 AVD 的对应关系不固定**（按启动顺序分配）⇒ 用 `adb devices` 现场确认，别照抄 `emulator-5562`。

## 10. 与桌面判据的边界

- 移动端有**自己的样式层**（`src/mobile/**` 的 `mb-*` + 移动 theme），**不引桌面样式层**；`AGENTS.md` §3#14 那套（`--lake-*` / `ln-*` / `@layer`）**只约束桌面**。
- 门禁互不替代：移动端 = `check:mobilesnap`（6 态）+ 走查（23 屏）+ §5.5 装置；桌面 = `check:stylesnap`（42 态）。**改移动样式层不要求桌面重烤**，反之亦然；只有共享的 `src/core/**` 才两端同验。
- 静态门禁（CI 级，不需要设备）：`npm run check:mobileui`（移动独立性/样式层/kernel 样式）、`npm run check:core`（`src/core` 零平台依赖）。分层口径见 `AGENTS.md` §3#21。
