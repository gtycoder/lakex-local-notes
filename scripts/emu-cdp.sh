#!/usr/bin/env bash
# 把模拟器里 App 的 WebView 远程调试 socket 转发到本地固定端口，供 Chrome DevTools / CDP 自动化使用。
# 前置：模拟器已启动且 App（debug 构建）已运行（WebView 调试已开启）。
# 用法：./scripts/emu-cdp.sh [port]    默认 9335。
#   之后：Chrome 打开 http://127.0.0.1:9335/json/list 或 chrome://inspect 看 WebView。
#        本项目 e2e 脚本风格：连接该端口 WebSocket 即可 Runtime.evaluate 驱动。
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
export ANDROID_SDK_ROOT="/opt/homebrew/share/android-commandlinetools"
ADB="$ANDROID_SDK_ROOT/platform-tools/adb"
PORT="${1:-9335}"

if ! $ADB devices | grep -q "emulator-.*device"; then
  echo "错误：没有在跑/已开机的模拟器。先 ./scripts/emu-up.sh" >&2
  exit 1
fi
# socket 名带的是**宿主进程 PID**：App 重启后旧 socket 仍在 /proc/net/unix 里挂着，
# 直接 tail -1 可能取到旧进程的 socket（/json/list 恒为空）。优先按当前 App PID 精确取。
APP_PID="$($ADB shell pidof com.lakexlocalnotes.android 2>/dev/null | tr -d '\r' | awk '{print $1}')"
SOCK=""
if [ -n "$APP_PID" ]; then
  SOCK="$($ADB shell cat /proc/net/unix 2>/dev/null | grep -oE "webview_devtools_remote_${APP_PID}$" | head -1)"
fi
if [ -z "$SOCK" ]; then
  echo "提示：未按 App PID 找到 WebView socket（App 是否已启动？），回退取最后一个" >&2
  SOCK="$($ADB shell cat /proc/net/unix 2>/dev/null | grep -oiE "webview_devtools_remote_[0-9a-f]+" | tail -1)"
fi
if [ -z "$SOCK" ]; then
  echo "错误：未发现 WebView devtools socket（App 是否已启动？需 debug 构建）" >&2
  exit 1
fi
$ADB forward --remove tcp:$PORT >/dev/null 2>&1 || true
$ADB forward tcp:$PORT localabstract:$SOCK
echo "==> 已转发 $SOCK -> tcp:$PORT"
echo "    Chrome DevTools: http://127.0.0.1:$PORT/json/list"
echo "    或在 Chrome 打开 chrome://inspect 直接看到设备 WebView"
