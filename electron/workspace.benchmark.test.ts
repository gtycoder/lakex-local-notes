/** Opt-in capacity benchmark. It is skipped during the normal test suite. */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";

const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

describe.skipIf(process.env.LAKE_RUN_BENCHMARK !== "1")("workspace capacity benchmark", () => {
  it("measures 1,000 notes, 10,000 asset fixtures and a 25 MiB asset", { timeout: 120_000 }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-workspace-benchmark-"));
    const store = new Store(root);

    // 1) 文档创建：独立计时。
    const createdStarted = performance.now();
    for (let i = 0; i < 1_000; i += 1) store.createNote(`基准文档 ${i}`);
    const createdMs = performance.now() - createdStarted;

    // 2) 正文保存：独立计时（fixture 生成不计入）。
    const note = store.createNote("基准资源文档");
    const assetBase = Date.now();
    const filenames = Array.from({ length: 9_999 }, (_, i) => `${String(assetBase + i).padStart(13, "0")}_${i.toString(16).padStart(8, "0")}.png`);
    filenames.push(`${String(assetBase + 9_999).padStart(13, "0")}_deadbeef.png`);
    const content = `<p>${filenames.map((name) => `<img src="http://127.0.0.1:19876/${note.id}/${name}">`).join("")}</p>`;
    const saveStarted = performance.now();
    store.saveNote(note.id, note.title, content, { markdown: content, plain: "资源基准" });
    const savedMs = performance.now() - saveStarted;

    // 3) 资源 fixture 生成：环境准备，单独计时，不混进业务耗时。
    const fixtureStarted = performance.now();
    const assetDir = path.join(root, "note-assets", note.id);
    fs.mkdirSync(assetDir, { recursive: true });
    const tiny = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    for (const filename of filenames.slice(0, -1)) fs.writeFileSync(path.join(assetDir, filename), tiny);
    fs.writeFileSync(path.join(assetDir, filenames.at(-1)!), Buffer.alloc(25 * 1024 * 1024));
    const fixtureMs = performance.now() - fixtureStarted;

    const summaryStarted = performance.now();
    const summary = store.getSyncPendingSummary();
    const summaryMs = performance.now() - summaryStarted;
    const searchStarted = performance.now();
    const search = store.searchNotes("资源基准", 20);
    const searchMs = performance.now() - searchStarted;
    const result = {
      root,
      notes: 1_001,
      assetFixtures: 10_000,
      largeAssetBytes: 25 * 1024 * 1024,
      createdMs: Math.round(createdMs),
      savedMs: Math.round(savedMs),
      fixtureMs: Math.round(fixtureMs),
      summaryMs: Math.round(summaryMs),
      searchMs: Math.round(searchMs),
      summary,
      searchResults: search.length,
    };
    console.log(`[benchmark] ${JSON.stringify(result)}`);

    // getSyncPendingSummary 的真实契约（electron/syncReconciliation.ts）：只统计"可同步的本地事实"——
    // documents = 待上传 notes + 未发布 note 墓碑；folders = 待上传目录树节点；
    // resources 恒为 0：本地不维护资源上传 ledger，真实资源差集只在同步阶段计算。
    expect(summary.documents).toBeGreaterThanOrEqual(1_001);
    expect(summary.resources).toBe(0);
    // 10,000 个资源 fixture 是真实存在的容量样本，但不应（也不被）摘要当成待上传资源数。
    expect(fs.readdirSync(assetDir).length).toBe(10_000);
    expect(search.length).toBeGreaterThan(0);
  });
});
