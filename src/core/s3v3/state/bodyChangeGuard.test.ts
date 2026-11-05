/**
 * P1-4 正文突变判据（纯函数）：区分「用户编辑」与「外部损坏/替换」。
 * 保守原则：拿不准就当正常编辑（宁可漏拦，不可误伤用户内容）。
 */
import { describe, expect, it } from "vitest";
import {
  SUSPICIOUS_BODY_SIZE_RATIO,
  isSuspiciousBodyChange,
  isUnexplainedBodyChange,
  looksLikeCorruptedBody,
} from "./bodyChangeGuard.js";

const T0 = "2026-11-01T00:00:00.000Z";
const T1 = "2026-11-02T00:00:00.000Z";

const facts = (over: Partial<Parameters<typeof isUnexplainedBodyChange>[0]> = {}) => ({
  baselineHash: "h0",
  baselineUpdatedAt: T0,
  localUpdatedAt: T0,
  localHash: "h1",
  ...over,
});

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe("isUnexplainedBodyChange（①基线有 + ②hash 变 + ③行没前进）", () => {
  it("行 updatedAt 未前进 + hash 变了 ⇒ 不可解释（可疑候选）", () => {
    expect(isUnexplainedBodyChange(facts())).toBe(true);
    expect(isUnexplainedBodyChange(facts({ localUpdatedAt: "2026-10-31T00:00:00.000Z" }))).toBe(true);
  });

  it("正常编辑（行 updatedAt 前进）⇒ 不可疑", () => {
    expect(isUnexplainedBodyChange(facts({ localUpdatedAt: T1 }))).toBe(false);
  });

  it("hash 没变 / 无基线 / 缺时间戳 ⇒ 不判（保守）", () => {
    expect(isUnexplainedBodyChange(facts({ localHash: "h0" }))).toBe(false);
    expect(isUnexplainedBodyChange(facts({ baselineHash: "" }))).toBe(false);
    expect(isUnexplainedBodyChange(facts({ baselineHash: null }))).toBe(false);
    expect(isUnexplainedBodyChange(facts({ baselineUpdatedAt: "" }))).toBe(false);
    expect(isUnexplainedBodyChange(facts({ localUpdatedAt: "" }))).toBe(false);
  });
});

describe("looksLikeCorruptedBody（③内容像坏了）", () => {
  it("空正文 / 全 NUL / 非 UTF-8 ⇒ 坏", () => {
    expect(looksLikeCorruptedBody(new Uint8Array(0))).toBe(true);
    expect(looksLikeCorruptedBody(new Uint8Array([0, 0, 0]))).toBe(true);
    expect(looksLikeCorruptedBody(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(true);
    // 合法 UTF-8 但夹 NUL：截断/填充的典型形态
    expect(looksLikeCorruptedBody(new Uint8Array([0x3c, 0x70, 0x3e, 0x00]))).toBe(true);
  });

  it("正常正文 ⇒ 不坏；bytes=null（缺正文）不在这里判", () => {
    expect(looksLikeCorruptedBody(bytesOf("<p>正常内容</p>"))).toBe(false);
    expect(looksLikeCorruptedBody(null)).toBe(false);
    expect(looksLikeCorruptedBody(undefined)).toBe(false);
  });

  it("给了上次大小才判「骤降」：≤ 10% 可疑，>10% 不判", () => {
    const body = bytesOf("<p>" + "x".repeat(200) + "</p>");
    expect(looksLikeCorruptedBody(bytesOf("<p>x</p>"), { previousSize: 100_000 })).toBe(true);
    expect(looksLikeCorruptedBody(body, { previousSize: body.length })).toBe(false);
    // 没给 previousSize ≥ 正常内容不受影响
    expect(looksLikeCorruptedBody(body)).toBe(false);
    expect(SUSPICIOUS_BODY_SIZE_RATIO).toBeCloseTo(0.1);
  });
});

describe("isSuspiciousBodyChange（合成判据）", () => {
  it("外部清空/写二进制 + 行没动 ⇒ suspicious", () => {
    expect(isSuspiciousBodyChange({ ...facts(), bytes: new Uint8Array(0) })).toBe(true);
    expect(isSuspiciousBodyChange({ ...facts(), bytes: new Uint8Array([0x00, 0x01, 0x02]) })).toBe(true);
  });

  it("正常编辑（行前进）即使内容合法也 ⇒ 不拦", () => {
    expect(isSuspiciousBodyChange({ ...facts({ localUpdatedAt: T1 }), bytes: bytesOf("<p>用户改的</p>") })).toBe(false);
  });

  it("行没动但内容是可解码文本（外部替换成别的文本）⇒ 不拦（不可区分，交给既有冲突路径）", () => {
    expect(isSuspiciousBodyChange({ ...facts(), bytes: bytesOf("<p>另一份合法文本</p>") })).toBe(false);
  });

  it("无基线 ⇒ 不拦（新设备/首拉没有「原来是什么」）", () => {
    expect(isSuspiciousBodyChange({ ...facts({ baselineHash: null }), bytes: new Uint8Array(0) })).toBe(false);
  });
});
