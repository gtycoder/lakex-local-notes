import sys, json, websocket
url = sys.argv[1]
expr = open(sys.argv[2]).read()
ws = websocket.create_connection(url, timeout=20, suppress_origin=True)
mid = 0
def send(method, params):
    global mid
    mid += 1
    ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == mid:
            if msg.get('error'): raise Exception(str(msg['error']))
            return msg.get('result', {})
r = send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
print(json.dumps(r)[:3000])
ws.close()