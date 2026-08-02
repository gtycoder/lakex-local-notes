#!/usr/bin/env bash
# 双 ABI 测试基建：为 vitest（Node ABI）单独装一份 better-sqlite3。
# 仓库 node_modules 里的 better-sqlite3 是 Electron ABI（@electron/rebuild 后），
# 纯 Node 的 vitest 无法 require（NODE_MODULE_VERSION 不匹配）。
# 用法：bash scripts/setup-test-abi.sh  （需 Node ≥ 20.12，见 docs/DEVELOPMENT.md §一）
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f test-node-abi/node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then
  echo "test-node-abi 已就绪，跳过安装"
  exit 0
fi

export npm_config_registry=https://registry.npmmirror.com
export npm_config_cache=/tmp/npm-cache-lake
mkdir -p test-node-abi
cd test-node-abi
if [ ! -f package.json ]; then
  npm init -y >/dev/null
fi
npm install better-sqlite3@11.3.0

echo "完成：test-node-abi/node_modules/better-sqlite3（Node ABI）"
