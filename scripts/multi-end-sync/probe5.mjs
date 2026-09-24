import { connect } from "./cdpclient.mjs";
const ports = [9232, 9233, 9234, 9235, 9236];
const labels = { 9232: "D1", 9233: "D2", 9234: "D3", 9235: "R", 9236: "E" };
for (const p of ports) {
  const c = await connect(p);
  try {
    const inv = await c.ev("Promise.resolve(window.lakeNative.listNotes ? window.lakeNative.listNotes() : null).then(n => n ? n.length : null)");
    const tree = await c.ev("window.lakeNative.listTreeNodes().then(t => t.length)");
    const quick = await c.ev("window.lakeNative.listQuickNotes().then(q => q.length)");
    const hasCreateSheet = await c.ev("typeof window.lakeNative.createSheetIn === 'function'");
    console.log(labels[p] + " notes=" + inv + " tree=" + tree + " quick=" + quick + " createSheet=" + hasCreateSheet);
  } catch (e) { console.log(labels[p] + " ERR " + e.message); }
}
process.exit(0);
