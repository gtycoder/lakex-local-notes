/**
 * 手写板「两端共享结构类名」的漂移护栏（261104 二十五批）。
 *
 * 移动端不引桌面样式（mobileIndependence 门禁），所以 mobile/ink/inkPad.shared.css 是
 * features/ink/inkPad.shared.css 的**副本**。副本漂移过一次：v4 的文字块/贴图规则只加在桌面侧，
 * 移动端文字框退化成无定位、无边框的默认 textarea（用户报「文字块样式有问题」）。
 *
 * 这里只钉**类名集合**（值允许不同：桌面 :hover / 移动端 :active 等触屏差异），漏同步即红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function classesOf(rel: string): string[] {
  const css = readFileSync(path.join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set<string>();
  for (const match of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(match[1]);
  return [...found].sort();
}

describe("手写板两端共享样式副本", () => {
  it("移动端副本与桌面共享文件的类名集合必须一致（只许触发方式不同）", () => {
    const desktop = classesOf("features/ink/inkPad.shared.css");
    const mobile = classesOf("mobile/ink/inkPad.shared.css");
    expect(mobile.filter((name) => !desktop.includes(name))).toEqual([]);
    expect(desktop.filter((name) => !mobile.includes(name))).toEqual([]);
  });
});
