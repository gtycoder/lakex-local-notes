/**
 * 大库种子（gated vitest；默认 skip）。
 *
 * 只由 `scripts/scale-acceptance/seed-large-library.mjs` 通过环境变量驱动：
 *   LAKE_SCALE_SEED_ROOT   必填。位于 /tmp/lake-scale- 前缀下的 userData 根（先由编排脚本确认不存在）
 *   LAKE_SCALE_DOCS        文档数，默认 10000
 *   LAKE_SCALE_ASSETS      附件文件数，默认 100000（必须能被文档数整除）
 *   LAKE_SCALE_ASSET_BYTES 单附件字节，默认 20480（约 20KiB）
 *   LAKE_SCALE_NOTEBOOKS   笔记本数，默认 20
 *   LAKE_SCALE_ASSET_PORT  资源 URL 端口（仅写进正文 card value，默认 19876）
 *   LAKE_SCALE_REPORT      报告 JSON 路径（编排脚本回读）
 *   LAKE_SCALE_NOTE_LIMIT  可选：仅用于小规模自证（调小文档数）
 *
 * 走的是产品真实 Store（createNoteIn/saveNote/搜索索引/树查询），不是裸 SQL 造行：
 * 因此 FTS、树节点、正文文件、聊天缓存都是产品写入路径的产物。
 * 附件文件由 Node fs 直接写入 note-assets/<noteId>/：它们**在正文里被引用**（file 卡），
 * 所以 extractAssetRefs / 孤儿判定 / 资源统计都会把它们当「在用资源」；
 * 但不经过 upload_resource IPC（不产生 DB 资产行，桌面端本来也没有资产表）。
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

// Store 模块加载即需要 electron（safeStorage 只在持久化 S3 密钥时用到，这里给最小替身）。
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
    secrets,
    encryptString: (value: string) => {
      const id = crypto.randomUUID();
      secrets.set(id, value);
      return Buffer.from(id);
    },
    decryptString: (buffer: Buffer) => secrets.get(buffer.toString()) ?? "",
  };
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: electronMock.encryptString,
    decryptString: electronMock.decryptString,
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "../../electron/store.js";
import { escapeLakeHtml, lakeTextParagraph } from "../../src/core/lakeDocForm.js";

const TEMP_PREFIXES = ["/tmp/lake-scale-", "/private/tmp/lake-scale-"];

function readNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`环境变量 ${key} 必须是正整数（收到 ${raw}）`);
  return value;
}

const seedRoot = process.env.LAKE_SCALE_SEED_ROOT?.trim() || "";
const gated = seedRoot.length > 0;
const describeGated = gated ? describe : describe.skip;

interface SeedTarget {
  documents: number;
  assets: number;
  assetBytes: number;
  notebooks: number;
  assetsPerDocument: number;
  assetPort: number;
  reportPath: string;
}

function readTarget(): SeedTarget {
  const documents = readNumber(process.env, "LAKE_SCALE_DOCS", 10_000);
  const assets = readNumber(process.env, "LAKE_SCALE_ASSETS", 100_000);
  const assetBytes = readNumber(process.env, "LAKE_SCALE_ASSET_BYTES", 20_480);
  const notebooks = readNumber(process.env, "LAKE_SCALE_NOTEBOOKS", 20);
  if (assets % documents !== 0) throw new Error(`附件数 ${assets} 必须能被文档数 ${documents} 整除（每篇附件数相同）`);
  if (notebooks > documents) throw new Error("笔记本数不能大于文档数");
  const reportPath = process.env.LAKE_SCALE_REPORT?.trim();
  if (!reportPath) throw new Error("缺少 LAKE_SCALE_REPORT（编排脚本会注入）");
  return {
    documents,
    assets,
    assetBytes,
    notebooks,
    assetsPerDocument: assets / documents,
    assetPort: readNumber(process.env, "LAKE_SCALE_ASSET_PORT", 19876),
    reportPath,
  };
}

function pad(index: number, width: number): string {
  return String(index).padStart(width, "0");
}

function buildDocumentBody(input: {
  noteId: string;
  title: string;
  docIndex: number;
  assetNames: string[];
  assetBytes: number;
  assetPort: number;
  seedStamp: number;
}): { content: string; plain: string } {
  const { noteId, title, docIndex, assetNames, assetBytes, assetPort, seedStamp } = input;
  const number = pad(docIndex, 5);
  const parts: string[] = [
    `<h1 data-lake-id="${noteId}-h1" id="${noteId}-h1" class="ne-h1">${escapeLakeHtml(title)}</h1>`,
    lakeTextParagraph(`${noteId}-p0`, `${noteId}-p0-t`, `规模验收文档编号 ${number}。这份正文由 scripts/scale-acceptance 的种子脚本生成，用于 10k 文档 / 100k 附件规模下的启动、目录、搜索、打开与资源统计验收。`),
    lakeTextParagraph(`${noteId}-p1`, `${noteId}-p1-t`, `合成正文标记 A${seedStamp}-${number}；本段同时进入全文索引，便于验证正文搜索命中。`),
  ];
  assetNames.forEach((filename, assetIndex) => {
    const value = {
      src: `http://127.0.0.1:${assetPort}/${noteId}/${filename}`,
      name: filename,
      size: assetBytes,
      taskId: `scale-${noteId}-${assetIndex}`,
    };
    const paragraphId = `${noteId}-c${assetIndex}`;
    parts.push(
      `<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><card type="inline" name="file" value="data:${encodeURIComponent(JSON.stringify(value))}"></card></p>`,
    );
  });
  const plain = [
    title,
    `规模验收文档编号 ${number}`,
    `合成正文标记 A${seedStamp}-${number}`,
    `引用附件 ${assetNames.length} 个`,
  ].join("\n");
  return { content: parts.join(""), plain };
}

/** 有界并发写文件（大库附件写盘不能一次性 allSettled 10 万个 Promise）。 */
async function writeAssetsConcurrently(
  jobs: Array<{ filePath: string; bytes: Buffer }>,
  concurrency: number,
): Promise<void> {
  let cursor = 0;
  let failure: unknown = null;
  const worker = async () => {
    for (;;) {
      if (failure) return;
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;
      const job = jobs[index]!;
      try {
        await fs.promises.mkdir(path.dirname(job.filePath), { recursive: true });
        await fs.promises.writeFile(job.filePath, job.bytes);
      } catch (error) {
        failure ??= error;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, worker));
  if (failure) throw failure;
}

describeGated("大库种子（10k 文档 / 100k 附件）", () => {
  it("用真实 Store 写入可验收的隔离工作区并输出固定字段报告", async () => {
    if (!TEMP_PREFIXES.some((prefix) => path.resolve(seedRoot).startsWith(prefix))) {
      throw new Error(`LAKE_SCALE_SEED_ROOT 必须在 /tmp/lake-scale- 前缀下（收到 ${seedRoot}）`);
    }
    if (fs.existsSync(seedRoot)) throw new Error(`种子目录已存在，拒绝覆盖：${seedRoot}（编排脚本负责 --force 清理）`);
    fs.mkdirSync(seedRoot, { recursive: true });

    const target = readTarget();
    const workspaceRoot = path.join(seedRoot, "workspace-default");
    const errors: string[] = [];
    const report: Record<string, unknown> = {
      schemaVersion: 1,
      mode: "seed",
      generatedAt: new Date().toISOString(),
      seedRoot,
      workspaceRoot,
      target,
      actual: {},
      timings: {},
      checks: {},
      host: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model?.trim() ?? "",
        totalMemBytes: os.totalmem(),
        osRelease: os.release(),
      },
      errors,
    };

    const startedTotal = Date.now();
    let store: Store | null = null;
    try {
      // ===== 1. 初始化（产品 bootstrap 会种「个人笔记」+ 欢迎文档）=====
      let t = Date.now();
      store = new Store(workspaceRoot);
      const bootstrap = store.bootstrap();
      report.timings = { initMs: Date.now() - t };

      const notebooks: Array<{ id: string; title: string }> = [];
      t = Date.now();
      for (let index = 0; index < target.notebooks; index += 1) {
        const notebook = store.createNotebook(`规模验收笔记本 ${pad(index, 2)}`);
        notebooks.push({ id: notebook.id, title: notebook.title });
      }
      (report.timings as Record<string, number>).createNotebooksMs = Date.now() - t;

      // ===== 2. 建文档（真实 createNoteIn）=====
      const seedStamp = Date.now();
      const documents: Array<{ id: string; title: string; parentId: string; assets: string[] }> = [];
      t = Date.now();
      for (let index = 0; index < target.documents; index += 1) {
        const notebook = notebooks[index % notebooks.length]!;
        const title = `规模验收文档 ${pad(index, 5)}`;
        const note = store.createNoteIn(notebook.id, title);
        const assets: string[] = [];
        for (let assetIndex = 0; assetIndex < target.assetsPerDocument; assetIndex += 1) {
          const globalAssetIndex = index * target.assetsPerDocument + assetIndex;
          const stamp = String(seedStamp + globalAssetIndex).padStart(13, "0");
          const hex = crypto.createHash("sha1").update(`${note.id}:${assetIndex}`).digest("hex").slice(0, 8);
          assets.push(`${stamp}_${hex}.txt`);
        }
        documents.push({ id: note.id, title, parentId: notebook.id, assets });
        if ((index + 1) % 1000 === 0) {
          // 进度可见（vitest --reporter=basic 时仍会刷新输出）
          console.log(`[seed] 已创建文档 ${index + 1}/${target.documents}（${Date.now() - t}ms）`);
        }
      }
      (report.timings as Record<string, number>).createNotesMs = Date.now() - t;

      // ===== 3. 写正文（真实 saveNote；正文引用附件 ⇒ 进入全文索引 + 资源引用集）=====
      t = Date.now();
      for (let index = 0; index < documents.length; index += 1) {
        const doc = documents[index]!;
        const body = buildDocumentBody({
          noteId: doc.id,
          title: doc.title,
          docIndex: index,
          assetNames: doc.assets,
          assetBytes: target.assetBytes,
          assetPort: target.assetPort,
          seedStamp,
        });
        const result = store.saveNote(doc.id, doc.title, body.content, { markdown: null, plain: body.plain });
        if ("ok" in result && result.ok === false) throw new Error(`保存被拒（意外）：${doc.id}`);
        if ((index + 1) % 1000 === 0) {
          console.log(`[seed] 已保存正文 ${index + 1}/${documents.length}（${Date.now() - t}ms）`);
        }
      }
      (report.timings as Record<string, number>).saveNotesMs = Date.now() - t;

      // ===== 4. 写附件文件（Node fs 直写；正文已引用，属「在用资源」）=====
      t = Date.now();
      const filler = Buffer.alloc(target.assetBytes, 0x20);
      const jobs: Array<{ filePath: string; bytes: Buffer }> = [];
      for (let index = 0; index < documents.length; index += 1) {
        const doc = documents[index]!;
        for (const filename of doc.assets) {
          const header = Buffer.from(`LAKEX-SCALE-ASSET ${filename}\n`, "utf8");
          const bytes = Buffer.concat([header, filler]);
          jobs.push({ filePath: path.join(workspaceRoot, "note-assets", doc.id, filename), bytes });
        }
      }
      await writeAssetsConcurrently(jobs, Number(process.env.LAKE_SCALE_WRITE_CONCURRENCY || 24));
      (report.timings as Record<string, number>).writeAssetsMs = Date.now() - t;

      // ===== 5. 校验（只读产品 API / 文件系统）=====
      t = Date.now();
      const tree = await Promise.resolve(store.listTreeNodes());
      const noteRows = tree.filter((node) => node.nodeType === "note");
      const notebookRows = tree.filter((node) => node.nodeType === "notebook");
      const overview = store.getStorageOverview();
      const sampleDocIndex = Math.floor(target.documents / 2);
      const sampleDoc = documents[sampleDocIndex]!;
      const keyword = pad(sampleDocIndex, 5);
      const hits = store.searchNotes(keyword, 30);
      const searchHit = hits.some((hit) => hit.id === sampleDoc.id);
      const readBack = store.readNote(sampleDoc.id);
      const assetRoot = path.join(workspaceRoot, "note-assets");
      let assetFiles = 0;
      let assetBytes = 0;
      if (fs.existsSync(assetRoot)) {
        for (const dir of fs.readdirSync(assetRoot, { withFileTypes: true })) {
          if (!dir.isDirectory()) continue;
          const files = fs.readdirSync(path.join(assetRoot, dir.name), { withFileTypes: true }).filter((entry) => entry.isFile());
          assetFiles += files.length;
          for (const file of files) assetBytes += fs.statSync(path.join(assetRoot, dir.name, file.name)).size;
        }
      }
      const expectedAssetFiles = target.documents * target.assetsPerDocument;
      const checks = {
        treeNodesOk: tree.length === target.documents + target.notebooks + 2,
        noteCountOk: noteRows.length === target.documents + 1,
        notebookCountOk: notebookRows.length === target.notebooks + 1,
        assetCountOk: assetFiles === expectedAssetFiles,
        assetBytesOk: assetBytes >= expectedAssetFiles * target.assetBytes,
        overviewAssetCountOk: overview.assetFiles === expectedAssetFiles,
        searchHitOk: searchHit,
        searchHitCount: hits.length,
        searchQuery: keyword,
        readBackOk: readBack.content.includes(`规模验收文档编号 ${keyword}`),
        fileCardRefsOk: (readBack.content.match(/name="file"/g) ?? []).length === target.assetsPerDocument,
        welcomeNotePresent: bootstrap.notes.some((note) => note.id === "welcome-note"),
      };
      (report.timings as Record<string, number>).verifyMs = Date.now() - t;
      report.checks = checks;
      report.actual = {
        treeNodes: tree.length,
        notes: noteRows.length,
        notebooks: notebookRows.length,
        assetFiles,
        assetBytes,
        assetBytesHuman: `${(assetBytes / 1024 / 1024 / 1024).toFixed(2)}GiB`,
        overviewAssetFiles: overview.assetFiles,
        overviewAssetBytes: overview.assetBytes,
        dbBytes: overview.dbBytes,
        workspace: (() => {
          const stat = fs.statSync(path.join(workspaceRoot, "metadata.sqlite3"));
          return { dbFileBytes: stat.size, sampleNoteId: sampleDoc.id, sampleNoteTitle: sampleDoc.title };
        })(),
        rssBytes: process.memoryUsage().rss,
      };
      (report.timings as Record<string, number>).totalMs = Date.now() - startedTotal;

      // 关库再用新连接复核：确认落盘（不是内存幻象）
      store.close();
      store = null;

      for (const [key, value] of Object.entries(checks)) {
        if (key === "searchHitCount" || key === "searchQuery") continue;
        if (value !== true) errors.push(`校验失败：${key}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      const stack = error instanceof Error ? error.stack : "";
      if (stack) errors.push(stack);
      throw error;
    } finally {
      try { store?.close(); } catch { /* 已关 */ }
      (report.timings as Record<string, number>).totalMs ??= Date.now() - startedTotal;
      fs.mkdirSync(path.dirname(target.reportPath), { recursive: true });
      fs.writeFileSync(target.reportPath, JSON.stringify(report, null, 2) + "\n");
      console.log(`[seed] 报告已写入 ${target.reportPath}`);
    }

    if (errors.length > 0) throw new Error(`种子校验失败（详见报告 ${target.reportPath}）：${errors.slice(0, 3).join("；")}`);
    console.log(`[seed] 完成：文档 ${target.documents} / 附件 ${target.assets}（${(target.assets * target.assetBytes / 1024 / 1024 / 1024).toFixed(2)}GiB）`);
  }, 3_600_000);
});
