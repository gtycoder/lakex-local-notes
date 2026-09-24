const port = process.argv[2];
const expr = process.argv[3];
const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target"); process.exit(2); }
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
const id = 1;
const result = await new Promise((res) => {
  socket.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === id) res(m); };
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});
socket.close();
if (result.result && result.result.exceptionDetails) { console.log("EXCEPTION: " + JSON.stringify(result.result.exceptionDetails.exception || result.result.exceptionDetails)); process.exit(1); }
console.log(JSON.stringify(result.result && result.result.result ? result.result.result.value : result));
