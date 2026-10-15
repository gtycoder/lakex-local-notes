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

  // 261015（用户报「键盘只能收不能展开」的根因）：IME 过渡里 window.innerHeight 会**单独**给出异常值，
  // 本机把基准记成 866（真实稳定值 842）；单调最大值一旦记进去就再也降不下来 ⇒ keyboardOpen 永久为真。
  it("两通道不一致的更大值不抬高基准（防 innerHeight 单独失真的鬼值）", () => {
    expect(noteViewport(842, 842)).toBe(842);
    expect(noteViewport(866, 842)).toBe(842);   // innerHeight 撒谎、visualViewport 说真话 ⇒ 拒绝
    expect(noteViewport(3150, 842)).toBe(842);  // 更离谱的值同样拒绝
    expect(shellHeight()).toBe(842);
  });

  it("两通道一致时，更大的视口仍然更新（旋转/分屏走 reset 或一致观测）", () => {
    expect(noteViewport(842, 842)).toBe(842);
    expect(noteViewport(900, 900)).toBe(900);
  });

  it("首次观测两通道不一致（edge-to-edge 且键盘弹着）⇒ 不建立基准，等可信观测", () => {
    expect(noteViewport(842, 530)).toBe(0);     // 键盘把 visualViewport 压矮 ⇒ 这不是"键盘收起时的高"
    expect(shellHeight()).toBe(0);
    expect(noteViewport(842, 842)).toBe(842);   // 键盘收起后立刻建立
  });
});
