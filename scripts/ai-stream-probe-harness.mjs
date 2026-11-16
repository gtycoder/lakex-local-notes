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
import { native } from "/src/lib/native.ts";
import { buildDenseMarkdown, buildMarkdown } from "/scripts/ai-stream-probe-content.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const raf = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** resolve 之后等一小段，收「被渲染阻塞而排队」的 IPC 事件（不属于流式窗口，只用于事件级计数/最终帧）。 */
const DRAIN_MS = 150;

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

  // 控制器：与生产一致 — 每个 delta 就 setState，节流由组件内的 hook 决定是否真渲染。
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
  let maxStreamRenderedLen = 0;
  const recordIfChanged = function () {
    const textContent = host.textContent || "";
    const len = textContent.length;
    if (len !== lastLen) {
      lastLen = len;
      visible.push(performance.now());
      if (len > maxStreamRenderedLen) maxStreamRenderedLen = len;
    }
  };
  const observer = new MutationObserver(function () {
    if (pendingFrame) return;
    pendingFrame = true;
    raf().then(function () { pendingFrame = false; recordIfChanged(); });
  });
  observer.observe(host, { subtree: true, childList: true, characterData: true });

  // 主线程长任务（流式期间渲染阻塞的直接证据；不支持的环境跳过）。
  const longTasks = { count: 0, maxMs: 0, totalMs: 0 };
  let longTaskObserver = null;
  try {
    if (typeof PerformanceObserver === "function" && Array.isArray(PerformanceObserver.supportedEntryTypes) && PerformanceObserver.supportedEntryTypes.indexOf("longtask") >= 0) {
      longTaskObserver = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          longTasks.count += 1;
          longTasks.totalMs += entry.duration;
          if (entry.duration > longTasks.maxMs) longTasks.maxMs = entry.duration;
        });
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });
    }
  } catch { /* 环境不支持长任务观察：指标留空 */ }

  root.render(React.createElement(Controller));
  await raf();
  await sleep(60);

  const requestId = newAiRequestId();
  const t0 = performance.now();
  let acc = "";
  let deltaCallbackCount = 0;
  /** 事件级 delta（独立订阅 IPC，不依赖 runAiChat 内部订阅的生命周期）。 */
  const deltaEvents = [];
  const offStreamEvents = native.onAiStream(function (chunk) {
    if (chunk.requestId !== requestId) return;
    if (chunk.reasoning) return;
    deltaEvents.push(performance.now());
  });
  let result = null;
  let error = null;
  try {
    result = await runAiChat(requestId, [{ role: "user", content: "probe: 输出一段长回答（本地假供应商）" }], function (delta) {
      deltaCallbackCount += 1;
      acc += delta;
      api.set(acc);
    });
  } catch (failure) {
    error = String((failure && failure.message) || failure);
  }
  const resolvedAt = performance.now();
  // 先量「结束当帧」：生产路径（runAiChat resolve 后换完整正文）就是这一刻，不能被下面的 drain 拖后。
  const fullText = result && typeof result.text === "string" && result.text.length > acc.length ? result.text : acc;
  api.set(fullText);
  api.finish();
  await raf();
  await raf();
  await sleep(100);
  recordIfChanged();
  const finalAt = performance.now();
  const renderedLen = (host.textContent || "").length;

  // 再 drain：主线程被渲染阻塞时，resolve 之后仍有排队的 IPC delta（生产上不会再生效，只用于暴露口径）。
  const drainStartedAt = performance.now();
  const drainDeadline = drainStartedAt + (opts.drainMs || DRAIN_MS);
  while (performance.now() < drainDeadline) { await sleep(16); }
  offStreamEvents();
  const drainMs = performance.now() - drainStartedAt;
  // 流式窗口 = resolve 时刻（迟到事件不计入可见节奏，单独计数）。
  const streamEndAt = resolvedAt;
  let deltaEventsAfterResolve = 0;
  for (const at of deltaEvents) if (at > resolvedAt) deltaEventsAfterResolve += 1;
  const windowDeltaEvents = deltaEvents.filter(function (at) { return at <= resolvedAt; });

  observer.disconnect();
  if (longTaskObserver) { try { longTaskObserver.disconnect(); } catch { /* noop */ } }
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
  const finalFlushRawMs = finalVisibleAt === null ? null : finalVisibleAt - streamEndAt;
  const finalFlushMs = finalFlushRawMs === null ? null : Math.max(0, Math.round(finalFlushRawMs));
  const streamMs = Math.round(streamEndAt - t0);
  const deltaSpan = windowDeltaEvents.length ? windowDeltaEvents[windowDeltaEvents.length - 1] - windowDeltaEvents[0] : 0;

  return {
    ok: !error && Boolean(result && result.ok),
    error: error,
    streamChars: fullText.length,
    renderedLen: renderedLen,
    maxStreamRenderedLen: maxStreamRenderedLen,
    // 长度代理：最终 DOM 文本不短于流式期间最长可见文本 ⇒ 没有残留截断（markdown 标记会被渲染器去掉，不能直接比 fullText）。
    finalComplete: renderedLen > 0 && renderedLen >= maxStreamRenderedLen,
    deltas: deltaCallbackCount,
    deltaEvents: deltaEvents.length,
    deltaEventsAfterResolve: deltaEventsAfterResolve,
    drainMs: Math.round(drainMs),
    deltaSpanMs: Math.round(deltaSpan),
    deltaRatePerSec: deltaSpan > 0 ? Math.round((windowDeltaEvents.length - 1) / deltaSpan * 1000 * 10) / 10 : null,
    visibleUpdates: streamVisible.length,
    visibleFps: firstVisibleAt !== null && lastVisibleAt !== null ? Math.round((streamVisible.length - 1) / span * 1000 * 10) / 10 : null,
    firstVisibleMs: firstVisibleAt === null ? null : Math.round(firstVisibleAt),
    lastVisibleMs: lastVisibleAt === null ? null : Math.round(lastVisibleAt),
    maxGapMs: gaps.length ? Math.round(gaps[gaps.length - 1]) : null,
    p50GapMs: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null,
    streamMs: streamMs,
    // 允许为负（DOM 帧可能早于 resolve 的计时采样）——保留 raw，便于识别口径问题。
    finalFlushMs: finalFlushMs,
    finalFlushRawMs: finalFlushRawMs === null ? null : Math.round(finalFlushRawMs),
    finalRenderTotalMs: Math.round(finalAt - t0),
    longTasks: { count: longTasks.count, maxMs: Math.round(longTasks.maxMs), totalMs: Math.round(longTasks.totalMs) },
  };
}
export default { calibrate: calibrate, runProbe: runProbe };