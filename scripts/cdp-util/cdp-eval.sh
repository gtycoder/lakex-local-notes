#!/bin/bash
# 用法: cdp-eval.sh <port> '<js expression>'
PORT=$1
EXPR=$2
WS=$(curl -s -m 3 http://127.0.0.1:$PORT/json | python3 -c "import sys,json; d=json.load(sys.stdin); pages=[t['webSocketDebuggerUrl'] for t in d if t.get('type')=='page' and not t.get('url','').startswith('devtools://')]; print(pages[0] if pages else '')")
if [ -z "$WS" ]; then echo "NO_PAGE on :$PORT"; exit 1; fi
echo "(async()=>{return ($EXPR);})()" > /tmp/cdp-expr.js
python3 "$(dirname "$0")/eval.py" "$WS" /tmp/cdp-expr.js
