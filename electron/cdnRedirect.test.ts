import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveMirroredCdnRedirect, scanMirroredCdnFiles } from "./cdnRedirect.js";

const mirrored = new Set([
  "os/lib/katex/0.16.8/dist/contrib/mhchem.min.js",
  "as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
]);
const lookup = (relativePath: string) => mirrored.has(relativePath);

describe("resolveMirroredCdnRedirect", () => {
  it("only redirects an asset that was explicitly mirrored", () => {
    expect(resolveMirroredCdnRedirect(
      "https://gw.alipayobjects.com/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
      19876,
      lookup,
    )).toBe("http://127.0.0.1:19876/vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js");
  });

  it("leaves user-pasted gw skylark images on the remote origin", () => {
    expect(resolveMirroredCdnRedirect(
      "https://gw.alipayobjects.com/zos/skylark/d4945fab-08d3-4087-8758-a80d0b8343a0/2018/png/8773815d-491b-4a00-b1e0-ed274046776e.png",
      19876,
      lookup,
    )).toBeNull();
  });

  it("does not redirect another CDN host or an unsafe/missing path", () => {
    expect(resolveMirroredCdnRedirect("https://cdn.nlark.com/yuque/0/a.png", 19876, lookup)).toBeNull();
    expect(resolveMirroredCdnRedirect("https://gw.alipayobjects.com/zos/unknown/a.png", 19876, lookup)).toBeNull();
    expect(resolveMirroredCdnRedirect("https://gw.alipayobjects.com/%2e%2e/secret", 19876, lookup)).toBeNull();
  });
});

// ===== W-5：镜像目录一次性扫描 =====
describe("scanMirroredCdnFiles (W-5)", () => {
  it("递归扫描出相对路径集合（/ 分隔），空/缺失目录返回空集", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-cdn-scan-"));
    fs.mkdirSync(path.join(root, "a/b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a/b/f.js"), "x");
    fs.writeFileSync(path.join(root, "top.css"), "y");
    const files = scanMirroredCdnFiles(root);
    expect(files.has("a/b/f.js")).toBe(true);
    expect(files.has("top.css")).toBe(true);
    expect(files.size).toBe(2);
    expect(scanMirroredCdnFiles(path.join(root, "missing")).size).toBe(0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
