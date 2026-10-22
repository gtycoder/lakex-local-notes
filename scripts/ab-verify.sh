#!/usr/bin/env bash
# 双桌面 AB 端真实验证（重构正确性端到端验证）
# 用法：S3_AK=xxx S3_SK=xxx ./scripts/ab-verify.sh
# 流程：patch vite → 注入两端 S3 配置 → 启 vite → 启 A(dev 数据/CDP9222) → 启 B(TMPDIR/CDP9223)
#      → node ab-verify.mjs（CDP 驱动：建→同步→B拉→删→B跟随）→ 清理还原
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
export S3_ENDPOINT="${S3_ENDPOINT:-https://s3.cn-north-1.qiniucs.com}"
export S3_REGION="${S3_REGION:-cn-north-1}"
export S3_BUCKET="${S3_BUCKET:-local-lake-hebei}"
export S3_PREFIX="${S3_PREFIX:-ab-test-$(date +%Y%m%d%H%M)}"

[ -z "${S3_AK:-}" ] || [ -z "${S3_SK:-}" ] && { echo "需要 S3_AK / S3_SK 环境变量"; exit 1; }

export DEVICE_A_DATA="$HOME/Library/Application Support/local-lakex-notes-dev"
export DEVICE_B_DATA="${TMPDIR:-/tmp}/lake-device-b"
VITE_CFG="vite.config.ts"; VITE_CFG_BAK="$VITE_CFG.multidev-bak"
PID_FILE="${TMPDIR:-/tmp}/lake-ab.pids"
LOG_A="${TMPDIR:-/tmp}/lake-ab-a.log"; LOG_B="${TMPDIR:-/tmp}/lake-ab-b.log"; LOG_VITE="${TMPDIR:-/tmp}/lake-ab-vite.log"

cleanup() {
  [ -f "$PID_FILE" ] && while read -r p; do kill "$p" 2>/dev/null || true; done < "$PID_FILE" || true
  rm -f "$PID_FILE"
  [ -f "$VITE_CFG_BAK" ] && mv "$VITE_CFG_BAK" "$VITE_CFG"
  echo "已清理（进程 + vite.config 还原）"
}
trap cleanup EXIT

echo "==> 注入两端 S3 配置（独立测试前缀 ${S3_PREFIX}）"
mkdir -p "$DEVICE_B_DATA"
node -e '
const Database = require("better-sqlite3");
const cfg = {
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, bucket: process.env.S3_BUCKET,
  prefix: process.env.S3_PREFIX, accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK,
  forcePathStyle: false,
};
for (const dir of [process.env.DEVICE_A_DATA, process.env.DEVICE_B_DATA]) {
  const dbPath = `${dir}/workspace-default/metadata.sqlite3`;
  const fs = require("fs"); fs.mkdirSync(`${dir}/workspace-default`, { recursive: true });
  const db = new Database(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO settings(key,value) VALUES(\x27s3_settings\x27,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(cfg));
  db.close();
  console.log("  已注入:", dbPath);
}
' 2>&1

echo "==> patch vite（禁用 electron 自动拉起）"
cp "$VITE_CFG" "$VITE_CFG_BAK"
node -e 'const fs=require("fs");let s=fs.readFileSync(process.argv[1],"utf8");s=s.replace(/onstart:\s*async\s*\(\{ startup \}\)\s*=>\s*\{[\s\S]*?\},\s*\n/,"");fs.writeFileSync(process.argv[1],s);' "$VITE_CFG"

echo "==> 启动 vite"
nohup node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421 >"$LOG_VITE" 2>&1 &
echo $! > "$PID_FILE"
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:1421/" && break; sleep 0.25; done

echo "==> 启动设备 A（dev 数据 / CDP 9222 / 资源 19876）"
LAKE_USER_DATA="$DEVICE_A_DATA" LAKE_ASSET_PORT=19876 nohup ./node_modules/.bin/electron --use-angle=metal --remote-debugging-port=9222 . >"$LOG_A" 2>&1 &
echo $! >> "$PID_FILE"

echo "==> 启动设备 B（$DEVICE_B_DATA / CDP 9223 / 资源 19877）"
LAKE_USER_DATA="$DEVICE_B_DATA" LAKE_ASSET_PORT=19877 nohup ./node_modules/.bin/electron --use-angle=metal --remote-debugging-port=9223 . >"$LOG_B" 2>&1 &
echo $! >> "$PID_FILE"

echo "==> 等待两端 CDP 就绪"
for _ in $(seq 1 180); do
  a=$(curl -s --connect-timeout 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:9222/json/version" 2>/dev/null || echo 000)
  b=$(curl -s --connect-timeout 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:9223/json/version" 2>/dev/null || echo 000)
  [ "$a" = "200" ] && [ "$b" = "200" ] && break
  sleep 1
done
echo "CDP A=${a} B=${b}"
if [ "$a" != "200" ] || [ "$b" != "200" ]; then
  echo "CDP 未就绪，退出（日志见 ${LOG_A} / ${LOG_B} / ${LOG_VITE}）" >&2
  exit 1
fi

echo "==> CDP 驱动验证"
node scripts/ab-verify.mjs
echo "==> 验证完成（退出码 ${?}，日志见 ${LOG_A} / ${LOG_B}）"
