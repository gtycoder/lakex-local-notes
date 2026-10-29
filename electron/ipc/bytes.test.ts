import { describe, expect, it } from "vitest";
import { toUint8Array } from "./bytes.js";

describe("IPC 二进制入参归一（HTTP number[] / IPC Uint8Array）", () => {
  it("Uint8Array 原样返回", () => {
    const input = new Uint8Array([1, 2, 3]);
    expect(toUint8Array(input)).toBe(input);
  });
  it("number[] → Uint8Array（Web 客户端 JSON 形态）", () => {
    expect(Array.from(toUint8Array([0, 127, 255])!)).toEqual([0, 127, 255]);
  });
  it("ArrayBuffer / DataView 视图 → Uint8Array", () => {
    const buf = new Uint8Array([9, 8, 7]).buffer;
    expect(Array.from(toUint8Array(buf)!)).toEqual([9, 8, 7]);
    expect(Array.from(toUint8Array(new DataView(buf))!)).toEqual([9, 8, 7]);
  });
  it("非法输入 → null（越界/非整数/字符串/对象）", () => {
    expect(toUint8Array([256])).toBeNull();
    expect(toUint8Array([1.5])).toBeNull();
    expect(toUint8Array("abc")).toBeNull();
    expect(toUint8Array({ 0: 1 })).toBeNull();
    expect(toUint8Array(null)).toBeNull();
  });
});
