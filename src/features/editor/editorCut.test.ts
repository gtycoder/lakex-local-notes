/**
 * 编辑器「剪切」护栏（260917）。
 *
 * 背景：EditorTab 的 cutHandler 在 capture 阶段 stopImmediatePropagation 抢在内核 cut 之前，
 * 早前它用 document.execCommand("delete") 做 **DOM 级删除** ⇒ 内核模型不变，点一下块
 * 就被模型重绘回来（实测：选区文字消失 → 点块恢复），转换后的内容同样受影响。
 * 修法：删除改走内核命令（kernel/editor.execCommand("delete")），DOM 删除仅作兜底。
 *
 * vitest 跑在 node 环境、起不了内核，故这里做源码级断言（与 blockMenuNative/cssLayers 同一套路）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./EditorTab.tsx", import.meta.url), "utf8");

describe("编辑器剪切：删除必须同步内核模型", () => {
  it("cutHandler 通过内核命令删除", () => {
    expect(SRC).toMatch(/ed\.kernel\.execCommand\("delete"\)|ed\?\.kernel\?\.execCommand\("delete"\)/);
  });

  it("不再以裸 DOM 删除为主路径（仅允许兜底）", () => {
    // 内核删除必须存在，且排在裸 DOM 删除兜底之前
    const kernelAt = SRC.indexOf('kernel.execCommand("delete")');
    const domFallbackAt = SRC.indexOf('else document.execCommand("delete")');
    expect(kernelAt).toBeGreaterThan(-1);
    expect(domFallbackAt).toBeGreaterThan(-1);
    expect(kernelAt).toBeLessThan(domFallbackAt);
  });
});
