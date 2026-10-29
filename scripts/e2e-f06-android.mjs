#!/usr/bin/env node
/**
 * F06 安卓真实端验收（模拟器 + debug APK）。用 MobileApp 暴露的 window.lakeNative 调试契约驱动 bridge。
 * 前提：模拟器已启动（scripts/emu-up.sh）、APK 已构建（scripts/android-build.sh --sync）。
 * 覆盖：回收站晚到保存被拒且正文不改写；purge 后晚到保存被拒且不复活；显式恢复后可写。
 * 用法：node scripts/e2e-f06-android.mjs
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const ANDROID_SDK = "/opt/homebrew/share/android-commandlinetools";
const ADB = path.join(ANDROID_SDK, "platform-tools", "adb");
const PKG = "com.lakexlocalnotes.android";
const port = Number(process.env.LAKE_CDP_PORT || 9337);
const apk = path.resolve("android/app/build/outputs/apk/debug/app-debug.apk");
const NL = String.fromCharCode(10);
const sh = (args) => execFileSync(ADB, args, { encoding: "utf8" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (detail ? "  [" + detail + "]" : ""));
}

let socket = null;
let seq = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res) => { const id = ++seq; pending.set(id, res); socket.send(JSON.stringify({ id, method, params: params || {} })); });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const ex = r.result.exceptionDetails;
    throw new Error("evaluate failed: " + ((ex.exception && ex.exception.description) || ex.text));
  }
  return r.result ? r.result.result.value : undefined;
}
async function waitFor(expr, timeout) {
  const deadline = Date.now() + (timeout || 30000);
  while (Date.now() < deadline) { try { if (await evaluate(expr)) return true; } catch (e) { /* not ready */ } await wait(500); }
  return false;
}

try {
  if (!fs.existsSync(apk)) throw new Error("缺 APK：" + apk + "（先跑 scripts/android-build.sh --sync）");
  const devices = sh(["devices"]).split(NL).filter((l) => /emulator-\d+\s+device/.test(l));
  if (devices.length === 0) throw new Error("没有在跑的模拟器（先跑 scripts/emu-up.sh --no-window）");
  console.log("device:", devices[0].trim());

  console.log("==> adb install -r");
  sh(["install", "-r", apk]);
  sh(["shell", "am", "force-stop", PKG]);
  sh(["shell", "am", "start", "-n", PKG + "/.MainActivity"]);

  console.log("==> 等待 WebView devtools socket");
  let sock = "";
  const sockDeadline = Date.now() + 60000;
  while (Date.now() < sockDeadline) {
    const out = sh(["shell", "cat", "/proc/net/unix"]);
    const m = out.match(/webview_devtools_remote_\d+/);
    if (m) { sock = m[0]; break; }
    await wait(1000);
  }
  if (!sock) throw new Error("未发现 WebView devtools socket（App 未启动？）");
  sh(["forward", "tcp:" + port, "localabstract:" + sock]);
  console.log("==> forward " + sock + " -> tcp:" + port);

  const listDeadline = Date.now() + 30000;
  let page = null;
  while (Date.now() < listDeadline) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      page = list.find((x) => x.type === "page");
      if (page) break;
    } catch (e) { /* retry */ }
    await wait(500);
  }
  if (!page) throw new Error("CDP 未列出 page target");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  socket.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await send("Runtime.enable");

  // 等 bridge.init + 调试契约挂载（window.lakeNative 在 MobileApp useEffect 里设置）
  const ready = await waitFor("Boolean(window.lakeNative) && typeof window.lakeNative.saveNote === 'function'", 60000);
  check("App 启动 + window.lakeNative 调试契约", ready);
  const pkgInfo = await evaluate("JSON.stringify({ title: document.title, href: location.href })");
  console.log("  page:", pkgInfo);

  const expr = [
    "(async function(){",
    "  var api = window.lakeNative;",
    "  var out = {};",
    "  var a = await api.createNote('F06-a', null);",
    "  await api.saveNote(a.id, a.title, '<p>v1</p>', null);",
    "  var info1 = await api.getNoteInfo(a.id);",
    "  out.v1size = info1.sizeBytes;",
    "  await api.trashNote(a.id);",
    "  out.rejectTrash = false;",
    "  try { await api.saveNote(a.id, a.title, '<p>late-save-marker-1234567890</p>', null); } catch(e){ out.rejectTrash = true; out.trashErr = String((e && e.message) || e); }",
    "  var info2 = await api.getNoteInfo(a.id);",
    "  out.contentUnchanged = info2.sizeBytes === info1.sizeBytes;",
    "  out.stillTrashed = (await api.listTrashed()).some(function(n){ return n.id === a.id; });",
    "  await api.restoreNote(a.id);",
    "  out.restoreSave = false;",
    "  try { await api.saveNote(a.id, a.title, '<p>after-restore</p>', null); out.restoreSave = true; } catch(e){ out.restoreSaveErr = String((e && e.message) || e); }",
    "  var info3 = await api.getNoteInfo(a.id);",
    "  out.afterSize = info3.sizeBytes;",
    "  var b = await api.createNote('F06-b', null);",
    "  await api.saveNote(b.id, b.title, '<p>b1</p>', null);",
    "  await api.trashNote(b.id);",
    "  await api.purgeTreeItem(b.id, 'note');",
    "  out.rejectPurge = false;",
    "  try { await api.saveNote(b.id, b.title, '<p>b-late</p>', null); } catch(e){ out.rejectPurge = true; out.purgeErr = String((e && e.message) || e); }",
    "  out.bGone = !(await api.getHomeSnapshot().then(function(s){return s.notes;})).some(function(n){ return n.id === b.id; }) && !(await api.listTrashed()).some(function(n){ return n.id === b.id; });",
    "  return JSON.stringify(out);",
    "})()",
  ].join(NL);
  const f06 = JSON.parse(await evaluate(expr));
  check("F06 回收站晚到保存被拒绝", f06.rejectTrash, f06.trashErr);
  check("F06 拒绝后正文未被改写（sizeBytes 不变）", f06.contentUnchanged, "v1=" + f06.v1size);
  check("F06 回收站条目仍在回收站", f06.stillTrashed);
  check("F06 显式恢复后可继续保存", f06.restoreSave, f06.restoreSaveErr || ("after=" + f06.afterSize));
  check("F06 purge 后晚到保存被拒绝且不复活", f06.rejectPurge && f06.bGone, f06.purgeErr);

  const failed = checks.filter((c) => !c.ok);
  console.log(NL + "RESULT " + JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error("e2e-f06-android error:", error && error.stack ? error.stack : error);
  process.exitCode = 2;
} finally {
  try { if (socket) socket.close(); } catch (e) { /* ignore */ }
}
