// 给一端或多端配置 S3（凭证从 env 读，不进命令行/不打印）。
// 261112：支持 `configure-s3.mjs 9232 9233 9234`（此前只读 argv[2]，多端口时后两个静默未配置）。
const PORTS = process.argv.slice(2);
if (PORTS.length === 0) { console.error("usage: configure-s3.mjs <port> [port...]"); process.exit(1); }
const cfg = {
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, bucket: process.env.S3_BUCKET,
  prefix: process.env.PREFIX, accessKeyId: process.env.S3_AK, secretAccessKey: process.env.S3_SK,
  forcePathStyle: false,
};
async function configureOne(port) {
async function target() {
  const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  // 冷启动时有 boot 遮罩页（无 lakeNative 桥）⇒ 只认应用页。
  return list.find((t) => t.type === "page" && !/boot\.html/.test(t.url || "")) || null;
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
}
for (const port of PORTS) await configureOne(port);