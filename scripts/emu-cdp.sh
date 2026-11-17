#!/usr/bin/env bash
# 把模拟器里 App 的 WebView 远程调试 socket 转发到本地固定端口，供 Chrome DevTools / CDP 自动化使用。
# 前置：模拟器已启动且 App（debug 构建）已运行（WebView 调试已开启）。
# 用法：
#   ./scripts/emu-cdp.sh [port]                     一次性转发（默认 9335；幂等，App 重启/重装后重跑即可）
#   ./scripts/emu-cdp.sh --watch [port] [interval]  常驻监视：/json/list 掉了自动重新转发（默认 9335 / 2s；
#                                                   长时间跑探针时开着它，App 重启不用人手重连。Ctrl-C 退出）
#   之后：Chrome 打开 http://127.0.0.1:<port>/json/list 或 chrome://inspect 看 WebView。
#        本项目 e2e 脚本风格：连接该端口 WebSocket 即可 Runtime.evaluate 驱动。
#
# 261117（device-qa P1-6）：① 新增 --watch 自动重连；② 一次性模式的行为不变（精确按 App PID 取 socket）。
# 驱动侧（scripts/css-audit/drive.mjs）也有断连自动重连：探针跑一半 App 重启时它会自己调本脚本修复转发
# —— 两个入口共用本脚本的 socket 选取逻辑，别在别处再写一份。
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
export ANDROID_SDK_ROOT="/opt/homebrew/share/android-commandlinetools"
ADB="$ANDROID_SDK_ROOT/platform-tools/adb"

WATCH=0
if [ "${1:-}" = "--watch" ]; then
  WATCH=1
  shift
fi
PORT="${1:-9335}"
INTERVAL="${2:-2}"

# 一次性转发：幂等（先 remove 再 forward），返回 0 = 转发成功。
forward_once() {
  if ! $ADB devices | grep -q "emulator-.*device"; then
    echo "错误：没有在跑/已开机的模拟器。先 ./scripts/emu-up.sh" >&2
    return 1
  fi
  # socket 名带的是**宿主进程 PID**：App 重启后旧 socket 仍在 /proc/net/unix 里挂着，
  # 直接 tail -1 可能取到旧进程的 socket（/json/list 恒为空）。优先按当前 App PID 精确取。
  local APP_PID
  APP_PID="$($ADB shell pidof com.lakexlocalnotes.android 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  local SOCK=""
  if [ -n "$APP_PID" ]; then
    SOCK="$($ADB shell cat /proc/net/unix 2>/dev/null | grep -oE "webview_devtools_remote_${APP_PID}$" | head -1)"
  fi
  if [ -z "$SOCK" ]; then
    echo "提示：未按 App PID 找到 WebView socket（App 是否已启动？），回退取最后一个" >&2
    SOCK="$($ADB shell cat /proc/net/unix 2>/dev/null | grep -oiE "webview_devtools_remote_[0-9a-f]+" | tail -1)"
  fi
  if [ -z "$SOCK" ]; then
    echo "错误：未发现 WebView devtools socket（App 是否已启动？需 debug 构建）" >&2
    return 1
  fi
  $ADB forward --remove tcp:$PORT >/dev/null 2>&1 || true
  $ADB forward tcp:$PORT localabstract:$SOCK
  echo "==> 已转发 $SOCK -> tcp:$PORT"
  return 0
}

# /json/list 里有没有活的 page target（watch 模式的健康判据）。
target_alive() {
  # ⚠️ /json/list 是**带空格的 pretty JSON**（"type": "page"）⇒ 模式必须容忍冒号两侧空格，
  # 否则恒不命中、watch 会一直判"没恢复"（AGENTS §7.21「探针静默失效」同族坑）。
  curl -sf --max-time 2 "http://127.0.0.1:${PORT}/json/list" 2>/dev/null | grep -qE '"type"[[:space:]]*:[[:space:]]*"page"'
}

if [ "$WATCH" = "1" ]; then
  echo "==> 监视模式：每 ${INTERVAL}s 检查 tcp:${PORT}，掉线自动重转发（Ctrl-C 退出）"
  last_state="unknown"
  while true; do
    if target_alive; then
      if [ "$last_state" != "up" ]; then echo "[$(date '+%H:%M:%S')] :$PORT 正常"; fi
      last_state="up"
    else
      echo "[$(date '+%H:%M:%S')] :$PORT 无 page target（App 重启/转发失效？）→ 自动重转发"
      forward_once || true
      sleep 1
      if target_alive; then
        echo "[$(date '+%H:%M:%S')] :$PORT 已恢复"
        last_state="up"
      else
        echo "[$(date '+%H:%M:%S')] :$PORT 仍未恢复（App 没起来？）下轮再试"
        last_state="down"
      fi
    fi
    sleep "$INTERVAL"
  done
fi

forward_once
echo "    Chrome DevTools: http://127.0.0.1:$PORT/json/list"
echo "    或在 Chrome 打开 chrome://inspect 直接看到设备 WebView"
echo "    （App 重启后 socket 会失效：重跑本命令，或跑 ./scripts/emu-cdp.sh --watch $PORT 常驻自动重连）"
