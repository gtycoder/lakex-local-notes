// @vitest-environment jsdom
/**
 * 移动端错误边界（261105）：局部隔离 + 真重试 + 复制诊断。
 * 判据：抛错只影响自己这一层；兄弟节点照常渲染；「重试」重建子树后能恢复。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
vi.mock("./toastBus", () => ({ showToast: toast }));

import { clearCrashLog, readCrashLog } from "../lib/crashLog";
import { MobileErrorBoundary } from "./MobileErrorBoundary";

let shouldThrow = true;

function Flaky(): React.ReactElement {
  if (shouldThrow) throw new Error("内核渲染挂了");
  return <div data-testid="ok">已恢复</div>;
}

interface Mounted { container: HTMLElement; root: Root }
const mounted: Mounted[] = [];

async function mount(node: React.ReactElement): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(node); });
  const item = { container, root };
  mounted.push(item);
  return item;
}

const clickByText = async (container: HTMLElement, text: string): Promise<void> => {
  const button = [...container.querySelectorAll("button")].find((el) => (el.textContent ?? "").trim() === text);
  expect(button).toBeTruthy();
  await act(async () => { (button as HTMLButtonElement).click(); });
};

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

beforeEach(() => {
  shouldThrow = true;
  clearCrashLog();
  toast.mockClear();
});

describe("MobileErrorBoundary", () => {
  it("子组件抛错 → 只显示本层失败占位，兄弟节点不受影响", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = await mount(
      <div>
        <span data-testid="sibling">别的视图</span>
        <MobileErrorBoundary scope="workspace" title="工作区崩了">
          <Flaky />
        </MobileErrorBoundary>
      </div>,
    );
    spy.mockRestore();
    expect(m.container.querySelector('[data-testid="sibling"]')!.textContent).toBe("别的视图");
    expect(m.container.textContent).toContain("工作区崩了");
    expect(m.container.textContent).toContain("已隔离");
    expect(m.container.textContent).toContain("内核渲染挂了");
    // 掉落崩溃记录（scope 带隔离域），供复制诊断/排障
    expect(readCrashLog()[0]).toMatchObject({ scope: "boundary:workspace", message: "内核渲染挂了" });
  });

  it("点「重试」重建子树：子组件不再抛错时恢复正常内容", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = await mount(<MobileErrorBoundary scope="settings"><Flaky /></MobileErrorBoundary>);
    expect(m.container.textContent).toContain("这一段加载失败");
    shouldThrow = false;
    await clickByText(m.container, "重试");
    spy.mockRestore();
    expect(m.container.querySelector('[data-testid="ok"]')!.textContent).toBe("已恢复");
    expect(m.container.textContent).not.toContain("已隔离");
  });

  it("复制诊断：把隔离域/错误/最近崩溃记录写进剪贴板", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = await mount(<MobileErrorBoundary scope="ai"><Flaky /></MobileErrorBoundary>);
    await clickByText(m.container, "复制诊断");
    spy.mockRestore();
    const write = navigator.clipboard.writeText as unknown as { mock: { calls: string[][] } };
    const text = write.mock.calls[write.mock.calls.length - 1][0];
    expect(text).toContain("隔离域：ai");
    expect(text).toContain("内核渲染挂了");
    expect(toast).toHaveBeenCalled();
  });
});
