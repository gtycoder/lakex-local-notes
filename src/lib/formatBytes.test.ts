/**
 * 体积格式化：两个口径的**格式钉死**测试（B1，261016）。
 *
 * 背景：`formatBytes` 曾有三份实现——设置页（到 MB / 恒一位小数）、同步浮窗（到 GB / 大值取整）、
 * 移动端设置页（与设置页逐字等价）。现在收敛为**两个函数、各一份实现**。
 * 本测试**故意写死字面量**（不复用实现输出），并且专门钉住两者的差异边界——
 * 一旦有人把两个口径合并，这里立刻红。
 */
import { describe, expect, it } from "vitest";
import { formatBytes, formatBytesCompact } from "./formatBytes.js";

describe("formatBytes（设置页读数口径：只到 MB、恒一位小数）", () => {
  it("按 B / KB / MB 分档，且不引入 GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1024.0 MB");
  });

  it("大值不取整、始终一位小数（读数稳定，便于对比）", () => {
    expect(formatBytes(200 * 1024)).toBe("200.0 KB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200.0 MB");
  });
});

describe("formatBytesCompact（同步读数口径：可到 GB、大值取整）", () => {
  it("缺失/非正数统一 0 B", () => {
    expect(formatBytesCompact(undefined)).toBe("0 B");
    expect(formatBytesCompact(0)).toBe("0 B");
    expect(formatBytesCompact(-5)).toBe("0 B");
  });

  it("按 B / KB / MB / GB 分档", () => {
    expect(formatBytesCompact(512)).toBe("512 B");
    expect(formatBytesCompact(1023)).toBe("1023 B");
    expect(formatBytesCompact(1024)).toBe("1.0 KB");
    expect(formatBytesCompact(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  it("≥100 取整、<100 保留一位小数（一眼看量级）", () => {
    expect(formatBytesCompact(99 * 1024)).toBe("99.0 KB");
    expect(formatBytesCompact(100 * 1024)).toBe("100 KB");
    expect(formatBytesCompact(200 * 1024)).toBe("200 KB");
  });

  it("单位阶梯封顶在 GB（不造 TB 档）", () => {
    expect(formatBytesCompact(2048 * 1024 ** 3)).toBe("2048 GB");
  });
});

describe("两个口径必须保持可区分（防止被误合并）", () => {
  it("同一输入在两个口径下给出不同的展示", () => {
    expect(formatBytes(200 * 1024)).toBe("200.0 KB");
    expect(formatBytesCompact(200 * 1024)).toBe("200 KB");
    expect(formatBytes(1024 ** 3)).toBe("1024.0 MB");
    expect(formatBytesCompact(1024 ** 3)).toBe("1.0 GB");
  });
});
