// 给 Android 端配置 S3（凭证从 env 读，不进命令行/不打印）
const port = process.argv[2];
const cfg = {
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, bucket: process.env.S3_BUCKET,
  prefix: process.env.PREFIX, accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK,
  forcePathStyle: false,
};
async function target() {
  const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  return list.find((t) => t.type === "page");
}
async function evalExpr(page, expr) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const id = 1;
  const out = await new Promise((res) => {
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === id) res(m); };
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  ws.close();
  return out.result;
}
// 等待 bridge 就绪
let ready = false;
for (let i = 0; i < 60; i++) {
  const page = await target();
  if (page) {
    const r = await evalExpr(page, "!!(window.lakeNative && window.lakeNative.saveS3Settings)");
    if (r && r.result && r.result.value === true) { ready = true; break; }
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) { console.error("bridge not ready on " + port); process.exit(2); }
const page = await target();
const expr = "window.lakeNative.saveS3Settings(" + JSON.stringify(cfg) + ").then(function(){return window.lakeNative.getS3Settings();}).then(function(c){return {bucket:c.bucket,prefix:c.prefix,hasSecret:!!c.secretAccessKey};})";
const out = await evalExpr(page, expr);
if (out && out.exceptionDetails) { console.error("EXC", JSON.stringify(out.exceptionDetails)); process.exit(3); }
console.log("port " + port + " -> " + JSON.stringify(out.result && out.result.value));
