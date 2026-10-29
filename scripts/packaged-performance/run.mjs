#!/usr/bin/env node
/** Opt-in real packaged-app audit. Never accepts production data or remote credentials. */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { Cdp, wait, waitFor, stats } from "./cdp.mjs";
import { loopbackS3 } from "./loopback-s3.mjs";
const appPath = path.resolve(
  process.env.LAKE_PERF_APP ||
    "release/mac-arm64/LakexLocalNotes.app/Contents/MacOS/LakexLocalNotes",
);
const fixture = path.resolve(
  process.env.LAKE_PERF_FIXTURE || "/tmp/lake-packaged-perf-fixture-261013",
);
const evidence = path.resolve(
  process.env.LAKE_PERF_EVIDENCE || ".css-audit/packaged-perf-261013/evidence",
);
if (!fs.existsSync(appPath) || !appPath.includes(".app/Contents/MacOS/"))
  throw Error("a real .app executable is required");
if (
  !fs
    .realpathSync(fixture)
    .startsWith("/private/tmp/lake-packaged-perf-fixture-") &&
  !fs.realpathSync(fixture).startsWith("/tmp/lake-packaged-perf-fixture-")
)
  throw Error("only synthetic /tmp/lake-packaged-perf-fixture-* allowed");
const fixtureContract = JSON.parse(
  fs.readFileSync(path.join(fixture, "fixture.json"), "utf8"),
);
if (fixtureContract.documents !== 5000 || fixtureContract.assetFiles !== 20000)
  throw Error("expected synthetic fixture contract");
fs.mkdirSync(evidence, { recursive: true });
const port = Number(process.env.LAKE_PERF_CDP_PORT || 9271),
  inspectPort = port + 1,
  assetPort = Number(process.env.LAKE_PERF_ASSET_PORT || 19871),
  s3Port = Number(process.env.LAKE_PERF_S3_PORT || 19872);
for (const candidate of [port, inspectPort, assetPort, s3Port]) {
  if (!Number.isInteger(candidate) || candidate < 1024 || candidate > 65535)
    throw Error("invalid diagnostic port");
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${candidate}`, "-sTCP:LISTEN"], {
      stdio: "pipe",
    });
    throw Error(`port ${candidate} is in use`);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
}
const result = {
  date: new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
  appPath,
  fixture,
  protocol: "lakexlocalnotes://app",
  args: [
    `--remote-debugging-port=${port}`,
    `--inspect=127.0.0.1:${inspectPort}`,
  ],
  host: {
    os: execFileSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
    }).trim(),
    cpu: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
      encoding: "utf8",
    }).trim(),
    ramBytes: Number(
      execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf8" }),
    ),
  },
  startup: [],
  opens: [],
  inputs: [],
  scrolls: [],
  tabs: [],
  saves: [],
  errors: [],
};
let child,
  r,
  m,
  currentData,
  logHandle,
  appExited = false,
  remote;
const ownedData = [];
const finalEvidence = () => {
  if (currentData) {
    result.dataDir = currentData;
    result.cacheFiles = [];
    for (const dir of ["Code Cache", "GPUCache", "DawnGraphiteCache"]) {
      const p = path.join(currentData, dir);
      if (fs.existsSync(p)) {
        const files = fs
          .readdirSync(p, { recursive: true })
          .map((n) => path.join(p, n))
          .filter((n) => fs.statSync(n).isFile());
        result.cacheFiles.push({
          dir,
          files: files.length,
          bytes: files.reduce((sum, n) => sum + fs.statSync(n).size, 0),
        });
      }
    }
  }
};
const electron = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`;
const storeResult = () =>
  fs.writeFileSync(
    path.join(evidence, "results.json"),
    JSON.stringify(result, null, 2),
  );
const noteSelector = (id) => `.lake-editor-tab[data-note-id="${id}"]`;
const stop = async () => {
  try {
    r?.close();
    m?.close();
  } catch {}
  r = null;
  m = null;
  if (child && child.exitCode === null && !appExited) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((res) => child.once("exit", res)),
      wait(6000),
    ]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await wait(400);
    }
  }
  child = null;
  if (logHandle) {
    fs.closeSync(logHandle);
    logHandle = null;
  }
  await wait(300);
};
const focus = async () => {
  await m.evaluate(
    `(()=>{const {BrowserWindow}=${electron};const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();return true})()`,
  );
  await r.send("Page.bringToFront");
  await r.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const hidden = await r.evaluate("document.hidden");
  if (hidden) throw Error("window is hidden; foreground timing invalid");
};
async function launch(data, label) {
  currentData = data;
  appExited = false;
  logHandle = fs.openSync(path.join(evidence, label + ".log"), "w");
  const env = {
    ...process.env,
    LAKE_USER_DATA: data,
    LAKE_ASSET_PORT: String(assetPort),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LAKE_RENDERER;
  // No disable-gpu, no no-sandbox, no performance flags; inspector is diagnostics only.
  const t = performance.now();
  child = spawn(appPath, result.args, {
    cwd: path.dirname(path.dirname(path.dirname(path.dirname(appPath)))),
    env,
    stdio: ["ignore", logHandle, logHandle],
  });
  child.once("exit", () => (appExited = true));
  r = await Cdp.connect(port, (x) => x.type === "page");
  m = await Cdp.connect(inspectPort);
  await r.send("Runtime.enable");
  await r.send("Page.enable");
  // Foreground before using rAF as a readiness signal: hidden-window throttling is not startup cost.
  await focus();
  await waitFor(
    r,
    `location.protocol==='lake:' && !!window.lakeNative && !!document.querySelector('.ne-engine[contenteditable="true"]')`,
    60000,
  );
  await r.evaluate(
    `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
  );
  const readyMs = performance.now() - t;
  if (await r.evaluate("document.hidden"))
    throw Error("startup sample became hidden");
  const timing = await r.evaluate(
    `({navigation:performance.getEntriesByType('navigation').map(e=>({duration:e.duration,domContentLoaded:e.domContentLoadedEventEnd,load:e.loadEventEnd})),paint:performance.getEntriesByType('paint').map(e=>({name:e.name,startTime:e.startTime})),init:performance.getEntriesByName('lake:tab-init:create+setDocument').map(e=>e.duration),domNodes:document.querySelectorAll('*').length,heap:performance.memory?.usedJSHeapSize})`,
  );
  await focus();
  const apiCheck = await m.evaluate(
    `(()=>{const {app}=${electron};return {packaged:app.isPackaged,hardware:app.isHardwareAccelerationEnabled(),gpu:app.getGPUFeatureStatus(),prefs:${electron}.BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),versions:process.versions}})()`,
  );
  if (
    !apiCheck.packaged ||
    !apiCheck.hardware ||
    !apiCheck.prefs.sandbox ||
    !apiCheck.prefs.contextIsolation
  )
    throw Error("production runtime contract mismatch");
  const row = { label, readyMs: +readyMs.toFixed(1), ...timing };
  result.startup.push(row);
  console.log("STARTUP", JSON.stringify(row));
  result.runtime ??= apiCheck;
  await r.evaluate(
    `(()=>{window.__packagedPerf={longtasks:[],frames:[]};const p=window.__packagedPerf;p.observer=new PerformanceObserver(list=>{for(const e of list.getEntries())p.longtasks.push({at:e.startTime,duration:e.duration})});p.observer.observe({type:'longtask',buffered:true});return true})()`,
  );
  storeResult();
  return row;
}
const clone = (name) => {
  const dest = "/tmp/lake-packaged-perf-run-" + name + "-" + Date.now();
  fs.cpSync(fixture, dest, { recursive: true });
  ownedData.push(dest);
  return dest;
};
async function click(expr) {
  const p = await r.evaluate(
    `(()=>{const e=(${expr});if(!e)throw Error('click target absent');const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('click target invisible');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await r.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
  for (const type of ["mousePressed", "mouseReleased"])
    await r.send("Input.dispatchMouseEvent", {
      type,
      ...p,
      button: "left",
      clickCount: 1,
    });
}
async function startMeasure() {
  await focus();
  await r.evaluate(
    `(()=>{const p=window.__packagedPerf;p.start=performance.now();p.frames=[];p.stop=false;p.last=null;const loop=t=>{if(p.last!==null)p.frames.push(t-p.last);p.last=t;if(!p.stop)p.raf=requestAnimationFrame(loop)};p.raf=requestAnimationFrame(loop);return true})()`,
  );
}
async function endMeasure() {
  const row = await r.evaluate(
    `(()=>{const p=window.__packagedPerf;p.stop=true;cancelAnimationFrame(p.raf);return {elapsedMs:performance.now()-p.start,frames:p.frames,longtasks:p.longtasks.filter(e=>e.at>=p.start),heapBytes:performance.memory?.usedJSHeapSize,domNodes:document.querySelectorAll('*').length}})()`,
  );
  row.frameMs = stats(row.frames);
  row.longTaskMs = stats(row.longtasks.map((x) => x.duration));
  row.framesOver50 = row.frames.filter((x) => x > 50).length;
  delete row.frames;
  return row;
}
async function open(id, kind, expected = 0) {
  await startMeasure();
  const t = performance.now();
  await r.evaluate(
    `(()=>{const row=document.querySelector('[data-tree-node-id="${id}"]');if(!row)throw Error('tree row missing ${id}');row.click();return true})()`,
  );
  const ready =
    kind === "doc"
      ? `!!document.querySelector('${noteSelector(id)}[data-active="true"] .ne-engine[contenteditable="true"]')`
      : kind === "usheet"
        ? `!!document.querySelector('#univer-sheet-${id} canvas')`
        : kind === "bitable"
          ? `document.querySelectorAll('.bitable-editor[data-active="true"] tr[data-record-id]').length>=${expected}`
          : `!!document.querySelector('.board-editor[data-active="true"] .plait-board-container')`;
  await waitFor(r, ready, 90000);
  await r.evaluate(
    `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
  );
  const openMs = performance.now() - t;
  await wait(250);
  const measurements = await endMeasure();
  const row = {
    id,
    kind,
    expected,
    openMs: +openMs.toFixed(1),
    ...measurements,
  };
  result.opens.push(row);
  console.log("OPEN", JSON.stringify(row));
  storeResult();
}
async function screenshot(tag) {
  const shot = await r.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(evidence, tag + ".png"),
    Buffer.from(shot.data, "base64"),
  );
}
async function input(id) {
  await open(id, "doc");
  await startMeasure();
  await click(
    `document.querySelector('${noteSelector(id)} .ne-engine ne-p')||document.querySelector('${noteSelector(id)} .ne-engine')`,
  );
  const before = await r.evaluate(
    `document.querySelector('${noteSelector(id)} .ne-engine').innerText.length`,
  );
  const times = [];
  for (let n = 0; n < 12; n++) {
    const t = performance.now();
    await r.send("Input.insertText", { text: "x" });
    await r.evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);
    times.push(performance.now() - t);
    await wait(35);
  }
  const after = await r.evaluate(
    `document.querySelector('${noteSelector(id)} .ne-engine').innerText.length`,
  );
  if (after <= before) throw Error("input did not mutate real editor");
  const row = {
    id,
    chars: after - before,
    inputToFrameMs: stats(times),
    ...(await endMeasure()),
  };
  result.inputs.push(row);
  console.log("INPUT", JSON.stringify(row));
  storeResult();
  await wait(1400);
  const persisted = await r.evaluate(
    `(async()=>{const t=performance.now();const n=await window.lakeNative.readNote('${id}');return {readMs:performance.now()-t,bytes:new TextEncoder().encode(n.content).length,hasTypedText:n.content.includes('xxxxxxxxxxxx')}})()`,
  );
  row.saved = persisted;
  if (!persisted.hasTypedText) throw Error("typed text was not persisted");
  storeResult();
}
async function scroll(id) {
  await open(id, "doc");
  await startMeasure();
  const samples = await r.evaluate(
    `(async()=>{const root=document.querySelector('${noteSelector(id)}');const w=root.querySelector('.ne-editor-wrap');const a=[];for(let i=0;i<45;i++){const t=performance.now();w.scrollTop=i*180;w.dispatchEvent(new Event('scroll'));await new Promise(resolve=>requestAnimationFrame(resolve));a.push(performance.now()-t)}return {samples:a,scrollTop:w.scrollTop,max:w.scrollHeight-w.clientHeight}})()`,
  );
  const row = {
    id,
    scrollToFrameMs: stats(samples.samples),
    scrollTop: samples.scrollTop,
    maxScroll: samples.max,
    ...(await endMeasure()),
  };
  result.scrolls.push(row);
  console.log("SCROLL", JSON.stringify(row));
  storeResult();
}
async function memory(label) {
  const metrics = await m.evaluate(
    `(()=>{const {app}=${electron};return app.getAppMetrics().map(x=>({type:x.type,pid:x.pid,cpu:x.cpu,memory:x.memory}))})()`,
  );
  const totalKiB = metrics.reduce((s, x) => s + x.memory.workingSetSize, 0);
  return { label, totalMiB: +(totalKiB / 1024).toFixed(1), metrics };
}
async function save(id) {
  const row = await r.evaluate(
    `(async()=>{const n=await window.lakeNative.readNote('${id}');const t=performance.now();await window.lakeNative.saveNote(n.id,n.title,n.content+'<p>性能验收保存</p>');const ack=performance.now()-t;const read=await window.lakeNative.readNote(n.id);return {ackMs:ack,persisted:read.content.endsWith('<p>性能验收保存</p>')}})()`,
  );
  result.saves.push({ id, ...row });
  if (!row.persisted) throw Error("save acknowledgment did not persist body");
  console.log("SAVE", JSON.stringify({ id, ...row }));
  storeResult();
}
try {
  for (let i = 0; i < 3; i++) {
    const data = clone("cold" + i);
    await launch(data, "cold-" + i);
    await stop();
    if (i < 2) fs.rmSync(data, { recursive: true, force: true });
    else currentData = data;
  }
  // Same data directory and unmodified executable: repeated process launches with caches preserved.
  const warmData = currentData;
  for (let i = 0; i < 3; i++) {
    await launch(warmData, "warm-" + i);
    if (i < 2) await stop();
  }
  result.baselineMemory = await memory("5000docs baseline");
  result.systemInfo = await r.evaluate("window.lakeNative.getSystemInfo()");
  result.gpuInfo = await m.evaluate(`(${electron}.app.getGPUInfo('complete'))`);
  for (const [id, kind, rows] of [
    ["perf-doc-small", "doc", 0],
    ["perf-sheet-1000", "usheet", 0],
    ["perf-bitable-200", "bitable", 200],
    ["perf-board-100", "board", 0],
    ["perf-sheet-5000", "usheet", 0],
  ])
    await open(id, kind, rows);
  await open("perf-doc-media", "doc");
  await screenshot("media-24");
  for (const id of ["perf-doc-small", "perf-doc-512k", "perf-doc-2m"])
    await input(id);
  await scroll("perf-doc-2m");
  await screenshot("long-doc");
  await save("perf-doc-small");
  await save("perf-doc-2m");
  for (let i = 0; i < 8; i++)
    await open("perf-note-" + String(i).padStart(4, "0"), "doc");
  const actualTabs = await r.evaluate(
    `[...document.querySelectorAll('.tab-item[data-note-id]')].map(e=>e.dataset.noteId)`,
  );
  const switchingIds = actualTabs.slice(-2);
  if (switchingIds.length !== 2) throw Error("two retained tabs required");
  const tabTimes = [];
  await startMeasure();
  for (let i = 0; i < 20; i++) {
    const id = switchingIds[i % 2];
    const t = performance.now();
    await r.evaluate(
      `document.querySelector('.tab-item[data-note-id="${id}"]').click();true`,
    );
    await waitFor(
      r,
      `!!document.querySelector('${noteSelector(id)}[data-active="true"]')`,
    );
    await r.evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);
    tabTimes.push(performance.now() - t);
  }
  result.tabs.push({
    switchToFrameMs: stats(tabTimes),
    ...(await endMeasure()),
    memory: await memory("multiple tabs"),
  });
  await screenshot("multi-tabs");
  await click(`document.querySelector('button[aria-label="分屏"]')`);
  await wait(180);
  await startMeasure();
  const splitT = performance.now();
  await click(`document.querySelector('.tab-switcher-select')`);
  await r.evaluate(
    `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
  );
  result.split = {
    enterMs: performance.now() - splitT,
    measurement: await endMeasure(),
    ...(await r.evaluate(
      `({panes:document.querySelectorAll('[data-pane-visible="true"]').length,handle:!!document.querySelector('.ln-split-handle'),dom:document.querySelectorAll('*').length})`,
    )),
  };
  // 261014：浮动控制条已删除 ⇒ 两栏态的信号改用分隔条（.ln-split-handle，分屏唯一实现）
  if (result.split.panes !== 2 || !result.split.handle)
    throw Error("split did not reach two-pane state");
  await screenshot("split");
  await click(`document.querySelector('button[aria-label="分屏"]')`);
  await wait(150);
  // Directory control: same 5000-doc library, only collapse the existing tree (no product CSS changes).
  await open(switchingIds[0], "doc");
  result.directoryControl = [];
  result.directoryInputs = [];
  const trial = async (label) => {
    await startMeasure();
    await r.send("Profiler.enable");
    await r.send("Profiler.start");
    const a = [];
    for (let i = 0; i < 12; i++) {
      const id = switchingIds[i % 2];
      const t = performance.now();
      await r.evaluate(
        `document.querySelector('.tab-item[data-note-id="${id}"]').click();true`,
      );
      await r.evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);
      a.push(performance.now() - t);
      await wait(40);
    }
    const profile = await r.send("Profiler.stop");
    fs.writeFileSync(
      path.join(evidence, label + ".cpuprofile"),
      JSON.stringify(profile.profile),
    );
    const row = { label, switchToFrameMs: stats(a), ...(await endMeasure()) };
    result.directoryControl.push(row);
    console.log("DIRECTORY", JSON.stringify(row));
    storeResult();
  };
  await trial("directory-expanded");
  await click(`document.querySelector('.collapse-all-btn')`);
  await wait(300);
  await trial("directory-collapsed");
  // Input comparison in the same ordinary editor, independent of long-document initialization.
  const activeInputId = switchingIds[1];
  await input(activeInputId);
  result.directoryInputs.push({ mode: "collapsed", ...result.inputs.at(-1) });
  // Real packaged main process and real S3 SDK, with loopback-only test transport.
  remote = await loopbackS3(fixture, s3Port);
  remote.setDelay(1500);
  await r.evaluate(
    `(async()=>{await window.lakeNative.saveSyncSettings({enabled:true,autoMode:'manual',autoIntervalMinutes:15});return true})()`,
  );
  await wait(500);
  await r.evaluate(
    `window.lakeNative.saveS3Settings(${JSON.stringify({ endpoint: `http://127.0.0.1:${s3Port}`, region: "us-east-1", bucket: "synthetic", prefix: "perf-audit", accessKeyId: "SYNTHETIC", secretAccessKey: "SYNTHETIC-NOT-A-REAL-KEY", forcePathStyle: true })})`,
  );
  await r.evaluate(
    `(()=>{window.__perfSync={start:performance.now(),done:false};window.lakeNative.syncNow().then(result=>Object.assign(window.__perfSync,{done:true,result,elapsedMs:performance.now()-window.__perfSync.start}),error=>Object.assign(window.__perfSync,{done:true,error:String(error)}));return true})()`,
  );
  await wait(150);
  await startMeasure();
  const during = [];
  let saveDuringSyncMs = null;
  const syncDeadline = performance.now() + 120000;
  let i = 0;
  while (
    !(await r.evaluate("window.__perfSync.done")) &&
    performance.now() < syncDeadline
  ) {
    const t = performance.now();
    await r.evaluate(
      `document.querySelector('.tab-item[data-note-id="${switchingIds[i % 2]}"]').click();true`,
    );
    await r.evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);
    during.push(performance.now() - t);
    i++;
    if (i === 4) {
      const saveT = performance.now();
      await save(switchingIds[0]);
      saveDuringSyncMs = performance.now() - saveT;
    }
    await wait(150);
  }
  const syncUi = await endMeasure();
  await waitFor(r, "window.__perfSync.done", 1000);
  result.sync = {
    ...(await r.evaluate("window.__perfSync")),
    switchToFrameMs: stats(during),
    saveDuringSyncWallMs: saveDuringSyncMs,
    ui: syncUi,
    networkEvents: remote.events,
  };
  if (result.sync.error || !result.sync.result?.manifestId)
    throw Error("full real-engine sync failed");
  console.log("SYNC", JSON.stringify(result.sync));
  storeResult();
  // Disabling through the UI performs another alignment; do not make that part of this measured round.

  await remote.close();
  remote = null;
  // High-end table is last: it is a known full-DOM bottleneck and must not contaminate ordinary measurements.
  if (
    !(await r.evaluate(
      `!!document.querySelector('[data-tree-node-id="perf-bitable-5000"]')`,
    ))
  )
    await r.evaluate(
      `document.querySelector('[data-tree-node-id="notebook-personal"] .tree-chevron').click();true`,
    );
  await wait(250);
  await open("perf-bitable-5000", "bitable", 5000);
  await screenshot("bitable-5000");
  result.largeBitableMemory = await memory("5000x20 bitable");
  result.startupSummary = {
    cold: stats(
      result.startup
        .filter((x) => x.label.startsWith("cold"))
        .map((x) => x.readyMs),
    ),
    warm: stats(
      result.startup
        .filter((x) => x.label.startsWith("warm"))
        .map((x) => x.readyMs),
    ),
  };
  finalEvidence();
  result.dataDir = currentData;
  storeResult();
  console.log("AUDIT_DONE", path.join(evidence, "results.json"));
} catch (error) {
  result.errors.push({ message: String(error), stack: error.stack });
  storeResult();
  console.error(error);
  process.exitCode = 1;
} finally {
  if (remote) await remote.close();
  finalEvidence();
  await stop();
  if (process.env.LAKE_PERF_KEEP_DATA !== "1") {
    for (const dir of ownedData)
      fs.rmSync(dir, { recursive: true, force: true });
    result.dataCleaned = true;
  }
  storeResult();
}
