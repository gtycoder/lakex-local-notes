import fs from "node:fs";
import { data } from "./paths.mjs";
export default async ({ page }) => {
  const order = await page.evaluate(`(() => {
    const out = [];
    for (const ss of document.styleSheets) {
      const id = ss.ownerNode && ss.ownerNode.getAttribute ? ss.ownerNode.getAttribute("data-vite-dev-id") : null;
      if (!id) continue;
      const i = id.indexOf("/src/");
      if (i < 0) continue;
      out.push("src/" + id.slice(i + 5));
    }
    return out;
  })()`);
  fs.writeFileSync(data("loadorder.json"), JSON.stringify(order, null, 1));
  return { n: order.length, order };
};
