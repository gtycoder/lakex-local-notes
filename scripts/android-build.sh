#!/usr/bin/env bash
# M0 POC Android 构建脚本（local-lakex-notes-mobile worktree）
# 用法：./scripts/android-build.sh [--sync] [--install]
#   --sync   先跑 cap sync（重新打包 web 资源到 android assets）
#   --install 构建后 adb 安装到已连接设备
#
# 背景（踩坑记录）：
# - 公司网络访问 services.gradle.org 超时 → gradle wrapper 无法下载 distribution。
#   ~/.gradle/wrapper/dists 已有 Tauri POC 留下的完整 gradle-8.14.3-bin 缓存，
#   直接复用其可执行文件（路径见 GRADLE_BIN），不经过 wrapper。
# - maven 依赖已配阿里云镜像（android/settings.gradle + build.gradle），加速后续构建。
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$ANDROID_HOME/platform-tools:$PATH"

GRADLE_BIN="$HOME/.gradle/wrapper/dists/gradle-8.14.3-bin/40dfek2kz346l18gf9ltjsnyd/gradle-8.14.3/bin/gradle"
if [ ! -x "$GRADLE_BIN" ]; then
  echo "gradle 缓存缺失: $GRADLE_BIN" >&2
  echo "需要先通过 wrapper 或手动准备 gradle-8.14.3-bin" >&2
  exit 1
fi

if [[ " $* " == *" --sync "* ]]; then
  echo "==> npx vite build (mobile)"
  npx vite build --config vite.mobile.config.ts 2>&1 | tail -2
  echo "==> npx cap sync android"
  npx cap sync android
fi

echo "==> gradle assembleDebug"
(cd android && "$GRADLE_BIN" assembleDebug --no-daemon 2>&1 | tail -6)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
echo "==> APK: $(ls -la "$APK" | awk '{print $5}') bytes"

if [[ " $* " == *" --install "* ]]; then
  echo "==> adb install -r $APK"
  adb install -r "$APK"
  echo "==> 启动 com.locallakexnotes.mobile"
  adb shell am start -n com.locallakexnotes.mobile/.MainActivity
fi
