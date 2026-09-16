import fs from "node:fs";
import { STATES, setupState } from "./stylesnap.mjs";
import { data } from "./paths.mjs";
const CONDS = JSON.parse(fs.readFileSync(data("conditions.json"), "utf8"));
export default async ({ page }) => {
  const out = {};
  for (const st of STATES) {
    await setupState(page, st);
    out[st.name] = await page.evaluate(`(() => { const cs = ${JSON.stringify(CONDS)}; const o = {}; for (const c of cs) o[c] = window.matchMedia(c).matches; return o; })()`);
  }
  fs.writeFileSync(data("cond-eval.json"), JSON.stringify(out, null, 1));
  return { states: Object.keys(out).length, conditions: CONDS.length };
};
