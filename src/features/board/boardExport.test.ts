import { describe, expect, it } from "vitest";
import {
  dataUrlToBytes,
  exportBoardImage,
  hasBoardBytesProvider,
  readBoardBytes,
  registerBoardBytes,
  registerBoardExport,
  triggerBoardExport,
  type BoardExportHost,
} from "./boardExport.js";

class FakeButton {
  clicked = 0;
  constructor(public textContent: string) {}
  click() { this.clicked += 1; }
}

function fakeHost(options: { withTrigger?: boolean; withMenu?: boolean } = {}) {
  const triggerButton = new FakeButton("导出");
  const svg = new FakeButton("导出 SVG");
  const png = new FakeButton("导出 PNG");
  const host: BoardExportHost = {
    querySelector: (selector) => (options.withTrigger !== false && selector.includes("lakex-drawnix-export__trigger") ? triggerButton : null),
    querySelectorAll: () => (options.withMenu === false ? [] : [svg, png]),
  };
  return { host, triggerButton, svg, png };
}

describe("画板导出接线", () => {
  it("未登记 ⇒ false；登记后触发对应格式；注销后恢复 false", async () => {
    expect(await exportBoardImage("missing", "png")).toBe(false);
    const { host, svg } = fakeHost();
    const off = registerBoardExport("b1", (format) => triggerBoardExport(host, format));
    expect(await exportBoardImage("b1", "svg")).toBe(true);
    expect(svg.clicked).toBe(1);
    off();
    expect(await exportBoardImage("b1", "svg")).toBe(false);
  });

  it("按文案选目标格式，不依赖菜单顺序", async () => {
    const pngHost = fakeHost();
    expect(await triggerBoardExport(pngHost.host, "png")).toBe(true);
    expect(pngHost.png.clicked).toBe(1);
    expect(pngHost.svg.clicked).toBe(0);
    const svgHost = fakeHost();
    expect(await triggerBoardExport(svgHost.host, "svg")).toBe(true);
    expect(svgHost.svg.clicked).toBe(1);
  });

  it("没有导出按钮 / 菜单没弹出来 ⇒ false，并把菜单再点一次收起", async () => {
    expect(await triggerBoardExport(fakeHost({ withTrigger: false }).host, "png")).toBe(false);
    const noMenu = fakeHost({ withMenu: false });
    expect(await triggerBoardExport(noMenu.host, "png")).toBe(false);
    expect(noMenu.triggerButton.clicked).toBe(2);
    expect(noMenu.png.clicked).toBe(0);
    expect(await triggerBoardExport(null, "png")).toBe(false);
  });

  it("画板字节提供者：注册→读取 PNG 字节；注销后读不到；provider 抛错返回 null", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const off = registerBoardBytes("board-1", async () => ({ bytes: png, format: "png" }));
    expect(hasBoardBytesProvider("board-1")).toBe(true);
    expect(await readBoardBytes("board-1")).toEqual({ bytes: png, format: "png" });
    off();
    expect(hasBoardBytesProvider("board-1")).toBe(false);
    expect(await readBoardBytes("board-1")).toBeNull();
    const offThrow = registerBoardBytes("board-2", async () => { throw new Error("画板已卸载"); });
    expect(await readBoardBytes("board-2")).toBeNull();
    offThrow();
    const offNull = registerBoardBytes("board-3", async () => null);
    expect(await readBoardBytes("board-3")).toBeNull();
    offNull();
  });

  it("dataUrlToBytes：base64 / utf8 / 非法三种情况", () => {
    expect(Array.from(dataUrlToBytes("data:image/png;base64,AAECAw==") ?? [])).toEqual([0, 1, 2, 3]);
    expect(new TextDecoder().decode(dataUrlToBytes("data:image/svg+xml,%3Csvg%2F%3E") ?? new Uint8Array())).toBe("<svg/>");
    expect(dataUrlToBytes("not-a-data-url")).toBeNull();
    expect(dataUrlToBytes(null)).toBeNull();
  });

  it("getter 抛错时 exportBoardImage 吞掉异常返回 false（不把画板异常抛给导出动作）", async () => {
    const off = registerBoardExport("b2", async () => { throw new Error("boom"); });
    expect(await exportBoardImage("b2", "png")).toBe(false);
    off();
  });
});
