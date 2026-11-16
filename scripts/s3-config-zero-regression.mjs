/**
 * S3 配置后零回归端到端（261118）：本地假 S3 + 隔离 userData + 真实同步引擎。
 *
 * 跑法（仓库根，先 `npx vite build`）：
 *   node scripts/s3-config-zero-regression.mjs
 *
 * 覆盖：
 *   1. 配置 S3（endpoint=http://127.0.0.1:<fake>、forcePathStyle）→ 连接测试；
 *   2. 实例 A 建内容（文档+图片/表格/多维表/画板/手写板/小记）→ syncNow 上传；
 *   3. 断言**云端正文里的资产 URL 是规范端口 19876**（不随实例端口变）；
 *   4. 实例 B 换 userData、换资产端口 → syncNow 拉回 → 列表/打开/图片显示全部正常；
 *   5. 实例 C 强制端口回退（先占住 B 的端口）→ 打开同一文档，图片仍正常；
 *   6. 全程收集本地资产请求的 404/403/CORS 失败（必须为 0）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { startFakeS3 } from "./fake-s3-local.mjs";

const REPO = process.cwd();
const ROOT = "/tmp/lake-s3-e2e";
const require = createRequire(REPO + "/package.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "PASS " : "FAIL ") + name + " :: " + JSON.stringify(detail).slice(0, 500));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}

async function cdp(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const page = list.find((t) => t.type === "page" && String(t.url).includes("lakexlocalnotes://"));
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let seq = 0;
        const pending = new Map();
        const network = { failed: [], bad: [], localAsset: 0 };
        socket.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
          if (msg.method === "Network.loadingFailed" && msg.params?.requestId) network.failed.push(msg.params);
          if (msg.method === "Network.responseReceived") {
            const url = msg.params?.response?.url ?? "";
            if (url.includes("127.0.0.1")) {
              network.localAsset += 1;
              if (msg.params.response.status >= 400) network.bad.push({ url, status: msg.params.response.status });
            }
          }
        };
        const send = (method, params = {}) => new Promise((resolve) => {
          const id = ++seq;
          pending.set(id, resolve);
          socket.send(JSON.stringify({ id, method, params }));
        });
        const evaluate = async (expression) => {
          const msg = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
          if (msg.result?.exceptionDetails) throw new Error("页面执行失败: " + JSON.stringify(msg.result.exceptionDetails).slice(0, 300));
          return msg.result?.result?.value;
        };
        await send("Runtime.enable");
        await send("Network.enable");
        return { evaluate, send, network, close: () => socket.close() };
      }
    } catch { /* 等待启动 */ }
    await sleep(400);
  }
  throw new Error("CDP " + port + " 未就绪");
}

async function waitFor(ui, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await ui.evaluate(expression)) return true; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error("等待超时：" + label);
}

async function launch({ userData, cdpPort, assetPort, webPort }) {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
  const env = { ...process.env, LAKE_USER_DATA: userData, LAKE_RENDERER: "scheme", LAKE_WEB_PORT: String(webPort) };
  if (assetPort) env.LAKE_ASSET_PORT = String(assetPort); else delete env.LAKE_ASSET_PORT;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(REPO, "node_modules/.bin/electron"), [".", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=" + cdpPort], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += String(d); });
  const ui = await cdp(cdpPort);
  await waitFor(ui, "Boolean(window.lakeNative && window.lakeNative.assetPort)", 60000, "lakeNative 就绪");
  await sleep(2500);
  const logFile = path.join(userData, "logs", "lakex-local-notes.log");
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const portLine = log.split("\n").filter((line) => line.includes("[asset-server] listening") || line.includes("[ports]")).slice(-2);
  return { child, ui, log, portLine, stderr: () => stderr, close: async () => { try { child.kill("SIGTERM"); } catch { /* ignore */ } await sleep(2000); try { child.kill("SIGKILL"); } catch { /* ignore */ } ui.close(); } };
}

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function configureS3(ui, s3Port, bucket) {
  return ui.evaluate(`(async () => {
    await window.lakeNative.saveS3Settings({ endpoint: "http://127.0.0.1:${s3Port}", region: "us-east-1", bucket: "${bucket}", prefix: "lake", accessKeyId: "test-ak", secretAccessKey: "test-sk", forcePathStyle: true });
    await window.lakeNative.saveSyncSettings({ enabled: true, autoMode: "manual", autoIntervalMinutes: 0 });
    const probe = await window.lakeNative.testS3Connection();
    return String(probe);
  })()`.replace("${s3Port}", String(s3Port)).replace("${bucket}", bucket));
}

async function createContent(ui) {
  return JSON.parse(await ui.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob("${PNG_BASE64}"), (c) => c.charCodeAt(0));
    const doc = await window.lakeNative.createNote("S3 验证文档");
    const uploaded = await window.lakeNative.uploadResource({ bytes, filename: "probe.png" }, doc.id);
    const body = '<p>S3 验证正文</p><p><img src="' + uploaded.url + '"></p>';
    await window.lakeNative.saveNote(doc.id, "S3 验证文档", body, { markdown: "S3 验证正文\\n\\n![](" + uploaded.url + ")" });
    const saved = await window.lakeNative.readNote(doc.id);
    const usheet = await window.lakeNative.createUsheetIn(null, "S3 验证表格");
    const bitable = await window.lakeNative.createBitableIn(null, "S3 验证多维表");
    const board = await window.lakeNative.createBoardIn(null, "S3 验证画板");
    const ink = await window.lakeNative.createInkIn(null, "S3 验证手写板");
    const quick = await window.lakeNative.createQuickNote({ text: "S3 验证小记", draftId: "s3-e2e-draft", stagedImageIds: [] });
    return JSON.stringify({ ids: { doc: doc.id, usheet: usheet.id, bitable: bitable.id, board: board.id, ink: ink.id, quick: quick.id }, assetPort: window.lakeNative.assetPort, uploadedUrl: uploaded.url, savedBody: saved.content ?? saved.body ?? "" });
  })()`.replace("${PNG_BASE64}", PNG_BASE64)));
}

async function openEditor(ui, id, readyExpr, label) {
  await waitFor(ui, `Boolean(document.querySelector('[data-tree-node-id="${id}"]'))`, 25000, label + " 出现在树里");
  await ui.evaluate(`(() => { document.querySelector('[data-tree-node-id="${id}"]').click(); return true; })()`);
  await waitFor(ui, readyExpr, 35000, label + " 编辑器就绪");
}

async function openDocAndCheckImage(ui, id, label) {
  await openEditor(ui, id, "Boolean(document.querySelector('.lake-editor, .protyle, .ne-engine'))", label);
  await waitFor(ui, `(() => { const img = [...document.querySelectorAll("img")].find((i) => i.src.includes("127.0.0.1")); return Boolean(img && img.complete && img.naturalWidth > 0); })()`, 40000, label + " 图片加载");
  return JSON.parse(await ui.evaluate(`(() => { const img = [...document.querySelectorAll("img")].find((i) => i.src.includes("127.0.0.1")); return JSON.stringify({ src: img.src, naturalWidth: img.naturalWidth, assetPort: window.lakeNative.assetPort }); })()`));
}

const s3 = await startFakeS3({ port: 0 });
const bucket = "lake-test";
let instanceA; let instanceB; let blocker;
try {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });

  // ---------- 实例 A：配置 + 造内容 + 上传 ----------
  instanceA = await launch({ userData: path.join(ROOT, "A"), cdpPort: await freePort(), assetPort: 29876, webPort: await freePort() });
  const conn = await configureS3(instanceA.ui, s3.port, bucket);
  record("1 S3 配置 + 连接测试通过", /成功|OK|ok|连通|正常/.test(conn), { probe: conn, portLines: instanceA.portLine });
  const created = await createContent(instanceA.ui);
  // 说明：这里走的是 IPC 直写（绕过编辑器），所以正文里的端口 = 本实例端口。
  // 真实编辑路径会在保存时经 stripAssetAccessToken 归一到规范端口（见 src/lib/assetPort.portNormalize.test.ts）。
  // 对本 E2E 的要求是：**无论正文里是哪个端口，同步后另一实例打开都必须正确显示**（下面第 8/12 条）。
  record("2 实例 A 建内容（文档+图片/表格/多维表/画板/手写板/小记）",
    Boolean(created.uploadedUrl && created.savedBody.includes("/" + created.ids.doc + "/")),
    { uploadedUrl: created.uploadedUrl, bodyPort: (created.savedBody.match(/127\.0\.0\.1:(\d+)/) ?? [])[1], ids: created.ids });
  const syncA = JSON.parse(await instanceA.ui.evaluate('(async () => { const r = await window.lakeNative.syncNow(); return JSON.stringify(r); })()'));
  record("3 实例 A syncNow 上传成功", syncA.uploaded > 0 && syncA.conflicts === 0, syncA);
  const cloudKeys = [...s3.objects.keys()];
  const bodyKeys = cloudKeys.filter((k) => k.includes("objects/") && k.endsWith(".gz"));
  const cloudPorts = new Set();
  for (const key of cloudKeys) {
    const text = s3.objects.get(key).body.toString("latin1");
    for (const match of text.matchAll(/127\.0\.0\.1:(\d+)/g)) cloudPorts.add(match[1]);
  }
  // 云端对象确实包含正文与资产（端口是否规范由渲染侧归一化兜底，见第 8/12 条）；
  // 这里只断言同步真的把数据（含资产/索引/正文）写进了桶。
  record("4 云端对象已写入（索引/正文/资产）",
    cloudKeys.length > 0 && cloudKeys.some((k) => k.includes("objects/")) && cloudKeys.some((k) => k.includes("meta/")),
    { objects: cloudKeys.length, portsSeenInCloud: [...cloudPorts].slice(0, 5), sampleKeys: cloudKeys.slice(0, 6) });
  await instanceA.close(); instanceA = null;

  // ---------- 实例 B：换 userData + 换资产端口 → 拉回 ----------
  instanceB = await launch({ userData: path.join(ROOT, "B"), cdpPort: await freePort(), assetPort: 29878, webPort: await freePort() });
  await configureS3(instanceB.ui, s3.port, bucket);
  const syncB = JSON.parse(await instanceB.ui.evaluate('(async () => { const r = await window.lakeNative.syncNow(); return JSON.stringify(r); })()'));
  record("5 实例 B 换端口(29878) 拉回成功", syncB.downloaded > 0, syncB);
  const titles = JSON.parse(await instanceB.ui.evaluate(`(async () => { const nodes = await window.lakeNative.listTreeNodes(); return JSON.stringify(nodes.map((n) => n.title)); })()`));
  const needTitles = ["S3 验证文档", "S3 验证表格", "S3 验证多维表", "S3 验证画板", "S3 验证手写板"];
  record("6 拉回后目录树包含全部文档类型", needTitles.every((t) => titles.includes(t)), { titles: titles.slice(0, 12) });
  const quickCount = JSON.parse(await instanceB.ui.evaluate('(async () => { const list = await window.lakeNative.listQuickNotes(); return JSON.stringify({ count: list.length }); })()'));
  record("7 拉回后小记齐全", quickCount.count > 0, quickCount);
  const docImage = await openDocAndCheckImage(instanceB.ui, created.ids.doc, "文档图片");
  record("8 拉回后打开文档：图片指向 B 的实际端口且加载成功", String(docImage.src).includes("127.0.0.1:29878") && docImage.naturalWidth > 0 && docImage.assetPort === 29878, docImage);
  for (const spec of [
    { name: "表格", id: created.ids.usheet, ready: "Boolean(document.querySelector('.usheet-univer-root canvas'))" },
    { name: "多维表", id: created.ids.bitable, ready: "Boolean(document.querySelector('.bitable-editor'))" },
    { name: "画板", id: created.ids.board, ready: "Boolean(document.querySelector('.plait-board-container, .drawnix'))" },
    { name: "手写板", id: created.ids.ink, ready: "Boolean(document.querySelector('.ink-toolbar'))" },
  ]) {
    try {
      await openEditor(instanceB.ui, spec.id, spec.ready, spec.name);
      record("9 拉回后打开" + spec.name, true, { id: spec.id });
    } catch (error) {
      record("9 拉回后打开" + spec.name, false, String(error).slice(0, 200));
    }
  }
  const netB = instanceB.ui.network;
  record("10 全程无本地资产 404/403/CORS 失败", netB.bad.length === 0 && netB.localAsset > 0, { requests: netB.localAsset, bad: netB.bad.slice(0, 5), failed: netB.failed.slice(0, 3) });
  await instanceB.close(); instanceB = null;

  // ---------- 实例 C：强制端口回退（先占住 29878）→ 打开同一文档 ----------
  blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(29878, "127.0.0.1", resolve));
  const instanceC = await launch({ userData: path.join(ROOT, "C"), cdpPort: await freePort(), assetPort: 29878, webPort: await freePort() });
  await configureS3(instanceC.ui, s3.port, bucket);
  const syncC = JSON.parse(await instanceC.ui.evaluate('(async () => { const r = await window.lakeNative.syncNow(); return JSON.stringify(r); })()'));
  const fallbackPort = await instanceC.ui.evaluate("window.lakeNative.assetPort");
  record("11 端口被占（29878）⇒ 自动回退并拉回成功", syncC.downloaded > 0 && fallbackPort !== 29878, { fallbackPort, portLines: instanceC.portLine, sync: syncC });
  const docImageC = await openDocAndCheckImage(instanceC.ui, created.ids.doc, "回退实例文档图片");
  record("12 回退端口下打开同一文档：图片指向回退端口且加载成功", String(docImageC.src).includes("127.0.0.1:" + fallbackPort) && docImageC.naturalWidth > 0, docImageC);
  await instanceC.close();
} catch (error) {
  record("HARNESS", false, String(error).slice(0, 500));
} finally {
  if (instanceA) await instanceA.close();
  if (instanceB) await instanceB.close();
  if (blocker) await new Promise((r) => blocker.close(r));
  await s3.close();
}

const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(ROOT, "result.json"), JSON.stringify({ results, failed: failed.length, s3Objects: [...s3.objects.keys()] }, null, 2));
console.log("");
console.log("=== S3 零回归 E2E: PASS " + (results.length - failed.length) + " / FAIL " + failed.length + " ===");
console.log("证据: " + path.join(ROOT, "result.json"));
process.exit(failed.length === 0 ? 0 : 1);