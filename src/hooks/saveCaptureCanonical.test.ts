import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 261118「云端端口 ≠ 本机端口会不会触发同步更新」的接线护栏。
 *
 * 两道收口缺一不可：
 * ① 渲染层捕获（useSavePipelineGlue.handleCaptureContent）必须对**所有**正文来源做 stripAssetAccessToken——
 *    不只是 Lake 编辑器 fallback，注册 capture（表格/多维表/画板/手写板）也要；
 * ② 主进程 saveNote 是所有用户写路径的共同收口，必须再调 canonicalizeNoteAssetUrls 兜底。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("正文保存前的资产 URL 规范化（端口无关）", () => {
  it("渲染层：注册 capture 与 Lake fallback 都 strip", () => {
    const src = read("./useSavePipelineGlue.ts");
    expect(src).toContain("import { stripAssetAccessToken }");
    // 注册 capture 分支必须包一层 strip（此前只对 Lake 实例做）
    expect(src).toMatch(/if \(typeof body === "string"\) return stripAssetAccessToken\(body\);/);
    expect(src).toContain('return stripAssetAccessToken(editor.getDocument("text/lake"));');
  });

  it("主进程：saveNote 路径调用 canonicalizeNoteAssetUrls（幂等收口）", () => {
    const store = read("../../electron/store.ts");
    expect(store).toContain('import { canonicalizeNoteAssetUrls } from "../src/core/assetUrl.js";');
    expect(store).toContain("const canonicalContent = canonicalizeNoteAssetUrls(content);");
    expect(store).toContain("this.noteContent.save(id, title, canonicalContent");
    // 同步镜像写入必须保留远端字节（不能归一化，否则远端内容被本机改写）
    const synced = store.slice(store.indexOf("saveSyncedNote("), store.indexOf("saveSyncedNote(") + 400);
    expect(synced).not.toContain("canonicalizeNoteAssetUrls");
  });
});
