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
  it("measures 1,000 notes, 10,000 referenced assets and a 25 MiB asset", { timeout: 120_000 }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-workspace-benchmark-"));
    const store = new Store(root);
    const started = performance.now();
    for (let i = 0; i < 1_000; i += 1) store.createNote(`基准文档 ${i}`);
    const createdMs = performance.now() - started;

    const note = store.createNote("基准资源文档");
    const assetBase = Date.now();
    const filenames = Array.from({ length: 9_999 }, (_, i) => `${String(assetBase + i).padStart(13, "0")}_${i.toString(16).padStart(8, "0")}.png`);
    filenames.push(`${String(assetBase + 9_999).padStart(13, "0")}_deadbeef.png`);
    const content = `<p>${filenames.map((name) => `<img src="http://127.0.0.1:19876/${note.id}/${name}">`).join("")}</p>`;
    const saveStarted = performance.now();
    store.saveNote(note.id, note.title, content, { markdown: content, plain: "资源基准" });
    const assetDir = path.join(root, "note-assets", note.id);
    fs.mkdirSync(assetDir, { recursive: true });
    const tiny = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    for (const filename of filenames.slice(0, -1)) fs.writeFileSync(path.join(assetDir, filename), tiny);
    fs.writeFileSync(path.join(assetDir, filenames.at(-1)!), Buffer.alloc(25 * 1024 * 1024));
    const savedMs = performance.now() - saveStarted;

    const summaryStarted = performance.now();
    const summary = store.getSyncPendingSummary();
    const summaryMs = performance.now() - summaryStarted;
    const searchStarted = performance.now();
    const search = store.searchNotes("资源基准", 20);
    const searchMs = performance.now() - searchStarted;
    const result = {
      root,
      notes: 1_001,
      resources: 10_000,
      largeAssetBytes: 25 * 1024 * 1024,
      createdMs: Math.round(createdMs),
      savedMs: Math.round(savedMs),
      summaryMs: Math.round(summaryMs),
      searchMs: Math.round(searchMs),
      summary,
      searchResults: search.length,
    };
    console.log(`[benchmark] ${JSON.stringify(result)}`);
    expect(summary.documents).toBeGreaterThanOrEqual(1_001);
    expect(summary.resources).toBeGreaterThanOrEqual(10_000);
    expect(search.length).toBeGreaterThan(0);
  });
});
