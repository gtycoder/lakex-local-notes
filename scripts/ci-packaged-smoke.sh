#!/usr/bin/env bash
# 打包版冒烟（macOS）：构建 → sharp 平台包自检 → 启动冒烟。
# 用法：bash scripts/ci-packaged-smoke.sh
#   SKIP_BUILD=1  跳过 vite build / electron-builder（release/mac-arm64 已有产物时用，如 release 工作流）
# 背景（261027）：从软链 node_modules 的 worktree 出包会让 electron-builder 漏掉 sharp 的 @img/* 平台包，
#   主进程启动即崩 "Could not load the 'sharp' module using the darwin-arm64 runtime"（不是 OOM）。
#   本脚本把「真实 node_modules + @img 自检 + packaged smoke」固化成一条命令，CI 与本地共用。
set -euo pipefail
cd "$(dirname "$0")/.."

APP="release/mac-arm64/LakexLocalNotes.app"

if [ -L node_modules ]; then
  echo "ERROR: node_modules 是软链（$(readlink node_modules)）。" >&2
  echo "       打包必须用真实 node_modules（npm ci 的克隆/CI），否则 electron-builder 会漏掉 @img/*。" >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "ERROR: 缺少 node_modules，请先 npm ci" >&2
  exit 1
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> vite build"
  npx vite build
  echo "==> electron-builder --dir（unsigned）"
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir
fi

if [ ! -d "$APP" ]; then
  echo "ERROR: 找不到打包产物 $APP（SKIP_BUILD=1 时需要先出包）" >&2
  exit 1
fi

echo "==> 自检 1：asar 内 @img 条目（sharp 平台包）"
node -e '
const a = require("@electron/asar");
const files = a.listPackage("release/mac-arm64/LakexLocalNotes.app/Contents/Resources/app.asar");
const n = files.filter((f) => f.includes("@img")).length;
console.log("asar @img entries:", n);
if (n === 0) { console.error("ERROR: asar 里没有 @img（sharp 平台包缺失，打包版主进程会崩）"); process.exit(1); }
'
echo "==> 自检 2：unpacked libvips / sharp 平台包"
test -d "$APP/Contents/Resources/app.asar.unpacked/node_modules/@img" || {
  echo "ERROR: app.asar.unpacked/node_modules/@img 缺失（libvips 动态库不会随 asar 加载）" >&2
  exit 1
}

echo "==> packaged smoke（启动 + 窗口/编辑器/画板检查）"
LAKE_PACKAGED_ARGS="${LAKE_PACKAGED_ARGS:---no-sandbox --disable-gpu}" node scripts/e2e-packaged-smoke.mjs
echo "OK: packaged smoke passed"
