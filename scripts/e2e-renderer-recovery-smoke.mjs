#!/usr/bin/env node
/** Packaged renderer-crash -> draft-journal recovery smoke (macOS/Electron). */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const appPath = process.env.LAKE_PACKAGED_EXECUTABLE || path.resolve("release/mac-arm64/LocalLakexNotes.app/Contents/MacOS/LocalLakexNotes");
const port = Number(process.env.LAKE_CDP_PORT || 9338);
if (!existsSync(appPath)) throw new Error(`找不到 packaged executable: ${appPath}`);
const dataDir = mkdtempSync(path.join(os.tmpdir(), "lake-renderer-recovery-smoke-"));
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29880));
let child;
let socket;
let id = 0;
let pending;

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}
async function waitTarget() {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets()).find((item) => item.type === "page");
      if (target) return target;
    } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`renderer recovery smoke CDP 在 ${port} 未就绪`);
}
async function connect() {
  const target = await waitTarget();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  id = 0;
  return socket;
}
function send(method, params = {}) {
  return new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.result?.value;
}
async function waitFor(expression, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch { /* renderer is restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      await connect();
      await send("Runtime.enable");
      await send("Page.enable");
    }
  }
  throw new Error(`等待 renderer recovery 超时: ${expression}`);
}
async function quitApp() {
  try {
    const s = await connect();
    await send("Runtime.enable");
    await evaluate('window.lakeNative?.bootstrap().then(()=>true)');
    await evaluate('window.close()');
    s.close();
  } catch { /* app may already be gone */ }
  try { child?.kill("SIGTERM"); } catch { /* best effort */ }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 清理容错：SIGTERM 后应用可能仍在写目录，rmSync 重试若干次再放弃（ENOTEMPTY 竞态）。 */
async function rmSyncRetry(dir, attempts = 20, delayMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (i === attempts - 1) throw error;
      await sleep(delayMs);
    }
  }
}

let noteId;
try {
  child = spawn(appPath, [`--remote-debugging-port=${port}`, "--disable-gpu"], {
    env: { ...process.env, LAKE_USER_DATA: dataDir, LAKE_ASSET_PORT: assetPort },
    stdio: "ignore",
  });
  await connect();
  await send("Runtime.enable");
  await send("Page.enable");
  await waitFor('document.readyState === "complete" && Boolean(window.lakeNative)');
  noteId = await evaluate(`window.lakeNative.createNote(${JSON.stringify("__renderer-recovery-smoke__")}).then(note=>note.id)`);
  await evaluate(`window.lakeNative.saveDraftJournal({ noteId: ${JSON.stringify(noteId)}, title: "__renderer-recovery-smoke__", content: "<p>crash draft</p>", updatedAt: new Date().toISOString() })`);
  // Chromium reports the intentional crash as a Target crashed protocol error;
  // that error is the expected signal, not a test failure.
  await send("Page.crash");
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  await connect();
  await send("Runtime.enable");
  await send("Page.enable");
  const recovered = await waitFor('Boolean(document.querySelector(".draft-recovery-dialog"))');
  const result = await evaluate(`JSON.stringify({ recovered: ${Boolean(recovered)}, dialog: document.querySelector(".draft-recovery-dialog")?.innerText || "", renderers: document.querySelectorAll("#root > *").length })`);
  console.log(result);
  if (!JSON.parse(result).recovered) throw new Error("renderer 崩溃后未出现草稿恢复对话框");
} finally {
  try {
    if (noteId) {
      await connect();
      await send("Runtime.enable");
      await evaluate(`(async()=>{ try { await window.lakeNative.deleteDraftJournal(${JSON.stringify(noteId)}); } catch {} try { await window.lakeNative.deleteNote(${JSON.stringify(noteId)}); } catch {} return true; })()`);
    }
  } catch { /* cleanup is best effort */ }
  await quitApp();
  await rmSyncRetry(dataDir);
}
