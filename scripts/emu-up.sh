#!/usr/bin/env bash
# 启动 Android 模拟器（AVD: lake_mobile）并等待开机完成。
# 用法：./scripts/emu-up.sh [--no-window]
#   --no-window  无窗口启动（用于纯 CDP/DEVTOOLS 远程调试，适合无桌面/远程会话）
#
# 前置：sdkmanager 已安装 emulator + system-images;android-36;google_apis;arm64-v8a，且已建 AVD lake_mobile。
#       脚本内置常用环境变量（与 android-build.sh 一致），无需外部预置。
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
export ANDROID_SDK_ROOT="/opt/homebrew/share/android-commandlinetools"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export PATH="$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

AVD_NAME="lake_mobile"
EMU_BIN="$ANDROID_SDK_ROOT/emulator/emulator"

if [ ! -x "$EMU_BIN" ]; then
  echo "错误：emulator 未安装（$EMU_BIN 不存在）。先运行：" >&2
  echo "  sdkmanager --install emulator system-images;android-36;google_apis;arm64-v8a" >&2
  exit 1
fi

if ! emulator -list-avds 2>/dev/null | grep -qx "$AVD_NAME"; then
  echo "==> AVD '$AVD_NAME' 不存在，自动创建（pixel_6, API36 ）..."
  echo no | avdmanager create avd -n "$AVD_NAME" -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_6 2>&1 | tail -4
fi

# 已有模拟器在跑则直接复用
if adb devices | grep -q "emulator-"; then
  echo "==> 检测到已有模拟器在跑，复用：$(adb devices | grep emulator | head -1)"
else
  EXTRA=""
  if [ "${1:-}" = "--no-window" ]; then EXTRA="-no-window"; fi
  echo "==> 启动模拟器 $AVD_NAME $EXTRA"
  nohup "$EMU_BIN" -avd "$AVD_NAME" -no-snapshot -no-boot-anim -gpu host $EXTRA     > /tmp/emulator-$AVD_NAME.log 2>&1 &
  echo "==> 模拟器 PID=$! ，日志 /tmp/emulator-$AVD_NAME.log"
fi

echo "==> 等待设备上线..."
adb wait-for-device
echo "==> 等待开机完成 (sys.boot_completed)..."
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 2
done
echo "==> 模拟器已就绪："
adb devices
