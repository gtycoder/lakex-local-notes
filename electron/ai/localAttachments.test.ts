import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  localAttachmentKindOf,
  readRegisteredLocalFile,
  registerPickedLocalFile,
  resetLocalAttachmentRegistryForTest,
} from "./localAttachments.js";

const dirs: string[] = [];
function tempFile(name: string, content: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-local-att-"));
  dirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  resetLocalAttachmentRegistryForTest();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("本机文件附件注册表（261116 第四稿）", () => {
  it("扩展名判据：图片 / 文本代码 / 其它（PDF 等不支持）", () => {
    expect(localAttachmentKindOf("a.PNG")).toBe("image");
    expect(localAttachmentKindOf("main.ts")).toBe("text");
    expect(localAttachmentKindOf("README.md")).toBe("text");
    expect(localAttachmentKindOf("doc.pdf")).toBe("unsupported");
    expect(localAttachmentKindOf("noext")).toBe("unsupported");
  });

  it("登记后只回引用与元数据；token 能读回字节（路径不出注册表）", () => {
    const file = tempFile("main.ts", "export const x = 1;\n");
    const picked = registerPickedLocalFile(file)!;
    expect(picked.kind).toBe("text");
    expect(picked.ref.name).toBe("main.ts");
    expect(picked.ref.size).toBeGreaterThan(0);
    expect(picked.ref.token).toMatch(/^loc-/);
    expect(JSON.stringify(picked.ref)).not.toContain(os.tmpdir());
    const read = readRegisteredLocalFile(picked.ref)!;
    expect(read.bytes.toString("utf8")).toContain("export const x");
    expect(read.name).toBe("main.ts");
  });

  it("空文件/目录/不存在的路径 → null（不登记坏引用）", () => {
    expect(registerPickedLocalFile(tempFile("empty.txt", ""))).toBeNull();
    expect(registerPickedLocalFile(os.tmpdir())).toBeNull();
    expect(registerPickedLocalFile(path.join(os.tmpdir(), "definitely-missing-" + Date.now()))).toBeNull();
  });

  it("重启语义：不存在的 token → 读不到（resolver 会报「附件已失效」）", () => {
    expect(readRegisteredLocalFile({ kind: "local", token: "loc-missing", name: "x.txt", size: 1, mimeType: "text/plain" })).toBeNull();
  });
});
