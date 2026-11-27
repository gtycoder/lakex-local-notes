// @vitest-environment jsdom
/**
 * 「加密文本」卡视觉形态（261127 用户点单，参照思源加密块：外框保留、内部去线条）。
 *
 * 这里只钉**可静态渲染的三种态**的结构与文案（设置密码 / 已加密待解锁 / 格式不可识别）：
 *   · 设置密码处必须出现「丢失后无法找回」（安全红线：没有找回、没有托管）；
 *   · 已加密未解锁不显示标题行（插画 + 解锁行居中）；
 *   · 解锁态 = 标题行 + 无框正文 + 无框文字动作。
 * 加解密与「明文不进正文模型」由 lockedTextCard.test.ts / core 测试钉，不在本文件。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LockedTextCipher } from "../../core/lockedText";
import { lockedTextCardConfig } from "./lockedTextCard";

/** 结构合法的密文（只用于让 UI 进「已加密」态，不参与解密）。 */
const CIPHER: LockedTextCipher = {
  v: 1,
  alg: "A256GCM",
  kdf: "PBKDF2-SHA256",
  iter: 210_000,
  salt: "A".repeat(22),
  iv: "A".repeat(16),
  ct: "A".repeat(24),
};

type CardProps = { cardValue?: unknown; updateCardValue?: () => void };
const Editor = lockedTextCardConfig.editorComponent as unknown as (props: CardProps) => JSX.Element;
const Viewer = lockedTextCardConfig.viewerComponent as unknown as (props: CardProps) => JSX.Element;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const render = (node: JSX.Element): HTMLElement => {
  act(() => { root.render(node); });
  return host;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe("加密文本卡：设置密码态", () => {
  it("插画 + 一行说明 + 竖排密码框 + 主操作；说明里必须写明丢失后无法找回", () => {
    const el = render(createElement(Editor, { cardValue: undefined, updateCardValue: () => undefined }));
    const card = el.querySelector(".lake-locked-text")!;
    expect(card.getAttribute("data-phase")).toBe("setup");
    expect(card.querySelector(".lake-locked-text__mark")).not.toBeNull();
    expect(card.querySelector(".lake-locked-text__lead")?.textContent).toContain("丢失后无法找回");
    const fields = [...card.querySelectorAll<HTMLInputElement>(".lake-locked-text__field")];
    expect(fields).toHaveLength(2);
    expect(fields.map((f) => f.type)).toEqual(["password", "password"]);
    expect(fields.map((f) => f.getAttribute("aria-label"))).toEqual(["设置密码", "再次输入密码"]);
    const primary = card.querySelector(".lake-locked-text__btn--primary");
    expect(primary?.textContent).toBe("确认");
    // 设置密码态不出标题行（标题行只给「已解锁 / 格式异常 / 查看器的未设置」）
    expect(card.querySelector(".lake-locked-text__head")).toBeNull();
  });
});

describe("加密文本卡：已加密未解锁态", () => {
  it("不显示标题行，插画 + 一行解锁（输入 + 解锁按钮）", () => {
    const el = render(createElement(Editor, { cardValue: CIPHER, updateCardValue: () => undefined }));
    const card = el.querySelector(".lake-locked-text")!;
    expect(card.getAttribute("data-phase")).toBe("locked");
    expect(card.querySelector(".lake-locked-text__head")).toBeNull();
    expect(card.querySelector(".lake-locked-text__mark")).not.toBeNull();
    const field = card.querySelector<HTMLInputElement>(".lake-locked-text__unlock .lake-locked-text__field")!;
    expect(field.getAttribute("placeholder")).toBe("请输入密码");
    expect(card.querySelector(".lake-locked-text__unlock .lake-locked-text__btn--primary")?.textContent).toContain("解锁");
    // 查看器同样能输密码解锁（只读宿主不等同「不能看加密内容」）
    act(() => { root.render(createElement(Viewer, { cardValue: CIPHER })); });
    expect(host.querySelector(".lake-locked-text__unlock")).not.toBeNull();
  });
});

describe("加密文本卡：格式不可识别 / 查看器未设置", () => {
  it("坏值按「已原样保留」提示，不显示密码表单", () => {
    const el = render(createElement(Editor, { cardValue: { ct: "not/base64!!", salt: "x", iv: "y" }, updateCardValue: () => undefined }));
    const card = el.querySelector(".lake-locked-text")!;
    expect(card.getAttribute("data-phase")).toBe("broken");
    expect(card.querySelector(".lake-locked-text__title")?.textContent).toBe("加密文本");
    expect(card.querySelector(".lake-locked-text__note")?.textContent).toContain("格式无法识别");
    expect(card.querySelector(".lake-locked-text__field")).toBeNull();
  });

  it("查看器遇到未设置密码的卡：只给一句说明，不给设密码表单", () => {
    const el = render(createElement(Viewer, { cardValue: undefined }));
    const card = el.querySelector(".lake-locked-text")!;
    expect(card.getAttribute("data-mode")).toBe("view");
    expect(card.querySelector(".lake-locked-text__title")?.textContent).toBe("加密文本");
    expect(card.querySelector(".lake-locked-text__note")?.textContent).toContain("未设置密码");
    expect(card.querySelector(".lake-locked-text__field")).toBeNull();
  });
});
