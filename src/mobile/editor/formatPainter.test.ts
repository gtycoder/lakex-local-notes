import { describe, expect, it, vi } from "vitest";
import { FORMAT_PAINT_SERVICE_TOKEN, beginFormatPainter, formatPaintService } from "./formatPainter";

function fakeEditor(service: unknown, getServiceImpl?: (token: unknown) => unknown) {
  return {
    renderer: { getService: getServiceImpl ?? ((token: unknown) => (token === FORMAT_PAINT_SERVICE_TOKEN ? service : null)) },
  } as never;
}

describe("formatPaintService（内核服务取件）", () => {
  it("token 与内核 hub 的键一致（getService 读 token.value）", () => {
    expect(FORMAT_PAINT_SERVICE_TOKEN.value).toBe("IFormatRenderService");
  });

  it("service 缺失（renderer 没有 getService）时返回 null", () => {
    expect(formatPaintService(null)).toBeNull();
    expect(formatPaintService({} as never)).toBeNull();
  });

  it("getService 抛错时静默返回 null（不阻断面板）", () => {
    const editor = fakeEditor(null, () => { throw new Error("boom"); });
    expect(formatPaintService(editor)).toBeNull();
  });

  it("返回的对象没有 recordPaintFormat 时视为不可用（防止同 id 的其它服务）", () => {
    expect(formatPaintService(fakeEditor({}))).toBeNull();
  });
});

describe("beginFormatPainter（记录 / 取消 / 不可用）", () => {
  it("未在刷形态 → recordPaintFormat(true)，返回 recorded", () => {
    const record = vi.fn();
    const service = { recordPaintFormat: record, hasPaintFormat: () => false };
    expect(beginFormatPainter(fakeEditor(service))).toBe("recorded");
    expect(record).toHaveBeenCalledWith(true);
  });

  it("已在刷形态 → clearPaintFormat，返回 cancelled（再次点同一颗按钮 = 取消）", () => {
    const clear = vi.fn();
    const record = vi.fn();
    const service = { recordPaintFormat: record, hasPaintFormat: () => true, clearPaintFormat: clear };
    expect(beginFormatPainter(fakeEditor(service))).toBe("cancelled");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });

  it("服务不可用 → unavailable（调用方兜底，不抛错）", () => {
    expect(beginFormatPainter(fakeEditor(null))).toBe("unavailable");
    expect(beginFormatPainter(null)).toBe("unavailable");
  });
});
