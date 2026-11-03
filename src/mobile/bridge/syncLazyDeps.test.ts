/**
 * P9-1 护栏：bridge/sync 的 v3 重依赖必须保持「按需加载」。
 *
 * 背景（261103 P9）：bridge.ts 静态展开 syncDomain ⇒ sync.ts 的静态依赖全部进首屏 preload 图。
 * 本测试只钉「静态边界」：重依赖不得以 import ... from 出现（import type 不算 —— 类型会被擦除），
 * 且必须仍有对应 import("...") 动态点，防止「删掉了但功能也没接上」。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./sync.ts", import.meta.url), "utf8");

/** 必须按需加载的 specifier（静态 import 一旦命中就失败；动态 import 必须存在）。 */
const HEAVY_SPECIFIERS = [
  "../v3/s3v3Remote.js",
  "../v3/mobileDeviceStore.js",
  "../v3/sync.js",
  "../../core/s3v3Engine.js",
  "../../core/s3v3Transfer.js",
  "../../core/s3v3AssetBackfill.js",
  "../../core/s3v3/protocol/s3v3Keys.js",
  "../../core/s3v3/protocol/s3v3Index.js",
];

/** 只取值导入（跳过 import type）。 */
function staticValueImports(source: string): string[] {
  const out: string[] = [];
  const re = /^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

describe("bridge/sync 重依赖按需加载（P9-1）", () => {
  it("v3 远端/设备存储/引擎/传输/协议常量不得静态 import", () => {
    const specs = staticValueImports(SRC);
    for (const spec of specs) {
      expect(HEAVY_SPECIFIERS, "静态 import 了重依赖：" + spec).not.toContain(spec);
    }
  });

  it("重依赖仍以动态 import 出现（功能不能只删不接）", () => {
    for (const spec of HEAVY_SPECIFIERS) {
      expect(SRC).toContain('import("' + spec + '")');
    }
  });
});
