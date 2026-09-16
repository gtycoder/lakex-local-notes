// 为全部选择器打元素指纹（跨 27 个状态），供"重叠/包含"分析
import fs from "node:fs";
import { STATES, setupState } from "./stylesnap.mjs";
import { data } from "./paths.mjs";
const SELS = JSON.parse(fs.readFileSync(data("allselectors.json"), "utf8"));
const CHUNK = 220;
export default async ({ page }) => {
  const out = {};
  for (const st of STATES) {
    await setupState(page, st);
    const res = {};
    for (let i = 0; i < SELS.length; i += CHUNK) {
      const part = SELS.slice(i, i + CHUNK);
      const got = await page.evaluate(`(() => {
        const sels = ${JSON.stringify(part)};
        const els = [...document.querySelectorAll("body *")];
        const idx = new Map(); els.forEach((e, i) => idx.set(e, i));
        const out = {};
        for (const s of sels) {
          try { out[s] = [...document.querySelectorAll(s)].map((e) => idx.get(e)).filter((x) => x !== undefined); } catch (e) { out[s] = null; }
        }
        return out;
      })()`);
      Object.assign(res, got);
    }
    out[st.name] = res;
    console.log(`  [fp] ${st.name} 完成`);
  }
  fs.writeFileSync(data("fingerprints-all.json"), JSON.stringify(out));
  return { states: Object.keys(out).length };
};
