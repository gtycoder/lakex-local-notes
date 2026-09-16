// 像素批次比对：node scripts/css-audit/pixdiff.mjs "a.png=b.png" "c.png=d.png" ...
import sharp from "sharp";
import fs from "node:fs";
const pairs = process.argv.slice(2);
for (const p of pairs) {
  const [a, b] = p.split("=");
  try {
    const A = await sharp(a).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const B = await sharp(b).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const n = Math.min(A.data.length, B.data.length);
    let diff = 0, maxDelta = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(A.data[i] - B.data[i]);
      if (d > 2) diff++;
      if (d > maxDelta) maxDelta = d;
    }
    const px = n / 4;
    console.log(`${a.split("/").pop()} vs ${b.split("/").pop()}: 差异通道 ${diff}/${n} (${((diff / n) * 100).toFixed(3)}%) maxΔ=${maxDelta} size=${A.info.width}x${A.info.height}/${B.info.width}x${B.info.height}`);
  } catch (e) { console.log(p, "ERR", e.message); }
}
