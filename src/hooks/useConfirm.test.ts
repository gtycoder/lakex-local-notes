// @vitest-environment jsdom
/**
 * useConfirm 行为护栏（261027 DT-02）：`window.confirm` / `window.alert` 的替代原语。
 *
 * 桌面 UI 此前零执行级测试（审计 DT-04），而这里锁的正是**最容易被改坏**的四条语义：
 * · confirm 点确认 = true、点取消 = false；
 * · 关闭 / Esc / 点遮罩 = 取消（与 Overlay.Dialog 的 onDismiss 同一条路，不另写一套）；
 * · notice 只有「知道了」一个按钮，读没读都算收尾（不能让 await 方悬着）；
 * · 不可逆动作的确认按钮带危险色（.ln-btn--danger-text）。
 */
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useConfirm, type ConfirmController, type ConfirmOptions } from "./useConfirm";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const apiRef: { current: ConfirmController | null } = { current: null };

function Harness() {
  const controller = useConfirm();
  useEffect(() => { apiRef.current = controller; });
  return createElement(Fragment, null, controller.confirmElement);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  apiRef.current = null;
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const dialogTitle = () => document.querySelector(".ln-dialog__title")?.textContent;
const dialogBody = () => document.querySelector(".ln-dialog__body")?.textContent;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>(".ln-dialog__actions button")];

/** 打开确认框，并记录 Promise 结果（box.value 在微任务后才有值）。 */
const openConfirm = (options: Partial<ConfirmOptions> = {}) => {
  const box: { value: boolean | undefined } = { value: undefined };
  act(() => {
    void apiRef.current!.confirm({ title: "测试确认", ...options }).then((value) => { box.value = value; });
  });
  return box;
};

describe("useConfirm：确认浮层（替代 window.confirm）", () => {
  it("点确认 → true；标题/正文/按钮文案来自调用方，危险动作带危险色", async () => {
    const box = openConfirm({ title: "清空回收站？", body: "此操作不可撤销。", confirmText: "清空回收站", danger: true });
    expect(dialogTitle()).toBe("清空回收站？");
    expect(dialogBody()).toBe("此操作不可撤销。");
    expect(buttons().map((button) => button.textContent)).toEqual(["取消", "清空回收站"]);
    expect(buttons()[1].className).toContain("ln-btn--danger-text");
    await act(async () => { buttons()[1].click(); });
    expect(box.value).toBe(true);
    expect(document.querySelector(".ln-dialog")).toBeNull();
  });

  it("点取消 → false", async () => {
    const box = openConfirm();
    expect(buttons().map((button) => button.textContent)).toEqual(["取消", "确定"]);
    await act(async () => { buttons()[0].click(); });
    expect(box.value).toBe(false);
    expect(document.querySelector(".ln-dialog")).toBeNull();
  });

  it("Esc = 取消", async () => {
    const box = openConfirm();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(box.value).toBe(false);
    expect(document.querySelector(".ln-dialog")).toBeNull();
  });

  it("点遮罩 = 取消", async () => {
    const box = openConfirm();
    const scrim = document.querySelector(".ln-scrim");
    expect(scrim).not.toBeNull();
    await act(async () => {
      scrim!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(box.value).toBe(false);
    expect(document.querySelector(".ln-dialog")).toBeNull();
  });

  it("同一时刻只留一个：后到的请求让前一个按取消收尾（不留看不见的悬空 Promise）", async () => {
    let first: boolean | undefined;
    let second: boolean | undefined;
    act(() => { void apiRef.current!.confirm({ title: "第一个" }).then((value) => { first = value; }); });
    act(() => { void apiRef.current!.confirm({ title: "第二个" }).then((value) => { second = value; }); });
    await act(async () => {});
    expect(first).toBe(false);
    expect(second).toBeUndefined();
    expect(dialogTitle()).toBe("第二个");
  });
});

describe("useConfirm：提示浮层（替代 window.alert）", () => {
  it("只有「知道了」一个按钮，点它收尾", async () => {
    let resolved = false;
    act(() => { void apiRef.current!.notice({ title: "本地数据已隔离备份", body: "路径已记录。" }).then(() => { resolved = true; }); });
    expect(dialogTitle()).toBe("本地数据已隔离备份");
    expect(buttons().map((button) => button.textContent)).toEqual(["知道了"]);
    await act(async () => { buttons()[0].click(); });
    expect(resolved).toBe(true);
    expect(document.querySelector(".ln-dialog")).toBeNull();
  });

  it("Esc 关闭同样算读过（不卡住调用方）", async () => {
    let resolved = false;
    act(() => { void apiRef.current!.notice({ title: "提示" }).then(() => { resolved = true; }); });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(resolved).toBe(true);
    expect(document.querySelector(".ln-dialog")).toBeNull();
  });
});
