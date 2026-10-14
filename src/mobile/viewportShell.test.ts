/**
 * 外壳高度（viewportShell）护栏（261014）。
 * 语义：**单调取历史最大值**（= 键盘收起时的视口高）——只有输入法会让 WebView 变矮，我们自己的面板不会，
 * 所以这个值才是"面板 ⇄ 输入法切换时内容盒高度不变"的基准；方向变化时重置。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { noteViewport, resetShellHeight, shellHeight } from "./viewportShell";

describe("viewportShell：稳定外壳高", () => {
  beforeEach(() => resetShellHeight());

  it("取历史最大值（键盘把它压矮时不跟着变小）", () => {
    expect(noteViewport(842)).toBe(842);
    expect(noteViewport(530)).toBe(842);   // 输入法弹出：外壳高不跟着缩
    expect(shellHeight()).toBe(842);
    expect(noteViewport(900)).toBe(900);   // 更大的视口（旋转/分屏）会更新
  });

  it("未测量到时是 0；reset 后重新学习", () => {
    expect(shellHeight()).toBe(0);
    noteViewport(700);
    resetShellHeight();
    expect(shellHeight()).toBe(0);
    expect(noteViewport(800)).toBe(800);
  });
});
