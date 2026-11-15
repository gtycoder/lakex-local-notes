import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 移动端输入元数据契约（261115，MODERN-WEB-AUDIT A14）。
 *
 * 移动端每个「打字 + 回车提交」的输入框都要告诉软键盘回车键该显示什么：
 * 搜索 = search（放大镜/搜索键），命名/新建 = done（完成）。
 * 少了它，用户看到的是默认「换行」，按下去要么换行要么提交——两可都不对。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, "../.."); // HERE = src/mobile/ui ⇒ 仓 src 根
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");

/** 文件 → 期望的 enterKeyHint 值 */
const SITES: Record<string, string> = {
  "mobile/editor/MobileFindBar.tsx": "search",
  "mobile/settings/SearchSheet.tsx": "search",
  "mobile/ui/NameSheet.tsx": "done",
  "mobile/settings/CreateNotebookSheet.tsx": "done",
  "mobile/tags/TagsHomeTab.tsx": "done",
};

describe("移动端 enterKeyHint 契约（A14）", () => {
  it("搜索类输入是 search、命名类输入是 done", () => {
    const offenders: string[] = [];
    for (const [rel, hint] of Object.entries(SITES)) {
      const source = read(rel);
      if (!source.includes('enterKeyHint="' + hint + '"')) offenders.push(rel + " 缺 enterKeyHint=" + hint);
    }
    expect(offenders).toEqual([]);
  });
});
