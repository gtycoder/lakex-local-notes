/**
 * 端到端 AI 流式计时探针 —— 运行在 app 页面内的 harness（由 scripts/ai-stream-probe.mjs 通过 Vite dev 注入）。
 *
 * 放在这里的原因：dev server 会用 Vite 转换本文件，裸导入（react / react-dom）与 /src/... 应用模块
 * 都能直接 import ⇒ 用的是**应用同一份** MarkdownView / useThrottledMarkdown / runAiChat（含主进程
 * IPC 流式回调），而不是另写一份渲染器。假供应商与 CDP 驱动在 scripts/ai-stream-probe.mjs。
 *
 * 只负责「在页面里跑一次流 + 量 DOM 更新」；不做持久化；结束后移除 overlay、卸载 React root。
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { MarkdownView } from "/src/components/ui/markdown/MarkdownView.tsx";
import { AiMessageBody, AiStreamingMessageBody } from "/src/features/ai/AiMessageBody.tsx";
import { runAiChat, newAiRequestId } from "/src/lib/ai.ts";
import { buildDenseMarkdown, buildMarkdown } from "/scripts/ai-stream-probe-content.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const raf = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * 同步量一次「用给定 Markdown 提交一次 MarkdownView」的耗时（不含 paint，与 hook 的 cost 同口径）。
 * 用途：给探针挑「贵到能触发节流上限」的内容规模，不作为结论数字。
 */
export async function calibrate(sizes, mode) {
  const list = sizes || [40000, 160000, 320000, 640000];
  const builder = mode === "dense" ? buildDenseMarkdown : buildMarkdown;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-9999px;top:0;width:860px;background:#fff";
  document.body.appendChild(host);
  const root = createRoot(host);
  const out = [];
  for (const size of list) {
    const markdown = builder(size);
    const t0 = performance.now();
    root.render(React.createElement(MarkdownView, { source: markdown }));
    await raf();
    await raf();
    const first = performance.now() - t0;
    const bigger = markdown + "\n- 追加一条\n";
    const t1 = performance.now();
    root.render(React.createElement(MarkdownView, { source: bigger }));
    await raf();
    await raf();
    const update = performance.now() - t1;
    out.push({ chars: markdown.length, firstRenderMs: Math.round(first * 10) / 10, updateRenderMs: Math.round(update * 10) / 10 });
  }
  root.unmount();
  host.remove();
  return out;
}

/**
 * 跑一次完整流：主进程 AI 网关 → IPC onAiStream → 累加文本 → AiStreamingMessageBody（真实 useThrottledMarkdown）
 * → MarkdownView。量「可见更新」（DOM 文本真的变了的帧）。
 *
 * 口径：流式窗口 = [t0, runAiChat resolve]；结束后的最终整段渲染单独记为 finalFlushMs（生产是
 * streaming=false 后换 AiMessageBody 当帧全量渲染）。
 */
export async function runProbe(options) {
  const opts = options || {};
  const host = document.createElement("div");
  host.id = "ai-stream-probe-host";
  host.style.cssText = "position:fixed;left:0;top:0;width:860px;height:100vh;z-index:2147483000;background:#fff;color:#111;overflow:auto;padding:24px;box-sizing:border-box";
  document.body.appendChild(host);
  const root = createRoot(host);

  // 控制器：与生产一致 —— 每个 delta 就 setState，节流由组件内的 hook 决定是否真渲染。
  const api = { set: function () {}, finish: function () {} };
  function Controller() {
    const state = React.useState("");
    const text = state[0];
    const setText = state[1];
    const streamingState = React.useState(true);
    const streaming = streamingState[0];
    const setStreaming = streamingState[1];
    api.set = setText;
    api.finish = function () { setStreaming(false); };
    return React.createElement(streaming ? AiStreamingMessageBody : AiMessageBody, { text: text });
  }

  const visible = [];      // 可见更新时刻（performance.now）
  let pendingFrame = false;
  let lastLen = 0;
  const recordIfChanged = function () {
    const len = (host.textContent || "").length;
    if (len !== lastLen) {
      lastLen = len;
      visible.push(performance.now());
    }
  };
  const observer = new MutationObserver(function () {
    if (pendingFrame) return;
    pendingFrame = true;
    raf().then(function () { pendingFrame = false; recordIfChanged(); });
  });
  observer.observe(host, { subtree: true, childList: true, characterData: true });

  root.render(React.createElement(Controller));
  await raf();
  await sleep(60);

  const deltas = [];
  let acc = "";
  const t0 = performance.now();
  const requestId = newAiRequestId();
  let result = null;
  let error = null;
  try {
    result = await runAiChat(requestId, [{ role: "user", content: "probe: 输出一段长回答（本地假供应商）" }], function (delta) {
      acc += delta;
      deltas.push(performance.now());
      api.set(acc);
    });
  } catch (failure) {
    error = String((failure && failure.message) || failure);
  }
  const streamEndAt = performance.now();
  const fullText = result && typeof result.text === "string" && result.text.length > acc.length ? result.text : acc;
  api.set(fullText);
  api.finish();
  await raf();
  await raf();
  await sleep(100);
  recordIfChanged();
  const finalAt = performance.now();
  const renderedLen = (host.textContent || "").length;

  observer.disconnect();
  root.unmount();
  host.remove();

  const streamVisible = visible.filter(function (t) { return t <= streamEndAt; });
  const finalVisibleAt = visible.length ? visible[visible.length - 1] : null;
  const gaps = [];
  for (let i = 1; i < streamVisible.length; i += 1) gaps.push(streamVisible[i] - streamVisible[i - 1]);
  gaps.sort(function (a, b) { return a - b; });
  const firstVisibleAt = streamVisible.length ? streamVisible[0] - t0 : null;
  const lastVisibleAt = streamVisible.length ? streamVisible[streamVisible.length - 1] - t0 : null;
  const span = firstVisibleAt !== null && lastVisibleAt !== null ? Math.max(1, lastVisibleAt - firstVisibleAt) : 1;
  const finalFlushMs = finalVisibleAt !== null ? Math.round(finalVisibleAt - streamEndAt) : null;
  const streamMs = Math.round(streamEndAt - t0);
  const deltaSpan = deltas.length ? deltas[deltas.length - 1] - deltas[0] : 0;

  return {
    ok: !error && Boolean(result && result.ok),
    error: error,
    streamChars: fullText.length,
    renderedLen: renderedLen,
    finalComplete: renderedLen >= Math.min(fullText.length, 1) && renderedLen > 0,
    deltas: deltas.length,
    deltaSpanMs: Math.round(deltaSpan),
    deltaRatePerSec: deltaSpan > 0 ? Math.round((deltas.length - 1) / deltaSpan * 1000 * 10) / 10 : null,
    visibleUpdates: streamVisible.length,
    visibleFps: firstVisibleAt !== null && lastVisibleAt !== null ? Math.round((streamVisible.length - 1) / span * 1000 * 10) / 10 : null,
    firstVisibleMs: firstVisibleAt === null ? null : Math.round(firstVisibleAt),
    lastVisibleMs: lastVisibleAt === null ? null : Math.round(lastVisibleAt),
    maxGapMs: gaps.length ? Math.round(gaps[gaps.length - 1]) : null,
    p50GapMs: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null,
    streamMs: streamMs,
    finalFlushMs: finalFlushMs,
    finalRenderTotalMs: Math.round(finalAt - t0),
  };
}

export default { calibrate: calibrate, runProbe: runProbe };