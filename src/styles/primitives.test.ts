/**
 * 原语变体门禁（261107）：feature / app CSS 不得从外面叠加覆盖 kit 原语（`.ln-*` / `.mb-*`）。
 *
 * 判据：从 kit/overlay 原语文件提取全部原语类名；扫描其它自有 CSS 的每条规则，
 * 若选择器 ≥2 个类且其中一个是原语类 ⇒ 记为「跨所有权覆盖」。
 * 基数为当前审计值（70），**只许降**；要改原语表现请在原语文件加变体（ln-btn--compact 等），
 * 或在原语根上设 CSS 变量，不要写 `.feature .ln-x__inner`。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const PRIMITIVE_FILES = [
  "styles/kit.css",
  "styles/overlay.css",
  "mobile/kit.css",
  "mobile/floating.css",
];
const CROSS_OWNERSHIP_BASELINE = 17;

function primitiveClasses(): Set<string> {
  const names = new Set<string>();
  for (const rel of PRIMITIVE_FILES) {
    const css = readFileSync(path.join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/\.([a-z][\w-]*)/g)) {
      if (/^(ln|mb)-/.test(match[1])) names.add(match[1]);
    }
  }
  return names;
}

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      cssFiles(full, out);
    } else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

describe("原语变体门禁", () => {
  it("feature/app CSS 对 kit 原语的跨所有权覆盖只许降", () => {
    const primitives = primitiveClasses();
    const offenders: string[] = [];
    for (const file of cssFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (PRIMITIVE_FILES.includes(rel)) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of css.matchAll(/([^{}]+)\{/g)) {
        const selector = rule[1].trim().replace(/\s+/g, " ");
        if (!selector || selector.startsWith("@")) continue;
        const classes = [...selector.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
        if (classes.length < 2) continue;
        if (!classes.some((name) => primitives.has(name))) continue;
        offenders.push(rel + " :: " + selector.slice(0, 120));
      }
    }
    expect(
      offenders.length,
      "原语跨所有权覆盖新增了（只许降；请在原语文件加变体/变量）：\n  " + offenders.filter((line) => !line.startsWith("components/ui/")).slice(0, 10).join("\n  "),
    ).toBeLessThanOrEqual(CROSS_OWNERSHIP_BASELINE);
  });
});
