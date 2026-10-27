import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;
const DOCS = Number(process.env.S3V3_PERF_DOCS || 1000);

describeIt("真实 S3 增量性能（桌面 Store）", () => {
  it("1000 文档：初始/空跑/改 10 篇", async () => {
    const prefix = (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_perf/" + randomUUID();
    const remote = new S3v3S3Remote({ endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix, forcePathStyle: false });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-perf-s3-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    for (let i = 0; i < DOCS; i++) store.createNoteInAtTopWithContent(nb.id, "Doc " + i, "<p>body-" + i + "-" + "x".repeat(400) + "</p>", [], "p" + i);
    const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
    await device.init();
    let phases: Record<string, number> = {};
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "perf-s3", onPhase: (phase, ms) => { phases[phase] = (phases[phase] ?? 0) + ms; } });
    try {
      let t = Date.now();
      await engine.sync({ onEmptyCloud: "upload" });
      const initMs = Date.now() - t;
      phases = {};
      t = Date.now();
      await engine.sync();
      const noopMs = Date.now() - t;
      const noopPhases = { ...phases };
      for (let i = 0; i < 10; i++) store.saveNote("p" + i, "Doc " + i, "<p>edited-" + i + "-" + "y".repeat(400) + "</p>");
      phases = {};
      t = Date.now();
      await engine.sync();
      const editMs = Date.now() - t;
      const editPhases = { ...phases };
      console.log("PERF-S3 " + JSON.stringify({ docs: DOCS, initMs, noopMs, noopPhases, editMs, editPhases, objects: (await remote.list("")).length }));
      expect(editMs).toBeGreaterThan(0);
    } finally {
      await remote.deleteByPrefix("").catch(() => {});
    }
  }, 600_000);
});
