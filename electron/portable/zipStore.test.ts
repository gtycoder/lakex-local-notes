import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { crc32, PortableSizeError, validateZipEntryName, writeStoreZip, type ZipEntrySource } from "./zipStore.js";
import { readStoreZip, readStoreZipNames } from "./zipTestReader.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lakex-zip-test-"));
  tempDirs.push(dir);
  return dir;
}

function bufferEntry(name: string, data: Buffer, mtime = new Date("2026-11-09T12:00:00Z")): ZipEntrySource {
  return { name, size: data.length, mtime, read: async function* () { yield data; } };
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

const hasUnzip = spawnSync("unzip", ["-v"], { encoding: "utf8" }).status === 0;

describe("portable zip writer (store-only)", () => {
  it("CRC32 标准向量", () => {
    expect(crc32(Buffer.from("hello"))).toBe(0x3610a686);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("往返：条目名/内容/中央目录可被自写读取器与系统 unzip 解开（含中文名）", () => {
    const dir = tempDir();
    const zipPath = path.join(dir, "pkg.zip");
    const text = Buffer.from("hello portable");
    const chinese = Buffer.from(JSON.stringify({ title: "中文笔记" }));
    return writeStoreZip(zipPath, [
      bufferEntry("portable.json", text),
      bufferEntry("desktop/notes/中文.lake", chinese),
      bufferEntry("desktop/empty.bin", Buffer.alloc(0)),
    ]).then((result) => {
      expect(result.entries).toBe(3);
      expect(result.bytes).toBe(statSync(zipPath).size);
      const entries = readStoreZip(zipPath);
      expect(entries.map((entry) => entry.name)).toEqual(["portable.json", "desktop/notes/中文.lake", "desktop/empty.bin"]);
      expect(entries[0]!.data.equals(text)).toBe(true);
      expect(entries[1]!.data.equals(chinese)).toBe(true);
      expect(entries[2]!.data.length).toBe(0);
      if (hasUnzip) {
        // 标准 unzip 自证：-t 校验 CRC/结构，-p 读条目内容。
        expect(spawnSync("unzip", ["-t", zipPath], { encoding: "utf8" }).status).toBe(0);
        // 用通配符匹配（不依赖 unzip 对 UTF-8 文件名的命令行解码）
        const printed = spawnSync("unzip", ["-p", zipPath, "desktop/notes/*.lake"], { encoding: "utf8" });
        expect(printed.status).toBe(0);
        expect(printed.stdout).toBe(chinese.toString("utf8"));
      }
    });
  });

  it("条目数 >65535 时写 ZIP64 EOCD（读回条目数正确）", async () => {
    const dir = tempDir();
    const zipPath = path.join(dir, "many.zip");
    const count = 65_536;
    const entries: ZipEntrySource[] = [];
    for (let index = 0; index < count; index += 1) {
      entries.push(bufferEntry("e/" + String(index).padStart(6, "0"), Buffer.alloc(0)));
    }
    const result = await writeStoreZip(zipPath, entries);
    expect(result.entries).toBe(count);
    const names = readStoreZipNames(zipPath);
    expect(names.length).toBe(count);
    expect(names[count - 1]).toBe("e/065535");
    if (hasUnzip) {
      // unzip -t 对 6.6 万条目也应在数秒内完成；-qq 静音 + 大 maxBuffer（默认 1MB 会被刷爆）
      expect(spawnSync("unzip", ["-tqq", zipPath], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }).status).toBe(0);
    }
  }, 60_000);

  it("拒绝路径穿越/绝对路径/反斜杠", () => {
    for (const name of ["/etc/passwd", "a/../b", "../x", "a\\b", "./a", "a//b"]) {
      expect(() => validateZipEntryName(name)).toThrow();
    }
    expect(() => validateZipEntryName("desktop/notes/a.lake")).not.toThrow();
  });

  it("超出 maxBytes：抛 PortableSizeError 并删除半成品", async () => {
    const dir = tempDir();
    const zipPath = path.join(dir, "big.zip");
    await expect(writeStoreZip(zipPath, [bufferEntry("a.bin", Buffer.alloc(4096))], { maxBytes: 1024 }))
      .rejects.toBeInstanceOf(PortableSizeError);
    expect(existsSync(zipPath)).toBe(false);
  });

  it("条目名非法：写入前失败并删除半成品", async () => {
    const dir = tempDir();
    const zipPath = path.join(dir, "bad.zip");
    await expect(writeStoreZip(zipPath, [bufferEntry("../evil.txt", Buffer.from("x"))])).rejects.toThrow("路径非法");
    expect(existsSync(zipPath)).toBe(false);
  });

  it("已存在同名 zip 时由导出侧保证不覆盖（writer 本身覆盖写）", async () => {
    const dir = tempDir();
    const zipPath = path.join(dir, "same.zip");
    writeFileSync(zipPath, "not a zip");
    const result = await writeStoreZip(zipPath, [bufferEntry("a.txt", Buffer.from("ok"))]);
    expect(result.entries).toBe(1);
    expect(readFileSync(zipPath).subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
  });
});
