import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, MAX_DOC_BODY_BYTES, MAX_IMAGE_BYTES } from "./storeLimits.js";
import { MAX_NOTE_CONTENT_BYTES } from "./ipcLimits.js";

/**
 * CORE-09：正文 / 附件 / 图片上限的单一来源。
 * ① 常量值不变（32 / 100 / 25 MiB）；② 旧入口只是别名；③ scope 内不得再出现裸字面量。
 */
const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const SCANNED_DIRS = [
  "src/core",
  "src/features/editor",
  "src/features/usheet",
  "src/mobile/usheet",
  "electron/ipc",
];
/** 只拦这三个「同一语义」的字面量；其他档位（16/20/64 MiB）各有自己的来源。 */
const FORBIDDEN = /(?:32|25|100) \* 1024 \* 1024/g;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    const relative = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(relative);
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name)) {
      yield relative;
    }
  }
}

describe("core/storeLimits（CORE-09）", () => {
  it("正文 / 附件 / 图片上限值与历史行为一致", () => {
    expect(MAX_DOC_BODY_BYTES).toBe(32 * 1024 * 1024);
    expect(MAX_ATTACHMENT_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_NOTE_CONTENT_BYTES).toBe(MAX_DOC_BODY_BYTES);
  });

  it("scope 内不再重复定义正文/附件/图片字节字面量", () => {
    const offenders: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(dir)) {
        if (file === "src/core/storeLimits.ts") continue;
        const source = readFileSync(join(REPO_ROOT, file), "utf8");
        for (const match of source.matchAll(FORBIDDEN)) {
          offenders.push(file + ": " + match[0]);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("编辑器图片校验引用 core 常量，不再自带一份", () => {
    const source = readFileSync(join(REPO_ROOT, "src/features/editor/imageFormat.ts"), "utf8");
    expect(source).toContain('from "../../core/storeLimits.js"');
    expect(source).not.toMatch(FORBIDDEN);
  });
});
