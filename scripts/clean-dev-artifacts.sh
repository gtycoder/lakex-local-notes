#!/usr/bin/env bash
# 开发产物 / 临时夹具清理（261105 建立，用于回收本机常驻的「可重建垃圾」）。
#
# 用法：bash scripts/clean-dev-artifacts.sh            # 只报告（默认 dry-run，显示体积与将删项）
#       bash scripts/clean-dev-artifacts.sh --apply     # 真正删除
#
# 只删**可重建**的东西，绝不碰：
#   - ~/Library/Application Support/lakex-local-notes（正式数据，本机会话一律禁止）
#   - lakex-local-notes-dev/workspace-default（手测笔记）与 Local/Session Storage（设备本地视图）
#   - node_modules / .git / vendor / patches / docs / guide / src / scripts / android 源码
#   - AVD 本体（模拟器重建成本高；本脚本不动 ~/.android）
#
# 为什么需要它：本机 vitest 临时夹具（$TMPDIR/lake-*）会随测试累积到 20G+；
# dist/release/android 构建产物、.css-audit 中间快照、Electron Cache 也都是可重建的。
# 门禁基线不在 .css-audit（在 scripts/mobile-audit/baseline/、scripts/css-audit/baseline/），
# 所以清 .css-audit 不会让快照门禁假红，只会失去当批次的对拍截图证据。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

TARGETS=()
add_target() { if [ -e "$1" ]; then TARGETS+=("$1"); fi; }

# 仓库内构建产物（vite / electron-builder / gradle）
add_target "$ROOT/dist"
add_target "$ROOT/dist-mobile"
add_target "$ROOT/dist-electron"
add_target "$ROOT/release"
add_target "$ROOT/android/app/build"
add_target "$ROOT/android/build"
add_target "$ROOT/android/.gradle"
# 审计中间快照（对拍证据；基线在 scripts/**/baseline/，不在这里）
add_target "$ROOT/.css-audit"

# dev 版 Electron 的可再生缓存与日志（保留 workspace-default / Local Storage）
APP="$HOME/Library/Application Support/lakex-local-notes-dev"
for d in Cache "Code Cache" GPUCache DawnWebGPUCache DawnGraphiteCache GraphiteDawnCache logs; do
  add_target "$APP/$d"
done

# vitest 临时夹具：$TMPDIR/lake-*（每次跑测试都会新建，绝大多数来自 electron/core 用例）
TMP="${TMPDIR%/}"
if [ -n "$TMP" ] && [ -d "$TMP" ]; then
  while IFS= read -r -d '' p; do TARGETS+=("$p"); done < <(find "$TMP" -maxdepth 1 -name 'lake-*' -print0 2>/dev/null)
  while IFS= read -r -d '' p; do TARGETS+=("$p"); done < <(find "$TMP" -maxdepth 1 -name '.com.lakexlocalnotes.desktop.*' -print0 2>/dev/null)
fi

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "没有需要清理的目标。"
  exit 0
fi

echo "== 清理目标（$([ "$APPLY" = 1 ] && echo 执行 || echo 预览)）=="
total_kb=0
for t in "${TARGETS[@]}"; do
  kb=$(du -sk "$t" 2>/dev/null | awk '{print $1}')
  kb=${kb:-0}
  total_kb=$((total_kb + kb))
  printf '  %8s  %s\n' "$(du -sh "$t" 2>/dev/null | awk '{print $1}')" "$t"
done
echo "-- 合计约 $((total_kb / 1024)) MB --"

if [ "$APPLY" = 1 ]; then
  for t in "${TARGETS[@]}"; do rm -rf "$t"; done
  # 顺带清工作区里的 .DS_Store（不碰 node_modules）
  find "$ROOT/.." -maxdepth 3 -name .DS_Store -type f -not -path '*/node_modules/*' -delete 2>/dev/null || true
  echo "已清理。注意：dist 被删后 npm run check:bundle / check:arch 需先 npx vite build 再跑。"
else
  echo "（dry-run）确认无误后重跑：bash scripts/clean-dev-artifacts.sh --apply"
fi
