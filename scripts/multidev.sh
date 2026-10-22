#!/usr/bin/env bash
# LocalLakexNotes 本地多端联调脚本（顺序双端）。
# 用法：
#   ./scripts/multidev.sh vite       # 启动 vite dev server（自动临时禁用 electron 自动拉起）
#   ./scripts/multidev.sh device-a   # 启动设备 A（默认 dev userData）
#   ./scripts/multidev.sh device-b   # 启动设备 B（独立 $TMPDIR/lake-device-b）
#   ./scripts/multidev.sh stop       # 关闭 vite / electron 并还原 vite.config.ts
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITE_CFG="$ROOT/vite.config.ts"
VITE_CFG_BAK="$VITE_CFG.multidev-bak"
PID_FILE="${TMPDIR:-/tmp}/lake-multidev.pids"
VITE_PID_FILE="${TMPDIR:-/tmp}/lake-multidev-vite.pid"
VITE_LOG="${TMPDIR:-/tmp}/lake-multidev-vite.log"
DEVICE_LOG_A="${TMPDIR:-/tmp}/lake-multidev-device-a.log"
DEVICE_LOG_B="${TMPDIR:-/tmp}/lake-multidev-device-b.log"
DEVICE_B_DIR="${TMPDIR:-/tmp}/lake-device-b"

# Node 24 优先（vite 8 / vitest 需要较新 Node）
NODE24="$HOME/.nvm/versions/node/v24.18.0/bin"
[ -d "$NODE24" ] && export PATH="$NODE24:$PATH"

cd "$ROOT"

# 临时禁用 vite-plugin-electron 自动拉起（结束/还原时恢复）
patch_vite_onstart() {
  if [ -f "$VITE_CFG_BAK" ]; then return; fi
  cp "$VITE_CFG" "$VITE_CFG_BAK"
  # 修正（V5 §5.6）：正则替换 onstart 行为空——旧逻辑「缺失才插入」在已有 onstart 时是空操作，多端流程静默失效
  node -e 'const fs=require("fs");const p=process.argv[1];let s=fs.readFileSync(p,"utf8");s=s.replace(/onstart:\s*async\s*\(\{ startup \}\)\s*=>\s*\{[\s\S]*?\},\s*\n/, "");fs.writeFileSync(p,s);' "$VITE_CFG"
}

restore_vite_onstart() {
  if [ -f "$VITE_CFG_BAK" ]; then
    mv "$VITE_CFG_BAK" "$VITE_CFG"
  fi
}

start_vite() {
  patch_vite_onstart
  if [ -f "$VITE_PID_FILE" ] && kill -0 "$(cat "$VITE_PID_FILE")" 2>/dev/null; then
    echo "vite 已在运行 (pid $(cat "$VITE_PID_FILE"))"
    return
  fi
  nohup node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421 >"$VITE_LOG" 2>&1 &
  echo $! > "$VITE_PID_FILE"
  echo "vite 已启动 (pid $(cat "$VITE_PID_FILE"))，监听 http://127.0.0.1:1421"
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://127.0.0.1:1421/"; then echo "vite 就绪"; return; fi
    sleep 0.25
  done
  echo "vite 启动超时，请检查日志" >&2
  exit 1
}

run_device() {
  local name="$1" data_dir="$2" cdp="${3:-}" log="$4" port="$5"
  # 每个设备独立 LAKE_ASSET_PORT（A=19876 默认、B=19877），避免资源端口冲突导致主进程退出。
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "检测到已有进程占用 $port；请先关闭当前设备（或先运行 $0 stop），再启动另一个设备。" >&2
    exit 1
  fi
  # Electron 43 起本机 Chromium GPU 空转（fontations_ffi → 渲染冻结）已修复
  # （2026-08-16 裸启动实测：无任何禁用参数，GPU Helper ~2% CPU、渲染正常）。
  # 不再激进禁用 GPU，仅显式使用 Metal 后端。
  local args=(--use-angle=metal)
  [ -n "$cdp" ] && args+=(--remote-debugging-port="$cdp")
  echo "starting ${name} (userData=${data_dir:-default}, assetPort=${port:-19876})"
  # 本环境 nohup 起不了 electron：手动前台 tty 启动时请直接复制下方命令。
  echo "  LAKE_USER_DATA="${data_dir}" LAKE_ASSET_PORT=$port ./node_modules/.bin/electron --use-angle=metal ."
  if [ -n "$data_dir" ]; then
    LAKE_USER_DATA="$data_dir" LAKE_ASSET_PORT="$port" nohup ./node_modules/.bin/electron "${args[@]}" . >"$log" 2>&1 &
  else
    LAKE_ASSET_PORT="$port" nohup ./node_modules/.bin/electron "${args[@]}" . >"$log" 2>&1 &
  fi
  echo $! >> "$PID_FILE"
}

case "${1:-}" in
  vite) start_vite ;;
  device-a) start_vite; run_device "设备 A" "" "${MULTIDEV_CDP_PORT:-}" "$DEVICE_LOG_A" "19876" ;;
  device-b) start_vite; run_device "设备 B" "$DEVICE_B_DIR" "${MULTIDEV_CDP_PORT:-}" "$DEVICE_LOG_B" "19877" ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      while read -r pid; do
        kill "$pid" 2>/dev/null || true
      done < "$PID_FILE"
      : > "$PID_FILE"
    fi
    if [ -f "$VITE_PID_FILE" ]; then
      kill "$(cat "$VITE_PID_FILE")" 2>/dev/null || true
      : > "$VITE_PID_FILE"
    fi
    restore_vite_onstart
    echo "已停止并还原 vite.config.ts"
    ;;
  *) echo "用法: $0 {vite|device-a|device-b|stop}"; exit 1 ;;
esac
