import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 书签卡能力护栏（261114 四批）：
 * - 内核 v1.99.0 的 bookmark 卡**没有**原生 getCardToolbarConfig，工具条由 vendored 包装层
 *   BookmarkToolbar 自实现；我们不用 LakexEditor 包装层，所以必须在两个宿主自己挂载，
 *   否则卡就是「没有菜单、无法转换回链接/标题」的死卡。
 * - 粘贴期不得再把 bookmark 卡降级成普通链接（261112 的临时绕行，261114 用户改判撤销）。
 * - 语雀 INode 剪贴板里的 bookmark/bookmarkInline 卡必须有 INode 读取器（vendor 本地补丁）。
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("书签卡工具条与 INode 读取器护栏", () => {
  it("桌面 EditorTab 与移动 LakeEditor 都挂载了 BookmarkToolbar", () => {
    for (const file of ["./EditorTab.tsx", "./LakeEditor.tsx"]) {
      const src = read(file);
      expect(src).toMatch(/import \{ BookmarkToolbar \} from "@dlient\/lakex-doc-react"/);
      expect(src).toContain("<BookmarkToolbar");
      expect(src).toContain('language="zh-cn"');
    }
  });

  it("粘贴期不再把 bookmark 卡降级为普通链接（撤销 126e906f）", () => {
    const runtime = read("./lakeRuntime.ts");
    expect(runtime).not.toContain("installBookmarkCardDegrade");
    expect(runtime).not.toContain("__disposeBookmarkDegrade");
    const degrade = read("./kernelBookmarkDegrade.ts");
    expect(degrade).not.toContain("cardToLink");
    expect(degrade).not.toContain("installBookmarkCardDegrade");
  });

  it("vendor 暴露 BookmarkToolbar 并保留 bookmark/bookmarkInline 的 INode 读取器", () => {
    const dts = readFileSync(new URL("../../../vendor/lakex-doc-react/dist/index.d.ts", import.meta.url), "utf8");
    expect(dts).toContain("BookmarkToolbar");
    const lakex = readFileSync(new URL("../../../vendor/lakex-doc-react/src/components/lakex/lakex.js", import.meta.url), "utf8");
    // 语雀剪贴板卡读取器注册点
    expect(lakex).toContain("registerINodeCardReader(Gh.CardName, new Gh())");
    expect(lakex).toContain("registerINodeCardReader(Gv.CardName, new Gv())");
    // 本地补丁：块级/行内卡还原成真卡片（不是空 reader）
    expect(lakex).toMatch(/createCard\('bookmark', GA\.fromLake\(n, \{ type: Gy \}\)/);
    expect(lakex).toMatch(/createCard\('bookmarkInline', GA\.fromLake\(n, \{ type: Gb \}\)/);
  });
});
