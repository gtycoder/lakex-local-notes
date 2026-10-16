/**
 * 领域仓储能力矩阵的**对账测试**（C2-3，261016）。
 *
 * 它守四件事：
 *   ① 表里登记的**移动端实现**真实存在；
 *   ② 表里登记的**桌面方法**真实存在（null 表示"桌面无同类"，不算缺失）；
 *   ③ **移动端仓储文件的每个导出函数都登记过**（新加一个仓储能力不登记 ⇒ 红 —— 这是真正的漂移检测）；
 *   ④ `DESKTOP_ONLY` 的每一项确实"桌面有、移动端没有"（防两处登记/虚报）。
 *
 * 能力边界（不夸大）：这是**存在性对账**，不是编译期类型约束——因为两端签名不可直接统一（见模块头注释）。
 * "同一个能力的语义是否真的一致"仍需读 note 列与实机验证；本测试只保证"该有的实现没被悄悄删掉/改名，
 * 新能力不会只落一端"。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_ONLY_CAPABILITIES,
  MOBILE_REPOSITORY_FILES,
  REPOSITORY_CAPABILITIES,
} from "./repositoryCapabilities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRead = (rel: string) => readFileSync(path.join(ROOT, "src", rel), "utf8");

/** 桌面实现面 = electron/store.ts 的 Store 类方法名。 */
const storeMethods = new Set(
  [...readFileSync(path.join(ROOT, "electron", "store.ts"), "utf8").matchAll(/^  (?:async )?([a-zA-Z][A-Za-z0-9_]*)\(/gm)].map((m) => m[1]),
);

const mobileExports = (file: string): string[] =>
  [...srcRead(file).matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);

describe("领域仓储能力矩阵（C2-3）", () => {
  it("① 每条能力的移动端实现真实存在（改函数名必须同步改表）", () => {
    const bad: string[] = [];
    for (const row of REPOSITORY_CAPABILITIES) {
      if (!mobileExports(row.mobile.file).includes(row.mobile.fn)) {
        bad.push(row.capability + " → " + row.mobile.file + " 里找不到 " + row.mobile.fn);
      }
    }
    expect(bad, "以下登记项在移动端找不到（函数被改名/删除后必须同步改表）：\n  " + bad.join("\n  ")).toEqual([]);
  });

  it("② 每条能力的桌面对应方法真实存在（desktop=null 表示桌面无同类，不算缺失）", () => {
    const bad = REPOSITORY_CAPABILITIES
      .filter((row) => row.desktop !== null && !storeMethods.has(row.desktop))
      .map((row) => row.capability + " → Store." + row.desktop);
    expect(bad, "以下登记项在 electron/store.ts 的 Store 里找不到：\n  " + bad.join("\n  ")).toEqual([]);
  });

  it("③ 移动端仓储文件的导出函数必须全部登记（新能力只落一端 ⇒ 红）", () => {
    const files = MOBILE_REPOSITORY_FILES as readonly string[];
    const registered = new Set(
      REPOSITORY_CAPABILITIES.filter((row) => files.includes(row.mobile.file)).map((row) => row.mobile.file + "::" + row.mobile.fn),
    );
    const missing: string[] = [];
    for (const file of files) {
      for (const fn of mobileExports(file)) {
        if (!registered.has(file + "::" + fn)) missing.push(file + " → " + fn);
      }
    }
    expect(missing, "以下移动端仓储函数没有登记进 REPOSITORY_CAPABILITIES（登记时请补 desktop 对应与差异说明）：\n  " + missing.join("\n  ")).toEqual([]);
  });

  it("④ core 判据字段指向的文件真实存在", () => {
    const bad = REPOSITORY_CAPABILITIES
      .filter((row) => row.core !== undefined && !existsSync(path.join(ROOT, "src", row.core)))
      .map((row) => row.capability + " → " + row.core);
    expect(bad, "以下 core 判据路径不存在：\n  " + bad.join("\n  ")).toEqual([]);
  });

  it("⑤ DESKTOP_ONLY 的每一项确实“桌面有、移动端没有”（防两处登记/虚报）", () => {
    const mobileAll = new Set(MOBILE_REPOSITORY_FILES.flatMap((f) => mobileExports(f)));
    const bad: string[] = [];
    for (const row of DESKTOP_ONLY_CAPABILITIES) {
      for (const name of row.desktop.split(" / ")) {
        if (!storeMethods.has(name)) bad.push("桌面并不存在：Store." + name);
        if (mobileAll.has(name)) bad.push("移动端其实有同名函数，不该列进 DESKTOP_ONLY：" + name);
      }
    }
    expect(bad, "DESKTOP_ONLY 差集表有虚报：\n  " + bad.join("\n  ")).toEqual([]);
  });

  it("⑥ 矩阵规模钉死（防止无声增删）", () => {
    expect(REPOSITORY_CAPABILITIES.length, "交集行数变了 ⇒ 请确认是有意的并在 commit 里说明").toBe(34);
    const withDesktop = REPOSITORY_CAPABILITIES.filter((row) => row.desktop !== null).length;
    expect(withDesktop, "桌面有对应实现的行数（当前 28；其余是桌面无同类方法或判据在 core）").toBe(28);
  });
});
