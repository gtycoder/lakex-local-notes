import { describe, expect, it } from "vitest";
import { baseCapsuleHidden, capsuleHiddenFor, type CapsuleVisibilityInput } from "./capsuleVisibility";

const base: CapsuleVisibilityInput = { chromeHidden: false, editing: true, capsuleInEdit: true, keyboardOpen: false };

describe("baseCapsuleHidden（无面板时的基础判据）", () => {
  it("文档编辑态、无键盘 → 常显", () => { expect(baseCapsuleHidden(base)).toBe(false); });
  it("键盘弹起 → 隐藏", () => { expect(baseCapsuleHidden({ ...base, keyboardOpen: true })).toBe(true); });
  it("非编辑态 → 不隐藏（阅读态由滚动 chrome 管）", () => { expect(baseCapsuleHidden({ ...base, editing: false, keyboardOpen: true })).toBe(false); });
  it("编辑态但非文档（表格/多维表/画板/手写板）→ 隐藏", () => { expect(baseCapsuleHidden({ ...base, capsuleInEdit: false })).toBe(true); });
  it("chromeHidden（滚动隐藏/子页全屏）优先 → 隐藏", () => { expect(baseCapsuleHidden({ ...base, chromeHidden: true })).toBe(true); });
});

describe("capsuleHiddenFor（面板阶段冻结可见性，261104 闪入闪出修复）", () => {
  it("面板打开中：即使键盘判据变真，也保持打开前的可见", () => {
    expect(capsuleHiddenFor({ ...base, keyboardOpen: true, dockPanelPhase: "open", frozenHidden: false })).toBe(false);
  });
  it("面板打开中：打开前本来就隐藏（键盘已开）→ 保持隐藏，不因收 IME 而弹出来", () => {
    expect(capsuleHiddenFor({ ...base, keyboardOpen: false, dockPanelPhase: "open", frozenHidden: true })).toBe(true);
  });
  it("面板收起过渡中：仍然冻结（等关完再按键盘判据）", () => {
    expect(capsuleHiddenFor({ ...base, keyboardOpen: true, dockPanelPhase: "closing", frozenHidden: false })).toBe(false);
  });
  it("面板已关（closed）→ 忽略 frozen，按基础判据", () => {
    expect(capsuleHiddenFor({ ...base, keyboardOpen: true, dockPanelPhase: "closed", frozenHidden: false })).toBe(true);
    expect(capsuleHiddenFor({ ...base, keyboardOpen: false, dockPanelPhase: "closed", frozenHidden: true })).toBe(false);
  });
});