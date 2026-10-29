/**
 * DT-11 自证：`audit-dead-css.mjs` 必须把「模板串前缀 + 变量」当成动态类名（不报死 CSS）。
 *
 * 为什么用子进程而不是 import：脚本是 CLI（顶层直接读全仓并打印），import 会带副作用；
 * 这里跑真实命令，断言**用户看到的那份输出**（黑盒，改实现不脆）。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts/css-audit/audit-dead-css.mjs");

describe("audit-dead-css：模板串前缀拼接识别", () => {
  it("已知样本 toc-minimap__item--d${depth} 不再被判为死类", () => {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8" });
    // 该样本是 OutlineMinimap.tsx 的 `toc-minimap__item--d${depth}`：旧实现整仓 join 后反引号配错，
    // 曾一次性误报 d1..d6 六个桌面候选；修好后它们只应出现在 --all 的「动态拼接」排除区。
    expect(out).not.toContain(".toc-minimap__item--d");
  }, 60_000);

  it("--selfcheck 用内置已知样本自证识别仍然有效", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--selfcheck"], { cwd: REPO, encoding: "utf8" });
    expect(out).toContain("selfcheck OK");
  }, 60_000);
});
