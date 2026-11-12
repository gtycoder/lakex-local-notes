#!/bin/bash
# task-58 · 真实七牛桶 B 档 13 条场景 driver
# 用法：bash scripts/multi-end-sync/run58.sh [--keep]   （--keep = 结束后不删实例，便于现场看日志）
# 纪律：唯一前缀 audit-261112-scn-<stamp>；结束只 DELPREFIX 本前缀；实例按 CDP 端口 PID 关闭；不碰正式数据目录。
set -u
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1

if [ ! -f /tmp/lake5/creds.env ]; then echo "缺少 /tmp/lake5/creds.env（chmod 600）"; exit 2; fi
set -a; . /tmp/lake5/creds.env; set +a
export PREFIX="audit-261112-scn-$(date +%m%d%H%M%S)"
echo "PREFIX=$PREFIX" | tee /tmp/lake5/scn-prefix.txt

# vite（1421）
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1421/ 2>/dev/null || true)
if [ "$code" != "200" ]; then
  echo "起 vite…"
  nohup npx vite --host 127.0.0.1 --port 1421 >/tmp/lake5/vite58.log 2>&1 &
  for i in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1421/ 2>/dev/null)" = "200" ] && break
    sleep 1
  done
fi

# 清旧实例（只按 CDP 端口精确定位）
for p in 9232 9233 9234; do pid=$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | head -1); [ -n "${pid:-}" ] && { echo "kill stale $p pid=$pid"; kill "$pid" 2>/dev/null; }; done
sleep 4
rm -rf /tmp/lake5/s1 /tmp/lake5/s2 /tmp/lake5/s3

echo "起 3 个隔离桌面（19881/19882/19883，CDP 9232/9233/9234）…"
for pair in "s1 19881 9232" "s2 19882 9233" "s3 19883 9234"; do
  set -- $pair; d=$1; ap=$2; cdp=$3
  LAKE_USER_DATA=/tmp/lake5/$d LAKE_ASSET_PORT=$ap LAKE_DEV_SERVER_URL=http://127.0.0.1:1421 \
    nohup env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --use-angle=metal --remote-debugging-port=$cdp . >>/tmp/lake5/$d.log 2>&1 &
done
sleep 18

echo "配置 S3（唯一前缀）…"
node scripts/multi-end-sync/configure-s3.mjs 9232 9233 9234 2>&1 | tail -3

echo "== 跑 13 条 B 档场景 $(date +%T) =="
node scripts/multi-end-sync/scenario58.mjs > /tmp/lake5/scn58.out 2>&1
SCN_EXIT=$?
echo "scenario58 EXIT=$SCN_EXIT"

# 清理：实例（按 CDP 端口 PID）
if [ "$KEEP" = "0" ]; then
  for p in 9232 9233 9234; do pid=$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | head -1); [ -n "${pid:-}" ] && { echo "kill $p pid=$pid"; kill "$pid" 2>/dev/null; }; done
  sleep 5
fi
# 清理：只删本前缀
echo "== DELPREFIX=$PREFIX =="
DELPREFIX=$PREFIX node scripts/multi-end-sync/delprefix.mjs 2>&1
if [ "$KEEP" = "0" ]; then rm -rf /tmp/lake5/s1 /tmp/lake5/s2 /tmp/lake5/s3; fi
# 残留复核（只列本前缀）
node -e '
const { createRequire } = require("node:module"); const req = createRequire(process.cwd() + "/package.json");
const { S3Client, ListObjectsV2Command } = req("@aws-sdk/client-s3");
const c = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, credentials: { accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK }, forcePathStyle: false });
(async () => { let n = 0, t; do { const r = await c.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: process.env.PREFIX + "/", ContinuationToken: t })); (r.Contents||[]).forEach(()=>n++); t = r.IsTruncated ? r.NextContinuationToken : undefined; } while (t); console.log("RESIDUAL under " + process.env.PREFIX + " = " + n); process.exit(n === 0 ? 0 : 1); })();
' 2>&1
RES_EXIT=$?
echo "== DONE $(date +%T) | scenario=$SCN_EXIT residual=$RES_EXIT | 报告见 /tmp/lake5/scn58.out =="
exit $([ "$SCN_EXIT" = "0" ] && [ "$RES_EXIT" = "0" ] && echo 0 || echo 1)
