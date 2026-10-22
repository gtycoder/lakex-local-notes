#!/usr/bin/env node
/** Opt-in packaged Sidebar regression; real pointer events, fresh synthetic data only. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Cdp, wait, waitFor } from "./cdp.mjs";
const app = path.resolve(
  process.env.LAKE_PERF_APP ||
    "release/mac-arm64/LocalLakexNotes.app/Contents/MacOS/LocalLakexNotes",
);
if (!fs.existsSync(app) || !app.includes(".app/Contents/MacOS/"))
  throw Error("real .app required");
const evidence = path.resolve(
  process.env.LAKE_PERF_EVIDENCE || ".css-audit/sidebar-regression",
);
fs.mkdirSync(evidence, { recursive: true });
const data = `/tmp/lake-sidebar-regression-${Date.now()}`;
const env = { ...process.env, LAKE_USER_DATA: data, LAKE_ASSET_PORT: "19881" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  app,
  ["--remote-debugging-port=9281", "--inspect=127.0.0.1:9282"],
  { env, stdio: "ignore" },
);
const results = [];
let page, main;
const row = (id) => `document.querySelector('[data-tree-node-id="${id}"]')`;
async function pointer(type, point, button = "left", buttons) {
  await page.send("Input.dispatchMouseEvent", {
    type,
    ...point,
    button,
    buttons: buttons ?? (type === "mousePressed" ? 1 : 0),
    clickCount: type === "mouseMoved" ? 0 : 1,
  });
}
async function point(expr, fraction = 0.5) {
  return await page.evaluate(
    `(()=>{const e=(${expr});if(!e)throw Error('missing UI target');const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('invisible UI target');return {x:r.x+Math.min(60,r.width/2),y:r.y+r.height*${fraction}}})()`,
  );
}
async function click(expr) {
  // Row actions are intentionally hidden until hover: expose them with a real pointer, not CSS injection.
  const parent = await page.evaluate(
    `(()=>{const e=(${expr});const row=e?.closest('.tree-row');if(!row)return null;const r=row.getBoundingClientRect();return {x:r.x+Math.min(60,r.width/2),y:r.y+r.height/2}})()`,
  );
  if (parent) {
    await pointer("mouseMoved", parent);
    await wait(100);
  }
  const p = await point(expr);
  await pointer("mouseMoved", p);
  await pointer("mousePressed", p);
  await pointer("mouseReleased", p);
  await wait(200);
}
const byText = (selector, label) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
async function input(selector, value) {
  await page.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
  );
  await wait(100);
}
async function refresh() {
  await click(
    `document.querySelector('.sidebar button[aria-label="刷新目录"]')`,
  );
}
async function context(id, text) {
  await click(`${row(id)}.querySelector('[aria-label="更多操作"]')`);
  await click(byText(".context-menu button", text));
}
async function shot(name) {
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(evidence, name + ".png"),
    Buffer.from(r.data, "base64"),
  );
}
async function check(label, body) {
  await body();
  results.push({ label, ok: true });
  console.log("PASS", label);
}
async function key(key, code, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"])
    await page.send("Input.dispatchKeyEvent", { type, key, code, modifiers });
  await wait(200);
}
try {
  page = await Cdp.connect(9281, (t) => t.type === "page");
  main = await Cdp.connect(9282);
  await page.send("Page.enable");
  await page.send("Page.bringToFront");
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await waitFor(page, "!!window.lakeNative && !!window.__desktopEditor");
  const runtime = await main.evaluate(
    `(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const w=e.BrowserWindow.getAllWindows()[0];w.show();w.focus();return {packaged:e.app.isPackaged,gpu:e.app.isHardwareAccelerationEnabled(),sandbox:w.webContents.getLastWebPreferences().sandbox}})()`,
  );
  assert.ok(runtime.packaged && runtime.gpu && runtime.sandbox);
  const seed = await page.evaluate(
    `(async()=>{const api=window.lakeNative;const book=await api.createNotebook('回归笔记本');const g=await api.createGroup(book.id,'分组A');const h=await api.createGroup(book.id,'分组B');const a=await api.createNoteIn(g.id,'回归A');const b=await api.createNoteIn(g.id,'回归B');const c=await api.createNoteIn(h.id,'回归C');const child=await api.createNoteIn(a.id,'文档子项');return {book:book.id,g:g.id,h:h.id,a:a.id,b:b.id,c:c.id,child:child.id}})()`,
  );
  await refresh();
  await waitFor(page, `!!(${row(seed.a)})`);
  await check("open-note-keeps-children-collapsed", async () => {
    await click(row(seed.a));
    await waitFor(
      page,
      `!!document.querySelector('.lake-editor-tab[data-note-id="${seed.a}"][data-active="true"]')`,
    );
    assert.equal(await page.evaluate(`!!(${row(seed.child)})`), false);
  });
  await check("cross-group-highlight-and-reveal", async () => {
    await click(row(seed.c));
    await click(`${row(seed.g)}.querySelector('.tree-chevron')`);
    assert.equal(await page.evaluate(`!!(${row(seed.a)})`), false);
    await click(
      `document.querySelector('.tab-item[data-note-id="${seed.a}"]')`,
    );
    await waitFor(page, `!!(${row(seed.a)})`);
    assert.deepEqual(
      await page.evaluate(
        `[...document.querySelectorAll('.sidebar .tree-row.active')].map(e=>e.dataset.treeNodeId)`,
      ),
      [seed.a],
    );
  });
  await check("rename-through-dialog", async () => {
    await context(seed.a, "重命名");
    await input(".rename-dialog input", "回归A改名");
    await click(byText(".rename-dialog button", "确定"));
    await waitFor(page, `${row(seed.a)}?.textContent.includes('回归A改名')`);
  });
  await check("lock-and-unlock-through-context-menu", async () => {
    await context(seed.a, "锁定（只读）");
    await waitFor(
      page,
      `!!(${row(seed.a)}.querySelector('[aria-label="已锁定"]'))`,
    );
    await context(seed.a, "解锁");
    await waitFor(
      page,
      `!(${row(seed.a)}.querySelector('[aria-label="已锁定"]'))`,
    );
  });
  await check("filter-and-clear", async () => {
    await click(
      `document.querySelector('.sidebar button[aria-label="筛选目录"]')`,
    );
    await input(".sidebar .dock-filter-input", "回归B");
    await waitFor(page, `!!(${row(seed.b)}) && !(${row(seed.c)})`);
    await input(".sidebar .dock-filter-input", "");
    await waitFor(page, `!!(${row(seed.c)})`);
  });
  let created;
  await check("row-create-child", async () => {
    const before = await page.evaluate(
      "window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(x=>x.map(n=>n.id))",
    );
    await click(`${row(seed.g)}.querySelector('[aria-label="新建子项"]')`);
    await click(byText(".context-menu button", "新建文档"));
    created = await page.evaluate(
      `window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(x=>x.find(n=>!${JSON.stringify(before)}.includes(n.id))?.id)`,
    );
    assert.ok(created);
    await waitFor(page, `!!(${row(created)})`);
    const n = await page.evaluate(`window.lakeNative.readNote('${created}')`);
    assert.equal(n.parentId, seed.g);
    // New documents intentionally open the title dialog; finish that user flow before dragging.
    if (await page.evaluate("!!document.querySelector('.rename-dialog')"))
      await click(byText(".rename-dialog button", "取消"));
    await waitFor(page, "!document.querySelector('.ln-scrim')");
  });
  await check("cross-level-drag-and-release", async () => {
    const from = await point(row(seed.b));
    const to = await point(row(seed.h));
    await pointer("mouseMoved", from);
    await pointer("mousePressed", from);
    await wait(150);
    await pointer("mouseMoved", { x: from.x + 12, y: from.y + 8 }, "left", 1);
    await wait(120);
    await pointer("mouseMoved", to, "left", 1);
    await wait(180);
    assert.ok(
      await page.evaluate(
        `${row(seed.h)}.classList.contains('drop-parent') || ${row(seed.h)}.classList.contains('drop-inside')`,
      ),
    );
    await pointer("mouseReleased", to);
    await waitFor(
      page,
      `window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(x=>x.find(n=>n.id==='${seed.b}')?.parentId==='${seed.h}')`,
    );
    await wait(400);
    assert.equal(
      await page.evaluate(
        "document.querySelectorAll('.tree-row.releasing,.tree-row.dragging,.tree-drag-ghost').length",
      ),
      0,
    );
  });
  await check("same-level-drag-reorder", async () => {
    const from = await point(row(seed.b));
    const to = await point(row(seed.c), 0.1);
    await pointer("mouseMoved", from);
    await pointer("mousePressed", from);
    await pointer("mouseMoved", { x: from.x + 12, y: from.y }, "left", 1);
    await wait(120);
    await pointer("mouseMoved", to, "left", 1);
    await wait(160);
    await pointer("mouseReleased", to);
    await waitFor(
      page,
      `window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(x=>x.find(n=>n.id==='${seed.b}').sortOrder<x.find(n=>n.id==='${seed.c}').sortOrder)`,
    );
    await wait(400);
  });
  await check("delete-confirm-and-restore-refresh", async () => {
    await context(created, "删除");
    await click(byText(".confirm-dialog button", "删除"));
    await waitFor(page, `!(${row(created)})`);
    const trash = await page.evaluate("window.lakeNative.listTrash()");
    assert.ok(trash.some((n) => n.id === created || n.noteId === created));
    await page.evaluate(`window.lakeNative.restoreTrash('${created}')`);
    await refresh();
    await waitFor(page, `!!(${row(created)})`);
  });
  await check("new-group-refresh", async () => {
    const g = await page.evaluate(
      `window.lakeNative.createGroup('${seed.book}','刷新新增组')`,
    );
    await refresh();
    await waitFor(page, `!!(${row(g.id)})`);
  });
  await check("floating-sidebar", async () => {
    await key("]", "BracketRight", 4);
    await waitFor(
      page,
      "document.querySelector('.sidebar').classList.contains('sidebar-collapsed')",
    );
    await pointer("mouseMoved", { x: 2, y: 170 });
    await wait(450);
    await pointer("mouseMoved", { x: 100, y: 170 });
    await waitFor(
      page,
      "document.querySelector('.sidebar').classList.contains('sidebar-floating')",
    );
    const geom = await page.evaluate(
      "document.querySelector('.sidebar').getBoundingClientRect().toJSON()",
    );
    assert.equal(geom.top, 38);
    await shot("floating");
    await key("]", "BracketRight", 4);
  });
  for (const theme of ["light", "dark", "warm"])
    for (const width of [1280, 680]) {
      await check(`${theme}-${width}-sidebar`, async () => {
        await page.evaluate(
          `(()=>{const k='local-lakex-notes-v1.settings';const s=JSON.parse(localStorage.getItem(k)||'{}');s.theme=${JSON.stringify(theme)};localStorage.setItem(k,JSON.stringify(s));localStorage.setItem('local-lakex-notes-v2.sidebar-mode','docked');return true})()`,
        );
        await main.evaluate(
          `(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');e.BrowserWindow.getAllWindows()[0].setSize(${width},820);return true})()`,
        );
        await page.send("Page.reload");
        // A reload briefly retains the old document's global; wait for navigation before its ready check.
        await wait(750);
        await waitFor(
          page,
          "document.readyState === 'complete' && !!window.__desktopEditor",
        );
        await page.send("Page.bringToFront");
        await wait(250);
        const state = await page.evaluate(
          `(()=>{const e=document.querySelector('.sidebar'),r=e.getBoundingClientRect();return {theme:document.documentElement.dataset.theme,mode:e.className,top:r.top,right:r.right,width:innerWidth,bodyScroll:document.documentElement.scrollWidth,active:document.querySelector('.sidebar .tree-row.active')?.dataset.treeNodeId}})()`,
        );
        assert.equal(state.theme, theme);
        assert.equal(state.top, 38);
        assert.ok(state.right <= state.width);
        assert.equal(state.bodyScroll, state.width);
        if (width === 680) assert.match(state.mode, /floating/);
        await shot(`${theme}-${width}`);
      });
    }
  fs.writeFileSync(
    path.join(evidence, "sidebar-regression.json"),
    JSON.stringify({ runtime, seed, results, data }, null, 2),
  );
} catch (error) {
  fs.writeFileSync(
    path.join(evidence, "sidebar-regression.json"),
    JSON.stringify(
      { results, error: String(error), stack: error.stack, data },
      null,
      2,
    ),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    page?.close();
    main?.close();
  } catch {
    /* disconnected process */
  }
  child.kill("SIGTERM");
  await Promise.race([new Promise((r) => child.once("exit", r)), wait(6000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await wait(300);
  }
  fs.rmSync(data, { recursive: true, force: true });
}
