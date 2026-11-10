/**
 * 内核未分层 `button { color: inherit }` 的语义色补钉（261110 第二批：改指 ln-*）。
 *
 * 为什么必须有：内核在运行时注入一条**未分层**的 button 颜色继承规则（见 kernel-theme.css 头注），
 * 未分层普通声明压过 @layer 里的所有普通声明 ⇒ kit 分层里给 .ln-btn / .ln-chip / .ln-check 的
 * 语义字色会被吃掉（主按钮白字、chip 灰字、勾选框白勾都会变成正文色）。唯一修法是在**同一个未分层文件**
 * 里用更高特异性把颜色放回去（不碰背景/边框/状态）。
 *
 * 本护栏钉两件事：
 *   1. 这些补钉必须留在 kernel-theme.css（**未分层**）且颜色仍是语义令牌；
 *   2. 每条补钉的类名必须仍被桌面 TSX 使用 —— 防止「补钉还在、原语已改名」的死规则。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const kernel = readFileSync(path.join(SRC, "styles/kernel-theme.css"), "utf8");
const entry = readFileSync(path.join(SRC, "styles/index.css"), "utf8");

/** pin 文本（逐字）→ 该 pin 服务的原语类名（用于「还在用」检查）。 */
const PINS: Array<[string, string]> = [
  ["button.ln-btn { color: var(--lake-text-2); }", "ln-btn"],
  ["button.ln-btn--primary { color: var(--lake-text-on-accent); }", "ln-btn--primary"],
  ["button.ln-btn--outlined, button.ln-btn--link { color: var(--lake-accent-text); }", "ln-btn--link"],
  ["button.ln-btn--danger, button.ln-btn--danger-text { color: var(--lake-status-error); }", "ln-btn--danger"],
  ["button.ln-btn--secondary { color: var(--lake-text-2); }", "ln-btn--secondary"],
  ["button.ln-btn--ghost { color: var(--lake-text-2); }", "ln-btn--ghost"],
  ["button.ln-chip { color: var(--lake-text-2); }", "ln-chip"],
  ["button.ln-chip.is-selected { color: var(--lake-fg-selected); }", "ln-chip"],
  ["button.ln-chip--add { color: var(--lake-text-3); }", "ln-chip--add"],
  ["button.ln-chip--danger.is-selected { color: var(--lake-status-error); }", "ln-chip--danger"],
  ["button.ln-check { color: var(--lake-text-on-accent); }", "ln-check"],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "mobile" || entry.name === "node_modules" || entry.name === "vendor") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe("内核按钮色补钉（kernel-theme，未分层）", () => {
  it("kernel-theme.css 仍以未分层身份引入（分层引入 = 补钉失效）", () => {
    expect(entry).toContain('@import "./kernel-theme.css";');
    expect(entry).not.toMatch(/@import "\.\/kernel-theme\.css" layer\(/);
  });

  it("每条语义色补钉都在（改原语名时必须同步改这里）", () => {
    for (const [pin] of PINS) expect(kernel, "缺少未分层补钉：" + pin).toContain(pin);
  });

  it("补钉指向的原语类名仍被桌面 TSX 使用（防死补钉）", () => {
    const sources = walk(SRC).map((file) => readFileSync(file, "utf8")).join("\n");
    for (const [pin, cls] of PINS) {
      expect(sources.includes(cls), "补钉已无调用点（原语改名或删除）：" + cls + " ← " + pin).toBe(true);
    }
  });
});
