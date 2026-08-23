
import sys, json, websocket, time
ws = websocket.create_connection(sys.argv[1], timeout=15, suppress_origin=True)
mid = 0
def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
    return mid
send('Runtime.enable')
send('Log.enable')
send('Page.enable')
# 触发一次页面 reload 观察加载错误
send('Page.reload', {'ignoreCache': True})
time.sleep(6)
# 收集消息
msgs = []
while True:
    try:
        ws.settimeout(0.5)
        msg = json.loads(ws.recv())
    except Exception:
        break
    if msg.get('method') in ('Runtime.exceptionThrown', 'Log.entryAdded', 'Runtime.consoleAPICalled'):
        m = msg.get('params', {})
        if msg['method'] == 'Log.entryAdded':
            e = m.get('entry', {})
            if e.get('level') in ('error', 'warning'):
                msgs.append(f"[{e.get('level')}] {e.get('text','')[:200]} url={e.get('url','')[:80]}")
        elif msg['method'] == 'Runtime.exceptionThrown':
            d = m.get('exceptionDetails', {})
            msgs.append(f"[EXC] {d.get('text','')} {d.get('exception',{}).get('description','')[:200]}")
        elif msg['method'] == 'Runtime.consoleAPICalled':
            if msg['params'].get('type') == 'error':
                args = m.get('args', [])
                txt = ' '.join(a.get('value') or a.get('description') or '' for a in args)[:200]
                msgs.append(f"[console.error] {txt}")
print(json.dumps(msgs[:30], ensure_ascii=False))
ws.close()
