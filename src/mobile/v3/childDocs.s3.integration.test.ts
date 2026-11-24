import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { setBaselineFileForDbForTest } from "../data/v3BaselineFile.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, readNote } from "../data/noteRepository.js";
import { runMobileV3Sync } from "./sync.js";
import { createS3v3RemoteWithClient } from "./s3v3Remote.js";

/**
 * 261124 P0 排查（用户报「移动端只要发生 S3 就丢文档下的子文档，正式 APK 稳定复现」）：
 * 用**用户指定的空桶前缀**（S3V3_PREFIX，默认 lakex-notes-dev3）做最小复现：
 *   笔记本 NB → 父文档 P（parent=NB）→ 子文档 C（parent=**P，文档做父**）＋ 对照顶层 T（parent=NB）。
 * 每轮同步后都断言 C 的行还在、parent_id 仍指回 P，并把云端索引原文打出来（第一轮 = 取证）。
 * afterAll 清空整个前缀，测完目录回到空状态。
 */
const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

describeIt("261124 P0：S3 同步不丢「文档下的子文档」", () => {
  let prefix = "";
  let client: S3Client;
  beforeAll(() => {
    prefix = process.env.S3V3_PREFIX || "lakex-notes-dev3";
    client = new S3Client({ region: process.env.S3V3_REGION || "cn-north-1", endpoint: process.env.S3V3_ENDPOINT!, credentials: { accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK! }, forcePathStyle: false });
  });
  afterAll(async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    await remote.deleteByPrefix("").catch(() => {});
  });

  const cfg = () => ({ endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix });

  /**
   * 测试基线隔离（261124 实测踩坑）：MobileDeviceStore 的基线文件缺省落在 BodyStore 根的
   * 固定相对路径（sync-v3/baseline.json.gz.b64）——内存库（SqlJs）在 vitest 里共用同一根 ⇒
   * A 的 saveBaseline 会被 B 的 load 读走（B 一开始就被判 sameAsBaseline、目录被当「用户已删」）。
   * 每个 db 注册独立临时基线文件；目录随测试清掉。
   */
  const baseDir = mkdtempSync(join(tmpdir(), "child-docs-baseline-"));
  const isolatedDb = (db: SqlJsAsyncDb, name: string): SqlJsAsyncDb => {
    setBaselineFileForDbForTest(db, join(baseDir, name + ".baseline.json.gz.b64"));
    return db;
  };
  afterAll(() => rmSync(baseDir, { recursive: true, force: true }));

  async function rows(db: SqlJsAsyncDb): Promise<Array<{ id: string; parent_id: string | null; trashed_at: string | null }>> {
    return await db.prepare("SELECT id, parent_id, trashed_at FROM notes ORDER BY id").all() as never;
  }

  it("同设备：空桶首传 → 再轮同步，子文档行与 parent 都不许变", async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    // 起点 = 目录必须是空的（复现条件：用户给的空桶）
    await remote.deleteByPrefix("").catch(() => {});

    const m = isolatedDb(new SqlJsAsyncDb(await SqlJsDb.open()), "m1");
    await applyMobileSchema(m);
    await createNote(m, "nb", "笔记本", "nb-body", null, new Map());
    await m.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at) VALUES ('nb','笔记本',NULL,0,'notebook',NULL,'2026-11-24T00:00:00.000Z')").run();
    await createNote(m, "parent-doc", "父文档", "parent-body", "nb", new Map());
    await createNote(m, "child-doc", "子文档", "child-body", "parent-doc", new Map());
    await createNote(m, "top-doc", "顶层文档", "top-body", "nb", new Map());

    const before = await rows(m);
    console.log("[repro] before:", JSON.stringify(before));
    expect(before.find((r) => r.id === "child-doc")?.parent_id).toBe("parent-doc");

    // 轮 1：空云首传（与正式端同参：不注入 emptyCloud，走默认 upload 分支）
    const r1 = await runMobileV3Sync(m, cfg(), { remote, deviceId: "M" });
    console.log("[repro] round1:", JSON.stringify({ published: r1.published, downloadedNotes: r1.downloadedNotes, warnings: r1.warnings }));
    const afterR1 = await rows(m);
    console.log("[repro] after round1:", JSON.stringify(afterR1));
    expect(afterR1.find((r) => r.id === "child-doc")?.parent_id).toBe("parent-doc");

    // 云端对象全集：确认发布写到了哪
    const keys = await remote.list("");
    console.log("[repro] remote keys:", JSON.stringify((keys ?? []).map((k) => k.key)));
    // 云端索引原文：子文档进没进？parentId 是什么？
    const ptr = (await remote.get("meta/pointer.json")) ?? null;
    console.log("[repro] pointer:", ptr ? new TextDecoder().decode(ptr as Uint8Array) : "(none)");
    if (ptr) {
      const text = new TextDecoder().decode(ptr as Uint8Array);
      const parsed = JSON.parse(text) as { lake?: { commit?: string }; quickNotes?: { commit?: string } };
      const idxKeys = [
        ...(parsed.lake?.commit ? ["meta/index/" + parsed.lake.commit + ".json"] : []),
        ...(parsed.quickNotes?.commit ? ["quick-notes/meta/index/" + parsed.quickNotes.commit + ".json"] : []),
      ];
      for (const key of [...new Set(idxKeys)]) {
        const bytes = await remote.get(key);
        if (!bytes) continue;
        const json = JSON.parse(new TextDecoder().decode(bytes as Uint8Array));
        const notes = (json?.lake?.notes ?? json?.notes ?? []) as Array<{ id: string; parentId?: string | null }>;
        console.log("[repro] index " + key + " notes:", JSON.stringify(notes.map((n) => ({ id: n.id, parentId: n.parentId ?? null }))));
        const folders = (json?.lake?.folders ?? json?.folders ?? []) as Array<{ id: string; parentId?: string | null; nodeType?: string }>;
        console.log("[repro] index " + key + " folders:", JSON.stringify(folders.map((f) => ({ id: f.id, parentId: f.parentId ?? null, nodeType: f.nodeType ?? "" }))));
      }
    }

    // 轮 2：同设备再来一轮 S3（用户说「只要发生 S3」）
    const r2 = await runMobileV3Sync(m, cfg(), { remote, deviceId: "M" });
    console.log("[repro] round2:", JSON.stringify({ published: r2.published, downloadedNotes: r2.downloadedNotes, warnings: r2.warnings }));
    const afterR2 = await rows(m);
    console.log("[repro] after round2:", JSON.stringify(afterR2));
    const childAfterR2 = afterR2.find((r) => r.id === "child-doc");
    expect(childAfterR2, "轮 2 后子文档行必须还在").toBeTruthy();
    expect(childAfterR2?.parent_id, "轮 2 后子文档 parent 必须仍指父文档").toBe("parent-doc");

    // 对照：正文也还在
    expect((await readNote(m, "child-doc"))?.content).toContain("child-body");
    await m.close();
  }, 180_000);

  it("第二台设备首拉：子文档不得被改挂到兜底笔记本", async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    await remote.deleteByPrefix("").catch(() => {});
    const a = isolatedDb(new SqlJsAsyncDb(await SqlJsDb.open()), "a2");
    await applyMobileSchema(a);
    await a.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at) VALUES ('nb','笔记本',NULL,0,'notebook',NULL,'2026-11-24T00:00:00.000Z')").run();
    await createNote(a, "parent-doc", "父文档", "parent-body", "nb", new Map());
    await createNote(a, "child-doc", "子文档", "child-body", "parent-doc", new Map());
    await runMobileV3Sync(a, cfg(), { remote, deviceId: "A", emptyCloud: "upload" });
    await a.close();

    const b = isolatedDb(new SqlJsAsyncDb(await SqlJsDb.open()), "b2");
    await applyMobileSchema(b);
    const rb = await runMobileV3Sync(b, cfg(), { remote, deviceId: "B" });
    console.log("[repro] B pull:", JSON.stringify({ downloadedNotes: rb.downloadedNotes, warnings: rb.warnings }));
    const rowsB = await rows(b);
    console.log("[repro] B rows:", JSON.stringify(rowsB));
    console.log("[repro] B folders:", JSON.stringify(await b.prepare("SELECT id, parent_id FROM folders ORDER BY id").all()));
    const childB = rowsB.find((r) => r.id === "child-doc");
    expect(childB, "B 端必须拉到子文档").toBeTruthy();
    expect(childB?.parent_id, "B 端子文档 parent 必须是父文档（不是兜底笔记本）").toBe("parent-doc");
    await b.close();
  }, 180_000);
});
