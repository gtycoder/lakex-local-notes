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
SOCK=$($ADB shell cat /proc/net/unix 2>/dev/null | grep -oiE "webview_devtools_remote_[0-9a-f]+" | tail -1)
if [ -z "$SOCK" ]; then
  echo "错误：未发现 WebView devtools socket（App 是否已启动？需 debug 构建）" >&2
  exit 1
fi
$ADB forward tcp:$PORT localabstract:$SOCK
echo "==> 已转发 $SOCK -> tcp:$PORT"
echo "    Chrome DevTools: http://127.0.0.1:$PORT/json/list"
echo "    或在 Chrome 打开 chrome://inspect 直接看到设备 WebView"
