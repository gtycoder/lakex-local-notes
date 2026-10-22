import { connect } from "./cdpclient.mjs";
const ports = [9232, 9233, 9234, 9235, 9236];
const labels = { 9232: "D1", 9233: "D2", 9234: "D3", 9235: "R", 9236: "E" };
for (const p of ports) {
  const c = await connect(p);
  try {
    const inv = await c.ev("Promise.resolve(window.lakeNative.getHomeSnapshot ? window.lakeNative.getHomeSnapshot() : null).then(s => s ? s.notes.length : null)");
    const tree = await c.ev("window.lakeNative.getHomeSnapshot().then(function(s){return s.treeNodes;}).then(t => t.length)");
    const quick = await c.ev("window.lakeNative.getQuickNotePage().then(function(p){return p.items;}).then(q => q.length)");
    const hasCreateUsheet = await c.ev("typeof window.lakeNative.createUsheetIn === 'function'");
    console.log(labels[p] + " notes=" + inv + " tree=" + tree + " quick=" + quick + " createUsheet=" + hasCreateUsheet);
  } catch (e) { console.log(labels[p] + " ERR " + e.message); }
}
process.exit(0);
