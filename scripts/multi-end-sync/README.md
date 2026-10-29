# 多端同步测试脚手架（3 桌面 + 安卓真机 + 模拟器）

本目录是 260925 会话用于「5 端真实云同步」的脚手架，已从 /tmp 收进仓库，供后续会话复跑。

## 前提
- Node 24：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`
- 桌面 dev server 在跑：`npm run dev`（vite 1421）
- 3 个隔离桌面端手动启动（**不要用用户自己的 9222 实例**）：
  `LAKE_USER_DATA=$TMPDIR/lake5-d1 LAKE_ASSET_PORT=19878 LAKE_DEV_SERVER_URL=http://127.0.0.1:1421 ./node_modules/.bin/electron --use-angle=metal --remote-debugging-port=9232 .`
  （d2: 19879/9233，d3: 19880/9234）
- 安卓：AVD `lake_mobile` + 真机（serial `50950385`）；先 `bash scripts/android-build.sh --sync`，再 `adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk`
- S3 凭证通过环境变量提供（**绝不入库**），如 `/tmp/lake5/creds.env`（chmod 600）：
  `S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_AK / S3_SK`

## 端口约定
- 桌面 CDP：9232/9233/9234；资源口：19878/19879/19880
- 真机 WebView → `adb -s 50950385 forward tcp:9235 localabstract:<sock>`；模拟器 → `tcp:9236`
- 安卓 socket 随 App 重启变化：每次先 `forward --remove-all`，再 `adb shell cat /proc/net/unix | grep -oE webview_devtools_remote_[0-9a-f]+` 取最新

## 文件
- `cdpclient.mjs`：极简 CDP 客户端（`connect(port)` → `{ ev }`）
- `configure-s3.mjs <port>`：用 env 的 S3_* 给该端 `saveS3Settings`（凭证不打印）
- `eval.mjs <port> <expr>`：在某端执行 JS 表达式
- `probe5.mjs`：5 端连通性/清单
- `run5.mjs`：套件1 核心协议（kind 传播/多写端/编辑 LWW/删除/恢复/冲突/小记/manifest/收敛/幂等）
- `run5b.mjs`：套件2 边界资产（非 doc 正文逐字节/小记图片/purge 幽灵/目录传播/删除压编辑）
- `run5c.mjs`：套件3 目录/图标/排序/移动/duplicate/删除恢复purge/S3 操作 smoke
- `run5d.mjs`：压力测试（1000 笔记 + 100 目录 + 2MB 文档，输出各端耗时）
- `run5e.mjs`：单端基准（testS3Connection 延迟 / createNote×1000 / getHomeSnapshot）
- `volume.mjs`：量数据体量；`delprefix.mjs`：删隔离前缀（env PREFIX/DELPREFIX）；`s3verify.mjs`：凭证连通性

## 典型流程
1. `set -a; . /tmp/lake5/creds.env; set +a`
2. `export PREFIX="mk-$(date +%Y%m%d%H%M%S)"`
3. 启动 3 桌面 + `adb forward` + `node configure-s3.mjs 9232 9233 9234 9235 9236`
4. `node run5d.mjs`（或 run5 / run5b / run5c）
5. 结束：kill 桌面 PID；`DELPREFIX=$PREFIX node delprefix.mjs`

## 数据安全（务必遵守）
- 真机测试前**必须备份**，测试后**还原**：
  - 备份：`adb -s 50950385 shell am force-stop com.lakexlocalnotes.android && adb -s 50950385 exec-out run-as com.lakexlocalnotes.android tar -cz databases shared_prefs app_webview files > backup.tgz`
  - 还原：`pm clear` 后 `adb push` 到 `/data/local/tmp`，再 `adb shell "cat /data/local/tmp/x.tgz | run-as com.lakexlocalnotes.android tar -xzf -"`
- **不要碰正式数据** `~/Library/Application Support/lakex-local-notes`
- 杀 Electron **只 kill 具体 PID**，禁 `pkill -f Electron`（机器上还有 SiYuan/VSCode/Trae）
- 隔离前缀用完必删（0 残留）
