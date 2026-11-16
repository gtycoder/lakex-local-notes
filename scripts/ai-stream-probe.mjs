#!/usr/bin/env node
/**
 * 端到端 AI 流式计时探针（A+B 的 B）。
 *
 * 目标：**不需要真实 API Key**，让真实流式路径跑起来并量「用户可见的更新节奏」。
 *   dev 实例（CDP 9222） → 主进程 AI 网关（openai SDK） → 本地假供应商（本文件起的 HTTP SSE）
 *   → IPC onAiStream → AiStreamingMessageBody → useThrottledMarkdown → MarkdownView → DOM
 *
 * 前置：
 *   · 桌面 dev 实例在跑（npm run dev，带 --remote-debugging-port=9222）；
 *   · dev 库里已有一条 **loopback** provider（baseUrl = http://127.0.0.1:<port>/v1）。
 *     本机既有配置：openai → http://127.0.0.1:9123/v1（model=fake-writer）。探针只临时切换
 *     activeProviderId 到它，结束后恢复；**不改 baseUrl、不碰 Key**。
 *
 * 用法：
 *   node scripts/ai-stream-probe.mjs --label before --chars 640000 --frames 150 --frame-ms 20
 *   node scripts/ai-stream-probe.mjs --label after  --chars 640000 --frames 150 --frame-ms 20
 *   node scripts/ai-stream-probe.mjs --label realistic --chars 60000
 * 输出：<out>/<label>.json（默认 out=/tmp/ai-stream-probe）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { connect } from "./css-audit/drive.mjs";
import { buildDenseMarkdown, buildMarkdown, splitFrames } from "./ai-stream-probe-content.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HOOK_SOURCE = path.join(ROOT, "src/components/ui/markdown/useThrottledMarkdown.ts");

function arg(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const LABEL = arg("label", "run");
const FRAMES = Number(arg("frames", "150"));
const FRAME_MS = Number(arg("frame-ms", "20"));
const CHARS = Number(arg("chars", "640000"));
const DENSE = process.argv.includes("--dense");
const CDP_PORT = Number(arg("cdp", "9222"));
const OUT_DIR = arg("out", "/tmp/ai-stream-probe");
const TIMEOUT_MS = Number(arg("timeout", "90000"));
const REPEAT = Math.max(1, Number(arg("repeat", "5")));
/** resolve 后 drain 窗口（收被渲染阻塞而排队的 IPC delta；默认 150ms）。 */
const DRAIN_MS = Number(arg("drain-ms", "150"));

function readParams() {
  const source = fs.readFileSync(HOOK_SOURCE, "utf8");
  const maxWait = /const MAX_WAIT_MS = (\d+);/.exec(source);
  const costRate = /const COST_RATE = ([\d.]+);/.exec(source);
  return {
    maxWaitMs: maxWait ? Number(maxWait[1]) : null,
    costRate: costRate ? Number(costRate[1]) : null,
  };
}

/** 起假供应商：按固定速率吐 OpenAI 兼容 SSE chunk；GET /v1/models 供连通性/模型列表用。 */
function startFakeProvider(port, frames, frameMs) {
  const fullText = DENSE ? buildDenseMarkdown(CHARS) : buildMarkdown(CHARS);
  const chunks = splitFrames(fullText, frames);
  const state = { requests: 0, framesSent: 0, bytesSent: 0, startedAt: null, finishedAt: null, chunks: chunks.length, chars: fullText.length };
  const server = http.createServer(function (req, res) {
    if (req.method === "GET" && /\/models(\?|$)/.test(req.url || "")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "fake-writer", object: "model", owned_by: "probe" }, { id: "probe-model", object: "model", owned_by: "probe" }] }));
      return;
    }
    if (req.method !== "POST" || !(req.url || "").includes("/chat/completions")) {
      res.writeHead(404).end("not found");
      return;
    }
    state.requests += 1;
    // 读完请求体（openai SDK 会发 JSON；不读会挂住连接）。
    req.resume();
    req.on("end", async function () {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-request-id": "probe-" + state.requests,
      });
      const send = function (payload) {
        const line = "data: " + JSON.stringify(payload) + "\n\n";
        res.write(line);
        state.bytesSent += Buffer.byteLength(line);
      };
      const chunk = function (delta, finish) {
        send({
          id: "chatcmpl-probe",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "fake-writer",
          choices: [{ index: 0, delta: delta, finish_reason: finish || null }],
        });
      };
      state.startedAt = Date.now();
      for (const piece of chunks) {
        if (res.writableEnded) return;
        chunk({ content: piece });
        state.framesSent += 1;
        if (frameMs > 0) await new Promise(function (r) { setTimeout(r, frameMs); });
      }
      chunk({}, "stop");
      res.write("data: [DONE]\n\n");
      state.finishedAt = Date.now();
      res.end();
    });
  });
  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", function () {
      resolve({ server: server, state: state, port: port, fullText: fullText });
    });
  });
}

function loopbackProvider(settings) {
  const providers = (settings && settings.providers) || [];
  return providers.find(function (p) {
    return typeof p.baseUrl === "string" && /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(p.baseUrl);
  }) || null;
}

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function waitReady(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await page.evaluate("(function(){ return { state: document.readyState, shell: !!document.querySelector('.app-shell'), rootKids: (document.querySelector('#root')||{}).childElementCount || 0 }; })()");
    if (ready.state === "complete" && ready.shell && ready.rootKids > 0) return true;
    await sleep(200);
  }
  return false;
}

async function main() {
  const paramsBefore = readParams();
  const page = await connect(CDP_PORT);
  const settings = await page.evaluate("(async () => { const m = await import('/src/lib/ai.ts'); return await m.loadAiSettings(); })()");
  const provider = loopbackProvider(settings);
  if (!provider) {
    throw new Error("dev 库里没有 loopback provider（baseUrl=http://127.0.0.1:<port>/v1）。请先在设置里添加一条用于本地探针的 provider（本机既有：openai→http://127.0.0.1:9123/v1）。");
  }
  const portMatch = /:(\d+)\//.exec(provider.baseUrl);
  const providerPort = portMatch ? Number(portMatch[1]) : 9123;
  const originalActive = settings.activeProviderId;

  // 应用状态也进 JSON：同一台机器上打开的 tab 数会影响渲染基线，跨会话对比必须能看见。
  const appState = await page.evaluate("(function(){return { url: location.href, tabs: document.querySelectorAll('.tab-item').length, dirtyTabs: document.querySelectorAll('.tab-item.is-dirty, .tab-item[data-dirty=' + String.fromCharCode(34) + 'true' + String.fromCharCode(34) + ']').length }})()");
  const fake = await startFakeProvider(providerPort, FRAMES, FRAME_MS);
  const result = { label: LABEL, generatedAt: new Date().toISOString(), cdpPort: CDP_PORT, appState: appState, drainMs: DRAIN_MS, provider: { id: provider.id, baseUrl: provider.baseUrl, model: provider.model }, params: paramsBefore, fixture: { frames: FRAMES, frameMs: FRAME_MS, requestedChars: CHARS, dense: DENSE, actualChars: fake.state.chars, chunks: fake.state.chunks } };

  try {
    if (provider.id !== originalActive) {
      await page.evaluate("(async (id) => { const m = await import('/src/lib/ai.ts'); return await m.saveAiSettings({ activeProviderId: id }); })(" + JSON.stringify(provider.id) + ")");
    }
    // 冷 reload：确保页面重新 import 最新版 useThrottledMarkdown（改前/改后各跑一次时参数一定会重新读取）。
    await page.evaluate("location.reload()");
    await sleep(1500);
    const ready = await waitReady(page, 30000);
    if (!ready) throw new Error("应用 reload 后未就绪（.app-shell/#root 未出现）");

    // 同一页面内重复跑 N 次（每次 runProbe 自己挂/卸 React root）——流式计时对 CPU 抖动敏感，取中位数更稳。
    const runs = [];
    for (let i = 0; i < REPEAT; i += 1) {
      const probeResult = await page.evaluate("(async () => { const m = await import('/scripts/ai-stream-probe-harness.mjs'); return await m.runProbe({ timeoutMs: " + TIMEOUT_MS + ", drainMs: " + DRAIN_MS + " }); })()");
      runs.push(probeResult);
    }
    result.runs = runs;
    result.probe = runs[0];
    result.repeat = REPEAT;
    result.fakeProvider = { requests: fake.state.requests, framesSent: fake.state.framesSent, bytesSent: fake.state.bytesSent, startedAt: fake.state.startedAt, finishedAt: fake.state.finishedAt, wallMs: fake.state.finishedAt && fake.state.startedAt ? fake.state.finishedAt - fake.state.startedAt : null };
  } finally {
    // 恢复 activeProvider：无论成败都恢复（不动 baseUrl / Key）。
    try {
      await page.evaluate("(async (id) => { const m = await import('/src/lib/ai.ts'); return await m.saveAiSettings({ activeProviderId: id }); })(" + JSON.stringify(originalActive) + ")");
    } catch (error) {
      result.restoreError = String(error && error.message ? error.message : error);
    }
    await new Promise(function (r) { fake.server.close(r); });
    page.ws.close();
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, LABEL + ".json");
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  result.outFile = file;
  console.log(JSON.stringify(result, null, 2));
}

main().catch(function (error) {
  console.error("[ai-stream-probe] 失败:", error && error.stack ? error.stack : error);
  process.exit(1);
});