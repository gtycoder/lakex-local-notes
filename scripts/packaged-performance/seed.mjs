#!/usr/bin/env node
/** Create a new isolated seed through the packaged application's real API/editor. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Cdp, wait, waitFor } from "./cdp.mjs";
const app = path.resolve(
  process.env.LAKE_PERF_APP ||
    "release/mac-arm64/LakexLocalNotes.app/Contents/MacOS/LakexLocalNotes",
);
const seed = path.resolve(
  process.env.LAKE_PERF_SEED || `/tmp/lake-packaged-perf-seed-${Date.now()}`,
);
const template = path.resolve(
  process.env.LAKE_PERF_TEMPLATE ||
    ".css-audit/packaged-perf-261013/evidence/fixture-template.json",
);
if (!app.includes(".app/Contents/MacOS/") || !fs.existsSync(app))
  throw Error("real packaged executable required");
if (!seed.startsWith("/tmp/lake-packaged-perf-seed-") || fs.existsSync(seed))
  throw Error(
    "seed must be a new isolated /tmp/lake-packaged-perf-seed-* directory",
  );
const env = { ...process.env, LAKE_USER_DATA: seed, LAKE_ASSET_PORT: "19871" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(app, ["--remote-debugging-port=9271"], {
  env,
  stdio: "ignore",
});
let cdp;
try {
  cdp = await Cdp.connect(9271, (t) => t.type === "page");
  await cdp.send("Page.enable");
  await cdp.send("Page.bringToFront");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await waitFor(
    cdp,
    "!!window.__desktopEditor && !!document.querySelector('.ne-engine ne-p')",
  );
  const point = await cdp.evaluate(
    `(()=>{const r=document.querySelector('.ne-engine ne-p').getBoundingClientRect();return {x:r.left+20,y:r.top+10}})()`,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
  await cdp.evaluate(
    `(()=>{window.__desktopEditor.renderer.execCommand('insertFiles',[new File([new Uint8Array(4096).fill(65)],'perf-attachment.txt',{type:'text/plain'})],{category:'file',from:'ui'});return true})()`,
  );
  await waitFor(
    cdp,
    `window.__desktopEditor.getDocument('text/lake').includes('name="file"')`,
  );
  await wait(1000);
  const value = await cdp.evaluate(
    `(async()=>{const api=window.lakeNative,canonical=window.__desktopEditor.getDocument('text/lake'),seeds={};await api.saveNote('welcome-note','欢迎来到 LakexLocalNotes',canonical);for(const [key,method] of [['doc','createNoteIn'],['sheet','createUsheetIn'],['bitable','createBitableIn'],['board','createBoardIn']])seeds[key]=await api[method]('notebook-personal','验收·'+key);return {canonical,seeds}})()`,
  );
  fs.mkdirSync(path.dirname(template), { recursive: true });
  fs.writeFileSync(template, JSON.stringify(value, null, 2));
  console.log(JSON.stringify({ seed, template }));
} finally {
  cdp?.close();
  child.kill("SIGTERM");
  await Promise.race([new Promise((r) => child.once("exit", r)), wait(6000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
