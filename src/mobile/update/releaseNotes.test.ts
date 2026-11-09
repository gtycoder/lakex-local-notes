import { describe, expect, it } from "vitest";
import { parseReleaseNoteLines, parseReleaseNotes } from "./releaseNotes";

const FENCE = String.fromCharCode(96, 96, 96);
const RAW = [
  "# LakexLocalNotes 发布说明",
  "",
  "总述一行（应被丢弃）",
  "",
  "# LakexLocalNotes v1.0.5",
  "",
  "## 移动端",
  "",
  "- 支持应用内更新",
  "- 修复签名校验",
  "",
  "### 细节",
  "",
  "普通段落",
  "",
  FENCE,
  "adb install -r a.apk",
  FENCE,
  "",
  "# LakexLocalNotes v1.0.4",
  "",
  "- 旧版本条目",
].join("\n");

describe("更新日志解析", () => {
  it("按版本分组（文件新的在前），版本标题之前的总述丢弃", () => {
    const versions = parseReleaseNotes(RAW);
    expect(versions.map((v) => v.version)).toEqual(["1.0.5", "1.0.4"]);
    expect(versions[0].lines.some((line) => line.text === "支持应用内更新")).toBe(true);
    expect(versions[0].lines.some((line) => line.text === "总述一行（应被丢弃）")).toBe(false);
  });

  it("行类型：小节 / 条目 / 正文 / 代码块", () => {
    const versions = parseReleaseNotes(RAW);
    const kinds = versions[0].lines.map((line) => line.kind);
    expect(kinds).toContain("subheading");
    expect(kinds).toContain("bullet");
    expect(kinds).toContain("text");
    expect(kinds).toContain("code");
  });

  it("清单里的 notes（无版本标题）也能渲染成小节 + 条目", () => {
    const lines = parseReleaseNoteLines("## 更新内容\n- 支持应用内更新\n- 修复签名校验");
    expect(lines.map((line) => line.kind)).toEqual(["subheading", "bullet", "bullet"]);
    expect(lines[1].text).toBe("支持应用内更新");
  });

  it("坏输入不抛：空串返回空数组", () => {
    expect(parseReleaseNotes("")).toEqual([]);
    expect(parseReleaseNoteLines("")).toEqual([]);
  });
});
