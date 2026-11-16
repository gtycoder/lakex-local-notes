import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AI 写作 / AI 对话数据**本地专属**护栏（261116 用户裁决：「这些不要 S3，确保只在本地，
 * 所有的历史对话都不 S3」）。
 *
 * 为什么需要机检：同步链路的代码面很宽（s3v3 / syncEngineController / store / portable），
 * 一次「顺手把 AI 会话也带上」就可能把用户的私密对话传上云端 —— 这类事故不能靠 review 记忆。
 *
 * 判据：
 * 1. `ai_writing_*` 表只能出现在 schema / repository / IPC 注册 / 本地 webApi 映射里；
 *    s3v3、同步编排、便携包、store 一律不得出现。
 * 2. 粘贴图片的落盘目录（ai-attachments / ai-paste）同理：只许 AI 附件模块与文档引用，
 *    同步/便携包不得引用（目录在 userData 下，绝不能落在 note-assets/ 被资产声明扫到）。
 * 3. 便携包白名单收集函数不得包含 AI 会话或 AI 附件目录。
 */
const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(ELECTRON_DIR, "..");
const SRC_DIR = path.join(ROOT, "src");

const AI_TABLE_ALLOWED = new Set([
  "electron/schemaInit.ts",
  "electron/aiWritingRepository.ts",
  "electron/aiWritingRepository.test.ts",
  "electron/ipc/registerAiWriting.ts",
  "electron/webApiServer.ts",
  // 本护栏自身（断言里必然出现表名）；不参与产品链路。
  "electron/aiWritingLocalOnly.test.ts",
  // preload 的通道映射（IPC 桥，不参与同步/上传）。
  "electron/preload.cjs",
  // handler 级测试：断言对象是 IPC 参数校验，不含任何同步/上传路径（261116 review P1-3）。
  "electron/ipc/registerAiWriting.attachments.test.ts",
  "electron/ipc/registerAiWriting.append.test.ts",
  // schema 迁移测试：断言 ai_writing_messages 旧库缺列 → ALTER 补齐，不参与同步/上传。
  "electron/schemaInit.test.ts",
]);

/** 这些文件/目录一旦出现 AI 本地数据的引用就是「可能上云」的红线面。 */
const SYNC_FORBIDDEN_HINTS = [
  "electron/s3v3",
  "electron/syncEngineController",
  "electron/portable",
  "electron/store.ts",
  "electron/indexRepository.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const abs = path.join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx|cjs|mjs)$/.test(entry)) out.push(abs);
  }
  return out;
}

const rel = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join("/");
const files = [...walk(ELECTRON_DIR), ...walk(SRC_DIR)].map((abs) => ({ abs, rel: rel(abs), text: readFileSync(abs, "utf8") }));

describe("AI 写作数据本地专属（不进 S3）", () => {
  it("ai_writing 表只出现在 schema / repository / IPC / 本地 webApi", () => {
    const offenders = files
      .filter((file) => file.text.includes("ai_writing"))
      .filter((file) => !AI_TABLE_ALLOWED.has(file.rel))
      .map((file) => file.rel);
    expect(offenders, "新增引用 ai_writing 的文件 ⇒ 先确认它不在同步/上传链路里，再登记到白名单").toEqual([]);
  });

  it("同步 / 便携包 / store 里不得出现 AI 会话或 AI 附件目录", () => {
    const forbidden = files.filter((file) => SYNC_FORBIDDEN_HINTS.some((hint) => file.rel.startsWith(hint)));
    expect(forbidden.length).toBeGreaterThan(10); // 扫描面非空（探针自证，避免目录改名后静默空跑）
    const offenders = forbidden.filter((file) => /ai_writing|ai-attachments|ai-paste/i.test(file.text)).map((file) => file.rel);
    expect(offenders, "同步链路出现 AI 本地数据引用 ⇒ 会随同步上传，必须回退").toEqual([]);
  });

  it("便携包收集白名单不含 AI 会话 / AI 附件目录", () => {
    const portable = files.find((file) => file.rel === "electron/portable/portableExport.ts")!;
    expect(portable).toBeTruthy();
    expect(portable.text).not.toMatch(/ai_writing|ai-attachments|ai-paste/i);
    // 现状白名单 = 正文 + note-assets + quick-notes；AI 粘贴图在 userData 顶层，天然不在其中。
    expect(portable.text).toContain('add("asset", "note-assets", "note-assets")');
  });
});
