import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCKED_TEXT_CARD_META, LOCKED_TEXT_SLASH_ITEM, registerLockedTextCard, withLockedTextSlashItem } from "./lockedTextCard";
import { flushPendingLockedTextCommits, registerLockedTextFlush } from "./lockedTextFlush";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, "lockedTextCard.tsx"), "utf8");
const RUNTIME = readFileSync(path.join(HERE, "lakeRuntime.ts"), "utf8");

/**
 * 「加密文本」卡的**结构性护栏**（261023）：静态锁住"明文不许进正文模型"这条不变量，
 * 以及注册胶水（幂等 / 分组 / 接线顺序）。
 */
describe("加密文本卡：明文不许进文档模型", () => {
  it("卡片组件不调用任何把内容写进正文的内核命令", () => {
    for (const forbidden of ["setDocument(", "insertAtPosition(", "execCommand(", "editor.writeData", "editor.readData"]) {
      expect(SOURCE, `卡片组件出现 ${forbidden}：明文可能被写进正文`).not.toContain(forbidden);
    }
  });

  it("每处 updateCardValue 的入参都来自密文（含可选的 ?. 卸载补写路径）", () => {
    const lines = SOURCE.split("\n");
    // 允许 updateCardValue( 与 updateCardValue?.( 两种形式 —— 后者是之前漏检的卸载补写
    const calls = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter((entry) => /updateCardValue\??\.\(/.test(entry.line));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const windowLines = lines.slice(Math.max(0, call.index - 12), call.index + 1).join("\n");
      const fromCipher = /(sealLockedText|encryptLockedText)[\s\S]*updateCardValue\??\.\(cipher\)/.test(windowLines) || /updateCardValue\??\.\(cipher\)/.test(call.line);
      expect(fromCipher, `第 ${call.index + 1} 行的 updateCardValue 入参不是 cipher：${call.line}`).toBe(true);
    }
  });

  it("core 里的落盘值只允许密文字段（不允许出现明文/密码字段名）", () => {
    const core = readFileSync(path.resolve(HERE, "../../core/lockedText.ts"), "utf8");
    const valueInterface = core.slice(core.indexOf("export interface LockedTextCipher"), core.indexOf("export type LockedTextKind"));
    for (const field of ["v:", "alg:", "kdf:", "iter:", "salt:", "iv:", "ct:"]) expect(valueInterface).toContain(field);
    for (const forbidden of ["plain", "password", "originData"]) expect(valueInterface.toLowerCase()).not.toContain(`${forbidden}:`);
  });

  it("复制/导出只给占位（永不返回明文）", () => {
    expect(LOCKED_TEXT_CARD_META.writeText()).toBe("［加密文本］");
    expect(LOCKED_TEXT_CARD_META.writeHtml()).toContain("［加密文本］");
    expect(LOCKED_TEXT_CARD_META.name).toBe("lake-locked-text");
  });
});

describe("加密文本卡：注册胶水", () => {
  it("registerLockedTextCard 幂等、无 customCard 时早退", () => {
    const config: Record<string, unknown> = { customCard: { cards: [] } };
    registerLockedTextCard(config);
    registerLockedTextCard(config);
    const cards = (config.customCard as { cards: Array<{ config: { name: string } }> }).cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].config.name).toBe("lake-locked-text");
    expect(() => registerLockedTextCard({})).not.toThrow();
  });

  it("withLockedTextSlashItem 只动「小工具」组，且幂等", () => {
    const groups = [
      { title: "小工具", name: "group-files", items: ["calendar"] },
      { title: "别的", name: "other", items: [] },
    ];
    const once = withLockedTextSlashItem(groups) as Array<{ title: string; items: string[] }>;
    expect(once[0].items).toContain(LOCKED_TEXT_SLASH_ITEM);
    expect(once[1].items).toEqual([]);
    const twice = withLockedTextSlashItem(once) as Array<{ items: string[] }>;
    expect(twice[0].items.filter((item) => item === LOCKED_TEXT_SLASH_ITEM)).toHaveLength(1);
  });

  it("lakeRuntime 接线：注册在 prepareCustomCards 之前，两处斜杠分组都注入", () => {
    const registerIndex = RUNTIME.indexOf("registerLockedTextCard(mergedOptions)");
    const prepareIndex = RUNTIME.indexOf("prepareCustomCards(mergedOptions)");
    expect(registerIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(registerIndex);
    expect(RUNTIME.match(/withLockedTextSlashItem\(/g) ?? []).toHaveLength(2);
  });
});

describe("加密文本卡：生命周期补写注册表（评审 B1）", () => {
  it("有 pending 时 flush 返回 true（调用方据此强制 persist），注销后不再触发", async () => {
    let calls = 0;
    const unregister = registerLockedTextFlush(async () => { calls += 1; return true; });
    await expect(flushPendingLockedTextCommits()).resolves.toBe(true);
    expect(calls).toBe(1);
    unregister();
    await expect(flushPendingLockedTextCommits()).resolves.toBe(false);
    expect(calls).toBe(1);
  });

  it("单张卡 flush 抛错不阻断其它卡", async () => {
    const unregisterBad = registerLockedTextFlush(async () => { throw new Error("boom"); });
    let good = 0;
    const unregisterGood = registerLockedTextFlush(async () => { good += 1; return true; });
    await expect(flushPendingLockedTextCommits()).resolves.toBe(true);
    expect(good).toBe(1);
    unregisterBad();
    unregisterGood();
  });
});
