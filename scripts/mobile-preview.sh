#!/usr/bin/env bash
# 在电脑浏览器里预览移动端 App（Capacitor WebView 同源 bundle 的浏览器可运行版）。
# 用途：不依赖模拟器/真机，快速测移动端 UI、剪贴板注入等纯 DOM/编辑逻辑。
#   注意：native 桥（AssetServer/原生 HTTP/原生文件系统）在浏览器里是 web 回退，S3 上传/资产渲染可能降级；
#   完整安卓行为请用模拟器（scripts/emu-up.sh）或真机。
#
# 用法：./scripts/mobile-preview.sh [port]
#   默认端口 1422。启动后浏览器打开：
#     http://127.0.0.1:<port>/index.html
#   在 Chrome DevTools（F12 → 设备工具栏 → iPhone/窄屏）或 390x844 窄窗口里看即移动布局。
#
# 前置：node 24（PATH 由脚本内置，与 android-build.sh 一致）。构建产物 dist-mobile。
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
PORT="${1:-1422}"

if [ ! -f dist-mobile/index.html ]; then
  echo "==> 无 dist-mobile，先构建（vite build -c vite.mobile.config.ts）"
  npx vite build --config vite.mobile.config.ts 2>&1 | tail -3
fi

echo "==> 移动端浏览器预览已就绪："
echo "      http://127.0.0.1:$PORT/preview.html"
echo "    （该页把 App 包在 390×844 竖屏手机框里，居中并自动缩放适配窗口）"
echo "    退出：Ctrl+C"
python3 -m http.server "$PORT" --directory dist-mobile
