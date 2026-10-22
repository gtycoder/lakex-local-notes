import { connect } from './cdpclient.mjs';
const R = await connect(9235), E = await connect(9236);
async function bench(c, label) {
  const t = await c.ev('(async function(){var ts=[];for(var i=0;i<10;i++){var t0=Date.now();await window.lakeNative.testS3Connection();ts.push(Date.now()-t0);}return ts;})()');
  console.log(label + ' testS3Connection(ms) = ' + JSON.stringify(t) + '  avg=' + Math.round(t.reduce(function(a,b){return a+b;},0)/t.length));
  const t2 = await c.ev('(async function(){var ts=[];for(var i=0;i<10;i++){var t0=Date.now();await window.lakeNative.testS3Connection();ts.push(Date.now()-t0);}return ts;})()');
  console.log(label + ' testS3Connection warm(ms) = ' + JSON.stringify(t2) + '  avg=' + Math.round(t2.reduce(function(a,b){return a+b;},0)/t2.length));
  const tc = await c.ev('(async function(){var t0=Date.now();for(var i=0;i<1000;i++){await window.lakeNative.createNote("perf-"+i, null);}return Date.now()-t0;})()');
  console.log(label + ' createNote x1000 = ' + tc + 'ms');
  const tr = await c.ev('(async function(){var t0=Date.now();for(var i=0;i<20;i++){await window.lakeNative.getHomeSnapshot().then(function(s){return s.notes;});}return Date.now()-t0;})()');
  console.log(label + ' getHomeSnapshot x20 = ' + tr + 'ms');
}
await bench(R, '真机R');
await bench(E, '模拟器E');
process.exit(0);
