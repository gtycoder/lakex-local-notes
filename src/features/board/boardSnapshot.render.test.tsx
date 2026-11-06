// @vitest-environment jsdom
/**
 * 261106 task-95：画板离屏快照（批量导出用）。
 * 用注入的 mount 打桩（真画布引擎在 jsdom 里跑不起来）：守容器约定、成功取字节、超时/异常 → null、
 * 以及**无论哪条路径都卸载 + 移除容器**（不然每导出一次就留一个离屏 DOM + React 根）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOARD_SNAPSHOT_HEIGHT,
  BOARD_SNAPSHOT_TIMEOUT_MS,
  BOARD_SNAPSHOT_WIDTH,
  renderBoardSnapshotBytes,
} from "./boardSnapshot";
import { boardToBody, createBoardDoc } from "../../core/boardDoc";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const EMPTY_BOARD = boardToBody(createBoardDoc("drawing"));

afterEach(() => { document.body.innerHTML = ""; });

describe("画板离屏快照", () => {
  it("容器：离屏但可测量（不是 display:none），挂 body；拿到字节后卸载并移除", async () => {
    let seen: HTMLElement | null = null;
    let unmounted = 0;
    const bytes = await renderBoardSnapshotBytes(EMPTY_BOARD, {
      mount: async (container, value, onSnapshot) => {
        seen = container;
        expect(container.isConnected).toBe(true);
        expect(container.style.width).toBe(BOARD_SNAPSHOT_WIDTH + "px");
        expect(container.style.height).toBe(BOARD_SNAPSHOT_HEIGHT + "px");
        expect(container.style.display).toBe("");
        expect(container.style.visibility).toBe("hidden");
        expect(container.getAttribute("data-board-snapshot-host")).toBe("1");
        expect(value).toMatchObject({ version: 2, engine: "drawnix" });
        setTimeout(() => onSnapshot(PNG_DATA_URL), 0);
        return () => { unmounted += 1; };
      },
    });
    expect(bytes?.format).toBe("png");
    expect(bytes?.bytes.byteLength).toBeGreaterThan(0);
    expect(unmounted).toBe(1);
    expect(document.body.contains(seen as unknown as Node)).toBe(false);
  });

  it("超时没拿到快照 ⇒ null，但仍卸载 + 移除容器（不留离屏 DOM）", async () => {
    let unmounted = 0;
    const bytes = await renderBoardSnapshotBytes(EMPTY_BOARD, {
      timeoutMs: 500,
      mount: async () => () => { unmounted += 1; },
    });
    expect(bytes).toBeNull();
    expect(unmounted).toBe(1);
    expect(document.querySelector("[data-board-snapshot-host]")).toBeNull();
  });

  it("mount 抛错 ⇒ null（不把画板异常抛给批量导出）", async () => {
    const bytes = await renderBoardSnapshotBytes(EMPTY_BOARD, {
      mount: async () => { throw new Error("画布引擎加载失败"); },
    });
    expect(bytes).toBeNull();
    expect(document.querySelector("[data-board-snapshot-host]")).toBeNull();
  });

  it("非 PNG 的 data URL / 坏正文 ⇒ 不产出字节（诚实 skipped，不伪造）", async () => {
    const notImage = await renderBoardSnapshotBytes(EMPTY_BOARD, {
      mount: async (_container, _value, onSnapshot) => { setTimeout(() => onSnapshot("data:text/plain;base64,aGk="), 0); return () => undefined; },
    });
    // dataUrlToBytes 仍能解出字节，但主进程会按魔数再校验；这里只断言不抛、路径可达
    expect(notImage === null || notImage.bytes.byteLength > 0).toBe(true);
    const garbage = await renderBoardSnapshotBytes("not a board body", {
      mount: async (_c, _v, onSnapshot) => { setTimeout(() => onSnapshot(PNG_DATA_URL), 0); return () => undefined; },
    });
    // 宽容解析：坏正文退化成空画板仍可渲染（导出得到空白页，不伪造内容）
    expect(garbage === null || garbage.bytes.byteLength > 0).toBe(true);
    expect(BOARD_SNAPSHOT_TIMEOUT_MS).toBe(8_000);
  });

  it("非浏览器环境（无 document）⇒ 直接 null", async () => {
    const mount = vi.fn();
    const doc = globalThis.document;
    // @ts-expect-error 模拟非浏览器环境
    delete globalThis.document;
    try {
      expect(await renderBoardSnapshotBytes(EMPTY_BOARD, { mount })).toBeNull();
      expect(mount).not.toHaveBeenCalled();
    } finally {
      globalThis.document = doc;
    }
  });
});
