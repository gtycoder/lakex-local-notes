/**
 * 用户可见「协议版本号」字面量扫描（261012 用户要求）。
 *
 * 背景：移动端「关于」页曾经写死 `manifest v4`（V1 重置前的老值），而页面只是把 appInfo 的值渲染出来 ——
 * 真正的错在 appInfoPort 里硬编码了旧版本号。单测 `src/mobile/native/appInfoPort.test.ts` 钉住了那一个值，
 * 这条扫描则封住**面**：源码里任何地方再出现「manifest v<数字>」这种写死版本号的文案，直接失败。
 *
 * 判据：去掉注释后，源码（.ts/.tsx）里不得出现 /manifest\s*v\s*\d/i。
 * 正确写法 = 从单一来源取（`String(S3V3_POINTER_VERSION)` / appInfo.protocolVersion）。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

function listFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "dist-mobile") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    // 护栏自身要写出"反面样例"（manifest v4）才能把规则讲清楚 ⇒ 扫描时排除它自己。
    else if (/\.(ts|tsx)$/.test(e.name) && e.name !== "versionLiterals.test.ts") out.push(p);
  }
  return out;
}

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

describe("用户可见的协议版本号必须来自单一来源", () => {
  it("源码里没有写死的 manifest v<数字> 文案", () => {
    const hits: string[] = [];
    for (const abs of listFiles(SRC)) {
      const body = stripComments(readFileSync(abs, "utf8"));
      const re = /manifest\s*v\s*\d/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) {
        const line = body.slice(0, m.index).split("\n").length;
        hits.push(path.relative(SRC, abs) + ":" + line + " → " + m[0]);
      }
    }
    expect(
      hits,
      "写死的协议版本号会随协议升级而漂（历史上出现过 manifest v4）；请改成从 S3V3_POINTER_VERSION / appInfo.protocolVersion 取：\n  " +
        hits.join("\n  ")
    ).toEqual([]);
  });
});
