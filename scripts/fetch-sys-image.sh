#!/usr/bin/env bash
# 下载 Android 系统镜像并强制校验 sha1（用于手动安装 system-images;android-36;google_apis;arm64-v8a）。
# 背景：公司网络/VPN 不稳定，sdkmanager 直接下载会得到截断/损坏 zip（"Error reading Zip content"）。
# 本脚本：每次全新下载（不用 -C - 续传，避免抖动下续传错位），下完比对 sha1，不符则重下。
# 用法：./scripts/fetch-sys-image.sh  （产物：/tmp/sysimg.zip，校验通过后退出 0）
set -uo pipefail
cd "$(dirname "$0")/.."

URL="https://dl.google.com/android/repository/sys-img/google_apis/arm64-v8a-36_r07.zip"
EXPECT="5a99183b6d924da606260e45fd41a3eb8eca6eb7"
OUT="/tmp/sysimg.zip"
MAX="${1:-5}"

for i in $(seq 1 "$MAX"); do
  echo "==> 第 $i 次下载（全新）..."
  rm -f "$OUT"
  curl -sSL --retry 3 --retry-all-errors -o "$OUT" "$URL"
  got=$(shasum -a 1 "$OUT" 2>/dev/null | awk '{print $1}')
  echo "    下载大小: $(du -h "$OUT" | cut -f1), sha1: $got"
  if [ "$got" = "$EXPECT" ]; then
    echo "==> SHA1 校验通过 ✓"
    exit 0
  fi
  echo "    sha1 不符，重试..."
done
echo "==> 重试 $MAX 次仍失败" >&2
exit 1
