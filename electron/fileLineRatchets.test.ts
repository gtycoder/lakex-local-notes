/**
 * 大文件行数棘轮（C-04 / C-06，防搬完又长回去）：只许降、不许涨。
 * main.ts < 620：批次 B 装配外迁后的入口上限（docs/arch/ELECTRON-LAYERING-AUDIT.md §5 批次 B；
 * 审计 C-04 定数）。store.ts < 1930：C-06 三族抽后实测 1899 + 少量余量。
 * 为什么不追审计原定 <1600：三族（同步账本/缺正文/设置直通）全抽后仍差 180+ 行，
 * 再减只能拆 20+ 协作类门面 —— 收益不成比例，按 AGENTS §3#17 已否（261205 lead 裁决同口径）。
 * 防回涨语义：文件再长大先找「是不是该抽协作类/装配块」，不要只调棘轮数字。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const linesOf = (rel: string) => fs.readFileSync(path.join(ELECTRON_DIR, rel), "utf8").split(/\r?\n/).length;

describe("大文件行数棘轮（只降不涨）", () => {
  it("electron/main.ts < 620（C-04 批次 B 装配外迁后的入口上限）", () => {
    expect(linesOf("main.ts"), "main.ts 又长回去了：装配块请放 boot/|window/，单例与退出闸留入口").toBeLessThan(620);
  });

  it("electron/store.ts < 1930（C-06 三族抽后实测 1899）", () => {
    expect(linesOf("store.ts"), "store.ts 又长回去了：真逻辑请放协作类（见 store.ts 头注释的协作类清单）").toBeLessThan(1930);
  });
});
