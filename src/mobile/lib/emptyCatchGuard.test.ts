/**
 * MOB-14 回归护栏：空 catch（块内只有注释）必须写「真实理由」，不能只写「忽略 / ignore」或干脆不写。
 *
 * 背景：261027 审计记 197 处空 catch / 78 处「仅忽略」——静默失败 = 用户「点了没反应」且排障无信号。
 * 261028 起命令/交互路径接 `reportMobileActionError`（lib/reportMobileActionError.ts），其余可预期 no-op
 * 保留空 catch 但必须写理由；逐条清单见 `docs/MOBILE-EMPTY-CATCH-LEDGER.md`。
 *
 * 判据用 TypeScript AST（与人工清单同一口径），不按正则扫源码 —— 文档注释里出现的 `catch {}` 字样不算。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.join(process.cwd(), "src/mobile");
const BARE = /^(忽略|ignore)/i;
const COMMENT = /\/\*([\s\S]*?)\*\/|\/\/([^\n]*)/;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(full);
  }
  return files;
}

describe("MOB-14：空 catch 必须带真实理由", () => {
  it("不允许「忽略 / ignore」或无注释的空 catch（命令/交互路径请接 reportMobileActionError）", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (ts.isCatchClause(node)) {
          const raw = source.text.slice(node.block.getStart() + 1, node.block.getEnd() - 1);
          const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").trim();
          if (code.length === 0) {
            const comment = (COMMENT.exec(raw)?.[1] ?? COMMENT.exec(raw)?.[2] ?? "").trim();
            if (!comment || BARE.test(comment)) {
              const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
              hits.push(path.relative(process.cwd(), file) + ":" + line);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(hits).toEqual([]);
  });
});
