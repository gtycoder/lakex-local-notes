/**
 * 2GB 便携包验收（gated vitest；默认 skip，需 PORTABLE_2GB=1）。
 *
 * 只由 `scripts/scale-acceptance/portable-2gb.mjs` 驱动（也可单独跑，见 README）：
 *   PORTABLE_2GB=1
 *   LAKE_SCALE_SEED_ROOT   seed-large-library.mjs 产出的 /tmp/lake-scale-seed-*
 *   PORTABLE_2GB_OUT_DIR   导出目录（/tmp/lake-scale-portable-out-*，必须不存在或为空）
 *   PORTABLE_2GB_REPORT    报告 JSON 路径
 *   PORTABLE_2GB_SAMPLE    抽样读回条目数（默认 8；含 manifest/两个 DB/baseline/正文/附件）
 *
 * 走产品真实导出函数 exportPortablePackage（含 VACUUM INTO 快照 + 白名单遍历 + store-only 流式 zip），
 * 只是 snapshotDatabases/counts 由测试按 main 的同款口径注入（store.backupDatabaseTo /
 * quickNotes.backupDatabaseTo / getStorageOverview）。
 *
 * 验证：
 *  - 结构：EOCD/ZIP64 EOCD/中央目录条目数/每条 method=0/本地头签名/32 位大小一致；
 *  - manifest：parsePortableManifest 全量校验（format/version/layout/limitBytes/counts/baseline；v2 恒无历史）；
 *  - 计数：manifest.counts.bytes === 所有条目数据字节和；counts.notes/assets 与条目前缀统计一致；
 *  - 白名单：不含 history/logs/backups/settings/window-state/sync-v3/state.gz（v2：草稿与素材随包）；
 *  - 抽样读回：真实读数据 + CRC32 校验（正文含种子正文标记、附件大小/命名符合）；
 *  - 移动端导入前兼容：按 android PortablePackagePlugin.kt 的 MAX_ENTRIES / 4GiB 上限判定。
 *
 * 2GB 包不能整包进内存 ⇒ 这里用「按需 seek 读」的流式校验（zipTestReader.readStoreZip 只适合小包）。
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import crypto from "node:crypto";

// Store/QuickNotesStore 模块加载即需要 electron（safeStorage / net）；测试里只用到 DB 侧。
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
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

import { Store } from "../store.js";
import { QuickNotesStore } from "../quickNotes/index.js";
import { exportPortablePackage } from "./portableExport.js";
import { PORTABLE_LIMIT_BYTES, parsePortableManifest } from "../../src/core/portable/portableFormat.js";
import { crc32 } from "./zipStore.js";
import { readCentralDirectory, readEntryData, sumEntrySizes } from "./zipRead.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TEMP_PREFIXES = ["/tmp/lake-scale-", "/private/tmp/lake-scale-"];
// zip 读取统一走生产读取器 zipRead.ts（261122 收口：删除本地重复实现）。

function readIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`环境变量 ${key} 必须是正整数（收到 ${raw}）`);
  return value;
}

const gated = process.env.PORTABLE_2GB === "1";
const describeGated = gated ? describe : describe.skip;

describeGated("2GB 便携包导出与格式校验（桌面 → 手机）", () => {
  it("导出 2GB 量级包：manifest/counts/条目/CRC 抽样读回 + 移动端导入前兼容判定", async () => {
    const seedRoot = process.env.LAKE_SCALE_SEED_ROOT?.trim() || "";
    const outDir = process.env.PORTABLE_2GB_OUT_DIR?.trim() || "";
    const reportPath = process.env.PORTABLE_2GB_REPORT?.trim() || "";
    if (!seedRoot || !outDir || !reportPath) throw new Error("缺少 PORTABLE_2GB 环境变量（用 portable-2gb.mjs 驱动）");
    for (const [label, value] of [["LAKE_SCALE_SEED_ROOT", seedRoot], ["PORTABLE_2GB_OUT_DIR", outDir], ["PORTABLE_2GB_REPORT", reportPath]] as const) {
      if (!TEMP_PREFIXES.some((prefix) => path.resolve(value).startsWith(prefix))) {
        throw new Error(`${label} 必须在 /tmp/lake-scale- 前缀下（收到 ${value}）`);
      }
    }
    if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) throw new Error(`导出目录必须为空：${outDir}`);
    fs.mkdirSync(outDir, { recursive: true });

    const workspaceRoot = path.join(seedRoot, "workspace-default");
    if (!fs.existsSync(path.join(workspaceRoot, "metadata.sqlite3"))) throw new Error(`不是有效 seed：${workspaceRoot}`);
    const sampleCount = readIntEnv("PORTABLE_2GB_SAMPLE", 8);
    const startedAt = Date.now();
    const report: Record<string, unknown> = {
      schemaVersion: 1,
      mode: "portable-2gb",
      generatedAt: new Date().toISOString(),
      seedRoot,
      workspaceRoot,
      outDir,
      host: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model?.trim() ?? "",
        totalMemBytes: os.totalmem(),
      },
      errors: [],
    };
    const errors = report.errors as string[];

    const store = new Store(workspaceRoot);
    const quickNotes = new QuickNotesStore(workspaceRoot);
    try {
      // 与主进程 registerPortableIpc 完全同款：VACUUM INTO 两份 DB 快照。
      const overview = store.getStorageOverview();
      const counts = {
        folders: overview.notebooks + overview.groups,
        quickNotes: quickNotes.countQuickNotes(),
        tags: quickNotes.tagService.list().length,
      };
      report.sourceStats = {
        notes: overview.notes,
        notebooks: overview.notebooks,
        groups: overview.groups,
        trashedNodes: overview.trashedNodes,
        assetFiles: overview.assetFiles,
        assetBytes: overview.assetBytes,
        dbBytes: overview.dbBytes,
        counts,
      };

      // 造一份合成云端基线（真实同步过的用户导出时就是这份 baseline.json.gz → 包里解压成 baseline.json）。
      // 没有它也能导出（offlineHashes 路径），但那会把 10k 正文全量 sha256；这里选择更接近真实用户的路径。
      const baselineDir = path.join(workspaceRoot, "sync-v3");
      let baselineCreated = false;
      if (!fs.existsSync(path.join(baselineDir, "baseline.json.gz"))) {
        fs.mkdirSync(baselineDir, { recursive: true });
        const baseline = {
          epoch: "scale-acceptance",
          generation: 1,
          lakeCommit: "scale-acceptance-lake",
          quickNotesCommit: "scale-acceptance-quick",
          lake: { notes: [] },
          quickNotes: { quickNotes: [] },
        };
        fs.writeFileSync(path.join(baselineDir, "baseline.json.gz"), gzipSync(Buffer.from(JSON.stringify(baseline))));
        baselineCreated = true;
      }
      report.baselineCreated = baselineCreated;

      const phases: Array<{ phase: string; atMs: number; bytesWritten: number }> = [];
      const exportStartedAt = Date.now();
      const phaseStarted = new Map<string, number>();
      const result = await exportPortablePackage({
        workspaceRoot,
        targetDir: outDir,
        appVersion: "1.1.3-scale-acceptance",
        snapshotDatabases: (targetRoot) => {
          store.backupDatabaseTo(path.join(targetRoot, "metadata.sqlite3"));
          fs.mkdirSync(path.join(targetRoot, "quick-notes"), { recursive: true });
          quickNotes.backupDatabaseTo(path.join(targetRoot, "quick-notes", "metadata.sqlite3"));
        },
        counts,
        onProgress: (progress) => {
          const now = Date.now() - exportStartedAt;
          if (!phaseStarted.has(progress.phase)) phaseStarted.set(progress.phase, now);
          const last = phases.at(-1);
          if (!last || last.phase !== progress.phase) phases.push({ phase: progress.phase, atMs: now, bytesWritten: progress.bytesWritten });
          else last.bytesWritten = Math.max(last.bytesWritten, progress.bytesWritten);
        },
      });
      const exportTotalMs = Date.now() - exportStartedAt;
      report.package = {
        path: result.path,
        bytes: result.bytes,
        entries: result.entries,
        counts: result.counts,
        retained: true,
        retainedReason: "由编排脚本 unzip -t 交叉校验后再决定是否删除（本测试从不删大文件）",
      };
      const phaseTimings: Record<string, number> = {};
      for (let index = 0; index < phases.length; index += 1) {
        const current = phases[index]!;
        const next = phases[index + 1];
        phaseTimings[current.phase] = (next ? next.atMs : exportTotalMs) - current.atMs;
      }
      report.exportTimings = { totalMs: exportTotalMs, phases: phaseTimings, progress: phases };
      expect(fs.existsSync(result.path)).toBe(true);
      expect(result.bytes).toBe(fs.statSync(result.path).size);
      console.log(`[portable] 导出完成：${(result.bytes / 1024 / 1024 / 1024).toFixed(2)}GiB / ${result.entries} 条目 / ${(exportTotalMs / 1000).toFixed(1)}s`);

      // ===== 结构校验（流式：只读 EOCD/中央目录，不整包进内存）=====
      const verifyStartedAt = Date.now();
      const directory = readCentralDirectory(result.path);
      const entries = directory.entries;
      expect(entries.length).toBe(result.entries);
      const byName = new Map(entries.map((entry) => [entry.name, entry]));
      expect(byName.size).toBe(entries.length);
      expect(directory.zip64).toBe(entries.length > 0xffff);
      const nonStore = entries.filter((entry) => entry.method !== 0);
      expect(nonStore).toEqual([]);
      const dataBytes = sumEntrySizes(entries);

      const manifestEntry = byName.get("portable.json");
      expect(manifestEntry).toBeTruthy();
      const manifestRaw = readEntryData(result.path, manifestEntry!);
      expect(crc32(manifestRaw)).toBe(manifestEntry!.crc);
      const manifest = parsePortableManifest(JSON.parse(manifestRaw.toString("utf8")));
      expect(manifest.formatVersion).toBe(2);
      expect(manifest.layout).toBe("desktop-workspace");
      expect(manifest.limitBytes).toBe(PORTABLE_LIMIT_BYTES);
      // counts.bytes 的定义 = 白名单文件 + 两 DB 快照 + baseline（**不含 portable.json 自身**），
      // 而 zip 数据字节和含 manifest 条目 ⇒ 差额必须正好是 manifest 条目大小。
      expect(manifest.counts.bytes).toBe(dataBytes - manifestEntry!.size);
      expect(manifest.counts.notes).toBe(result.counts.notes);
      expect(manifest.counts.assets).toBe(result.counts.assets);
      expect(manifest.counts.folders).toBe(counts.folders);
      expect(manifest.counts.quickNotes).toBe(counts.quickNotes);
      expect(manifest.counts.tags).toBe(counts.tags);
      expect(manifest.baseline).not.toBeNull();

      const prefixes = {
        bodies: entries.filter((entry) => /^desktop\/(notes|usheets|bitables|boards|inks)\//.test(entry.name)).length,
        assets: entries.filter((entry) => entry.name.startsWith("desktop/note-assets/") || entry.name.startsWith("desktop/quick-notes/assets/")).length,
        quickItems: entries.filter((entry) => entry.name.startsWith("desktop/quick-notes/items/")).length,
        databases: entries.filter((entry) => entry.name === "desktop/metadata.sqlite3" || entry.name === "desktop/quick-notes/metadata.sqlite3").length,
        baseline: entries.filter((entry) => entry.name === "desktop/sync-v3/baseline.json").length,
      };
      expect(prefixes.bodies).toBe(manifest.counts.notes);
      expect(prefixes.assets).toBe(manifest.counts.assets);
      expect(prefixes.quickItems).toBe(manifest.counts.quickNotes);
      expect(prefixes.databases).toBe(2);
      expect(prefixes.baseline).toBe(1);

      // v2（261122）：draft-journal/quick-notes/staging/materials 随包（用户内容）；history/ 仍恒排除。
      const forbiddenPrefixes = [
        "desktop/history/",
        "desktop/logs/",
        "desktop/backups/",
        "desktop/settings.json",
        "desktop/window-state.json",
        "desktop/sync-v3/state.json",
        "desktop/sync-v3/baseline.json.gz",
      ];
      const forbiddenFound = entries.filter((entry) => forbiddenPrefixes.some((prefix) => entry.name === prefix || entry.name.startsWith(prefix))).map((entry) => entry.name);
      expect(forbiddenFound).toEqual([]);

      const unsafeNames = entries.filter((entry) => {
        if (!entry.name || entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.includes(String.fromCharCode(0))) return true;
        return entry.name.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
      }).map((entry) => entry.name);
      expect(unsafeNames).toEqual([]);
      expect(entries.every((entry) => entry.name === "portable.json" || entry.name.startsWith("desktop/"))).toBe(true);

      // ===== 抽样读回（真实数据 + CRC）=====
      const seedReportPath = path.join(seedRoot, "seed-report.json");
      const seedReport = fs.existsSync(seedReportPath) ? (JSON.parse(fs.readFileSync(seedReportPath, "utf8")) as { actual?: { workspace?: { sampleNoteId?: string } } }) : null;
      const sampleNoteId = seedReport?.actual?.workspace?.sampleNoteId;
      const sampleNames = [
        "portable.json",
        "desktop/metadata.sqlite3",
        "desktop/quick-notes/metadata.sqlite3",
        "desktop/sync-v3/baseline.json",
        ...(sampleNoteId ? [`desktop/notes/${sampleNoteId}.lake`] : []),
        ...entries.filter((entry) => entry.name.startsWith("desktop/note-assets/")).slice(0, Math.max(1, sampleCount - 4)).map((entry) => entry.name),
      ].slice(0, Math.max(4, sampleCount));
      const sampleResults: Array<{ name: string; size: number; crcOk: boolean; extra: string }> = [];
      for (const name of sampleNames) {
        const entry = byName.get(name);
        if (!entry) throw new Error("抽样条目缺失：" + name);
        const data = readEntryData(result.path, entry);
        const crcOk = crc32(data) === entry.crc;
        let extra = "";
        if (name === "desktop/metadata.sqlite3" || name === "desktop/quick-notes/metadata.sqlite3") {
          extra = data.subarray(0, 15).toString("utf8");
          expect(extra).toBe("SQLite format 3");
        } else if (name === "desktop/sync-v3/baseline.json") {
          const baseline = JSON.parse(data.toString("utf8"));
          expect(typeof baseline.epoch).toBe("string");
          extra = "baseline.epoch=" + String(baseline.epoch);
        } else if (name.startsWith("desktop/notes/")) {
          const text = data.toString("utf8");
          expect(text).toContain("规模验收文档编号");
          extra = "含规模验收正文标记";
        } else if (name.startsWith("desktop/note-assets/")) {
          // 种子写的是「18 字节头 + N 字节填充」，所以文件比 --asset-bytes 略大（约 20.5KiB），不是精确 20480。
          expect(data.length).toBeGreaterThan(20_000);
          expect(data.length).toBeLessThan(21_000);
          expect(data.subarray(0, 18).toString("utf8")).toBe("LAKEX-SCALE-ASSET ");
          extra = "size=" + data.length;
        }
        expect(crcOk).toBe(true);
        sampleResults.push({ name, size: entry.size, crcOk, extra });
      }
      report.verify = {
        elapsedMs: Date.now() - verifyStartedAt,
        fileBytes: directory.fileBytes,
        centralDirectoryBytes: directory.centralDirSize,
        entries: entries.length,
        zip64: directory.zip64,
        storeOnlyOk: nonStore.length === 0,
        dataBytes,
        manifestBytes: manifestEntry!.size,
        countsBytesEqualsDataMinusManifest: manifest.counts.bytes === dataBytes - manifestEntry!.size,
        manifestOk: true,
        countsMatch: true,
        prefixCounts: prefixes,
        forbiddenAbsent: forbiddenFound.length === 0,
        nameSafetyOk: unsafeNames.length === 0,
        sample: sampleResults,
      };

      // ===== 移动端导入前兼容判定（常量从 Android 源码读，避免脚本里抄一份漂移）=====
      const kotlinPath = path.join(REPO_ROOT, "android", "app", "src", "main", "java", "com", "lakexlocalnotes", "android", "PortablePackagePlugin.kt");
      let maxEntries: number | null = null;
      let androidLimitBytes: number | null = null;
      if (fs.existsSync(kotlinPath)) {
        const kotlin = fs.readFileSync(kotlinPath, "utf8");
        const maxEntriesMatch = kotlin.match(/MAX_ENTRIES\s*=\s*([\d_]+)/);
        const limitMatch = kotlin.match(/PORTABLE_LIMIT_BYTES\s*=\s*(\d+)L?\s*\*\s*1024\s*\*\s*1024\s*\*\s*1024/);
        if (maxEntriesMatch) maxEntries = Number(maxEntriesMatch[1]!.replace(/_/g, ""));
        if (limitMatch) androidLimitBytes = Number(limitMatch[1]) * 1024 * 1024 * 1024;
      }
      const entriesOk = maxEntries === null ? null : entries.length <= maxEntries;
      const bytesOk = androidLimitBytes === null ? (directory.fileBytes <= PORTABLE_LIMIT_BYTES ? true : null) : directory.fileBytes <= androidLimitBytes;
      const mobileCompat = {
        source: kotlinPath,
        maxEntries,
        entries: entries.length,
        entriesOk,
        packageBytes: directory.fileBytes,
        androidLimitBytes,
        bytesOk,
        verdict: entriesOk === false || bytesOk === false ? "fail" : entriesOk === null ? "unknown" : "pass",
        notes: [
          "Android PortablePackagePlugin 用 ZipInputStream 逐条读取：本包 store-only、本地头带真实 CRC/大小、无数据描述符（正是为了这套解压器）。",
          maxEntries === null ? "未读到 MAX_ENTRIES，需人工核对。" : `MAX_ENTRIES=${maxEntries}；本包 ${entries.length} 条 ⇒ ${entriesOk ? "通过" : "超出上限，手机导入会报「zip 条目过多」"}。`,
          "导入前还需：包体 ≤4GiB、portable.json 的 format/formatVersion/layout/limitBytes 校验（本测试已用 parsePortableManifest 覆盖）。",
        ],
      };
      report.mobileCompat = mobileCompat;

      if (mobileCompat.verdict === "fail") {
        // 这是「验收结论」而非导出失败：如实写进报告，由编排脚本映射成独立退出码（2 = 包能导但手机装不下），
        // 不让它冒充脚本 bug，也不静默当通过。
        console.warn("[portable] 移动端导入前兼容校验不通过：" + mobileCompat.notes[1]);
      }
    } finally {
      try { quickNotes.databaseHandle.close(); } catch { /* 已关 */ }
      try { store.close(); } catch { /* 已关 */ }
      report.elapsedMs = Date.now() - startedAt;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
      console.log(`[portable] 报告已写入 ${reportPath}`);
    }

    expect(errors).toEqual([]);
  }, 1_800_000);
});
