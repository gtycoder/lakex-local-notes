/**
 * 「编辑面」算术护栏（261014 P1）：这几条迁移过去只在设备上验过，现在进 CI。
 * 期望值全部来自设备实测记录（docs/LAKEX-CONTRACT.md §5.36–§5.38 / HANDOFF §8）。
 */
import { describe, expect, it } from "vitest";
import { bottomOccupation, capturePanelHeight, dockKbOffset, shellSurfaceHeight } from "./editSurfaceModel";

const SHELL = 842;          // 键盘收起时的视口高（稳定外壳高）
const IME = 312;            // 键盘/面板实际高度（设备实测）
const IME_VH = SHELL - IME; // 键盘弹出时的视口高 = 530

describe("bottomOccupation：底部被占高度", () => {
  it("键盘态 = 键盘高；面板态 = 面板高（两者互斥）", () => {
    const base = { panelOpen: false, closing: false, panelHeight: 0, keyboardOpen: true, keyboardHeight: IME };
    expect(bottomOccupation(base)).toBe(IME);
    expect(bottomOccupation({ ...base, panelOpen: true, panelHeight: IME, keyboardOpen: false })).toBe(IME);
  });

  it("收起过渡期（面板已关、键盘还没回）仍按面板占住 —— 否则那一带会先塌", () => {
    expect(bottomOccupation({ panelOpen: false, closing: true, panelHeight: IME, keyboardOpen: false, keyboardHeight: 0 })).toBe(IME);
  });

  it("都没有 = 0（阅读/非编辑态）", () => {
    expect(bottomOccupation({ panelOpen: false, closing: false, panelHeight: 0, keyboardOpen: false, keyboardHeight: 0 })).toBe(0);
  });
});

describe("shellSurfaceHeight：键盘态与面板态必须相等（内容视口恒定 = 不跳）", () => {
  it("两种状态算出同一个外壳高（这就是「面板⇄键盘不跳」的数学表述）", () => {
    const keyboard = shellSurfaceHeight(SHELL, bottomOccupation({ panelOpen: false, closing: false, panelHeight: 0, keyboardOpen: true, keyboardHeight: IME }));
    const panel = shellSurfaceHeight(SHELL, bottomOccupation({ panelOpen: true, closing: false, panelHeight: IME, keyboardOpen: false, keyboardHeight: 0 }));
    expect(keyboard).toBe(IME_VH);
    expect(panel).toBe(IME_VH);
  });

  it("没有占用 = 满外壳高；未测到外壳高 = 0（调用方据此不写 CSS 变量，避免首帧 0px 闪一下）", () => {
    expect(shellSurfaceHeight(SHELL, 0)).toBe(SHELL);
    expect(shellSurfaceHeight(0, IME)).toBe(0);
  });
});

describe("dockKbOffset：工具栏屏幕 Y 必须恒定", () => {
  it("面板期：视口从键盘态长到满高，偏移同步从 0 长到面板高（工具栏不移动）", () => {
    const atOpenStart = dockKbOffset({ panelOpen: true, closing: false, innerHeight: IME_VH, shellHeight: SHELL, panelHeight: IME, edgeToEdgeOffset: 0 });
    const settled = dockKbOffset({ panelOpen: true, closing: false, innerHeight: SHELL, shellHeight: SHELL, panelHeight: IME, edgeToEdgeOffset: 0 });
    expect(atOpenStart).toBe(0);
    expect(settled).toBe(IME);
    // 工具栏屏幕 Y = innerHeight − kbOffset − 工具栏高 ⇒ 两端相等
    expect(IME_VH - atOpenStart).toBe(SHELL - settled);
  });

  it("无面板：用 edge-to-edge 上移量（adjustResize 下为 0）", () => {
    expect(dockKbOffset({ panelOpen: false, closing: false, innerHeight: SHELL, shellHeight: SHELL, panelHeight: 0, edgeToEdgeOffset: 0 })).toBe(0);
    expect(dockKbOffset({ panelOpen: false, closing: false, innerHeight: SHELL, shellHeight: SHELL, panelHeight: 0, edgeToEdgeOffset: 312 })).toBe(312);
  });

  it("收起过渡期仍按面板算（键盘没回来之前工具栏不许掉到屏幕底部）", () => {
    expect(dockKbOffset({ panelOpen: false, closing: true, innerHeight: SHELL, shellHeight: SHELL, panelHeight: IME, edgeToEdgeOffset: 0 })).toBe(IME);
  });
});

describe("capturePanelHeight：打开瞬间捕获键盘区高度（带下限）", () => {
  it("有键盘高就用它；拿不到（0）时用兜底下限", () => {
    expect(capturePanelHeight(IME)).toBe(IME);
    expect(capturePanelHeight(0)).toBe(280);
    expect(capturePanelHeight(120)).toBe(280);
  });
});
