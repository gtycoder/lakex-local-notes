import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FILE_RECONCILE_DEFAULTS,
  FileMetadataReconciler,
  decideFileReconcile,
  scanOrphanBodyFiles,
  type ReconcileThrottleInput,
} from "./fileMetadataReconcile.js";

/**
 * Batch4-B：文件↔元数据对账（只报告版）。
 * 重点护栏：
 * 1) 节流判据纯函数（不满足一律不跑）；
 * 2) 扫描只 stat：字段齐全、空库/大库上界；
 * 3) 调度器 TryLock + 维护域串行 + 拿锁后二次判空闲（不重入、不并发）。
 */

const NOW = 1_800_000_000_000;

function throttle(over: Partial<ReconcileThrottleInput> = {}): ReconcileThrottleInput {
  return {
    enabled: true,
    running: false,
    afterSyncPending: true,
    dirty: true,
    idleSeconds: 600,
    minIdleSeconds: 300,
    nowMs: NOW,
    lastRunAtMs: null,
    cooldownMs: FILE_RECONCILE_DEFAULTS.cooldownMs,
    ...over,
  };
}

describe("decideFileReconcile：严格节流判据", () => {
  it("满足全部条件才跑", () => {
    expect(decideFileReconcile(throttle())).toEqual({ run: true, reason: "ok" });
  });

  it("默认关闭（disabled）不跑；manual 例外", () => {
    expect(decideFileReconcile(throttle({ enabled: false }))).toEqual({ run: false, reason: "disabled" });
    expect(decideFileReconcile(throttle({ enabled: false, manual: true })).run).toBe(true);
  });

  it("TryLock 被占（running）不跑", () => {
    expect(decideFileReconcile(throttle({ running: true }))).toEqual({ run: false, reason: "running" });
  });

  it("没有「同步完成」打点不跑", () => {
    expect(decideFileReconcile(throttle({ afterSyncPending: false }))).toEqual({ run: false, reason: "waiting-sync" });
  });

  it("没有 dirty 不跑", () => {
    expect(decideFileReconcile(throttle({ dirty: false }))).toEqual({ run: false, reason: "no-dirty" });
  });

  it("空闲不足不跑，并给出等待时间", () => {
    const d = decideFileReconcile(throttle({ idleSeconds: 299, minIdleSeconds: 300 }));
    expect(d.run).toBe(false);
    expect(d.reason).toBe("not-idle");
    expect(d.waitMs).toBe(1000);
  });

  it("冷却未到不跑，并给出剩余时间", () => {
    const d = decideFileReconcile(throttle({ lastRunAtMs: NOW - 1000, cooldownMs: 60_000 }));
    expect(d.run).toBe(false);
    expect(d.reason).toBe("cooldown");
    expect(d.waitMs).toBe(59_000);
  });

  it("manual 绕过 idle/dirty/同步/冷却（仍受 running 约束）", () => {
    const d = decideFileReconcile(throttle({ dirty: false, afterSyncPending: false, idleSeconds: 0, lastRunAtMs: NOW, manual: true }));
    expect(d.run).toBe(true);
    expect(decideFileReconcile(throttle({ running: true, manual: true }))).toEqual({ run: false, reason: "running" });
  });
});

describe("scanOrphanBodyFiles：只 stat、字段齐全", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  function freshRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-reconcile-scan-"));
    dirs.push(root);
    for (const d of ["notes", "usheets", "boards", "bitables", "inks"]) fs.mkdirSync(path.join(root, d), { recursive: true });
    return root;
  }

  it("文件在、行丢：候选带 id/kind/相对路径/size/mtime；已知行与非法名被正确忽略", () => {
    const root = freshRoot();
    fs.writeFileSync(path.join(root, "notes", "a.lake"), "<p>known</p>");
    fs.writeFileSync(path.join(root, "notes", "lost.lake"), "<p>orphan</p>");
    fs.writeFileSync(path.join(root, "usheets", "u-lost.usheet.json"), "{}");
    fs.writeFileSync(path.join(root, "boards", "b-lost.board.json"), "{}");
    fs.writeFileSync(path.join(root, "notes", "tmp.lake.tmp-123"), "x");        // 非契约后缀
    fs.writeFileSync(path.join(root, "notes", "..lake"), "x");                  // 反解 id="." 非法
    const report = scanOrphanBodyFiles({ root, knownNoteIds: new Set(["a"]) });
    expect(report.knownRows).toBe(1);
    expect(report.scannedFiles).toBe(4); // a / lost / u-lost / b-lost
    expect(report.ignoredFiles).toBe(2);
    expect(report.candidateCount).toBe(3);
    expect(report.truncated).toBe(false);
    const lost = report.candidates.find((c) => c.noteId === "lost")!;
    expect(lost).toMatchObject({ kind: "doc", relativePath: "notes/lost.lake", sizeBytes: "<p>orphan</p>".length });
    expect(lost.mtimeMs).toBeGreaterThan(0);
    expect(report.candidates.map((c) => c.noteId).sort()).toEqual(["b-lost", "lost", "u-lost"]);
    expect(report.missingBodyDirs).toEqual([]); // 五个正文目录都在（空目录 ≠ 缺失）
  });

  it("空库不抛错、零候选", () => {
    const root = freshRoot();
    const report = scanOrphanBodyFiles({ root, knownNoteIds: new Set() });
    expect(report.scannedFiles).toBe(0);
    expect(report.candidates).toEqual([]);
    expect(report.candidateCount).toBe(0);
    expect(report.missingBodyDirs).toEqual([]);
  });

  it("正文目录不存在 = missingBodyDirs（正常），不抛错", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-reconcile-empty-"));
    dirs.push(root);
    const report = scanOrphanBodyFiles({ root, knownNoteIds: new Set() });
    expect(report.missingBodyDirs.sort()).toEqual(["bitables", "boards", "inks", "notes", "usheets"]);
  });

  it("候选数超上限：截断并置 truncated（不把报告撑爆）", () => {
    const root = freshRoot();
    for (const id of ["o1", "o2", "o3"]) fs.writeFileSync(path.join(root, "notes", id + ".lake"), "x");
    const report = scanOrphanBodyFiles({ root, knownNoteIds: new Set(), maxCandidates: 2 });
    expect(report.candidates).toHaveLength(2);
    expect(report.truncated).toBe(true);
  });

  it("大库上界：2 万已知行 + 数百候选文件仍在预算内（只 stat）", () => {
    const root = freshRoot();
    const known = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) known.add("known-" + i);
    for (let i = 0; i < 300; i += 1) fs.writeFileSync(path.join(root, "notes", "orphan-" + i + ".lake"), "x");
    const t0 = Date.now();
    const report = scanOrphanBodyFiles({ root, knownNoteIds: known });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(report.scannedFiles).toBe(300);
    expect(report.candidateCount).toBe(300);
  });
});

/** 维护域队列替身：记录串行度/并发峰值。 */
function makeMaintenanceQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  let active = 0;
  let maxActive = 0;
  const calls: string[] = [];
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    calls.push("enqueue");
    const run = chain.then(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try { return await task(); } finally { active -= 1; }
    }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try { return await task(); } finally { active -= 1; }
    });
    chain = run.then(() => undefined, () => undefined);
    return run as Promise<T>;
  };
  return { enqueue, calls, get maxActive() { return maxActive; } };
}

describe("FileMetadataReconciler：TryLock + 维护域串行", () => {
  function makeReconciler(over: Partial<Parameters<typeof buildReconciler>[0]> = {}) {
    return buildReconciler({ ...defaults(), ...over });
  }
  function defaults() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-reconcile-run-"));
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    return {
      root,
      idle: 600,
      queue: makeMaintenanceQueue(),
      enabled: true,
    };
  }
  function buildReconciler(cfg: { root: string; idle: number; queue: ReturnType<typeof makeMaintenanceQueue>; enabled: boolean }) {
    const getIdleSeconds = vi.fn(() => cfg.idle);
    const listKnownNoteIds = vi.fn(() => ["known-1", "known-2"] as Iterable<string>);
    const reconciler = new FileMetadataReconciler({
      root: cfg.root,
      listKnownNoteIds,
      getIdleSeconds,
      enqueueMaintenance: cfg.queue.enqueue,
      enabled: cfg.enabled,
      minIdleSeconds: 300,
      cooldownMs: 30 * 60 * 1000,
      now: () => NOW,
      log: () => undefined,
    });
    return { reconciler, getIdleSeconds, listKnownNoteIds, queue: cfg.queue, root: cfg.root };
  }

  const disposables: Array<{ dispose(): void }> = [];
  afterEach(() => { for (const d of disposables.splice(0)) d.dispose(); });

  it("条件不满足：完全不进维护队列（不跑）", async () => {
    const { reconciler, queue } = makeReconciler();
    disposables.push(reconciler);
    expect(await reconciler.tryRun()).toEqual({ ran: false, reason: "waiting-sync" });
    expect(queue.calls).toEqual([]);
  });

  it("同步完成 + 空闲达标：进维护队列并产出报告；随后清 dirty/同步标记", async () => {
    const { reconciler, queue, root } = makeReconciler();
    disposables.push(reconciler);
    fs.writeFileSync(path.join(root, "notes", "orphan.lake"), "x");
    reconciler.onSyncComplete();
    reconciler.dispose();
    const out = await reconciler.tryRun();
    expect(out.ran).toBe(true);
    expect(out.report?.candidateCount).toBe(1);
    expect(out.report?.trigger).toBe("sync-idle");
    expect(queue.calls).toEqual(["enqueue"]);
    expect(reconciler.getLastReport()).toEqual(out.report);
    // 打点已消费：再次调用不会跑
    expect(await reconciler.tryRun()).toEqual({ ran: false, reason: "waiting-sync" });
  });

  it("拿锁后二次判空闲：排队期间用户回来 ⇒ 跳过且不推进 lastRun/报告", async () => {
    const { reconciler, getIdleSeconds } = makeReconciler();
    disposables.push(reconciler);
    reconciler.onSyncComplete();
    reconciler.dispose();
    getIdleSeconds.mockReturnValueOnce(600).mockReturnValueOnce(0);
    expect(await reconciler.tryRun()).toEqual({ ran: false, reason: "not-idle" });
    expect(reconciler.getLastReport()).toBeNull();
  });

  it("冷却期内不重跑（launch 后立即再触发）", async () => {
    const { reconciler } = makeReconciler();
    disposables.push(reconciler);
    reconciler.onSyncComplete();
    reconciler.dispose();
    expect((await reconciler.tryRun()).ran).toBe(true);
    reconciler.onSyncComplete();
    reconciler.dispose();
    expect(await reconciler.tryRun()).toEqual({ ran: false, reason: "cooldown" });
  });

  it("TryLock 不重入：并发调用第二次直接 running；维护队列并发峰值=1", async () => {
    const { reconciler, queue } = makeReconciler();
    disposables.push(reconciler);
    reconciler.onSyncComplete();
    reconciler.dispose();
    const first = reconciler.tryRun();
    const second = await reconciler.tryRun();
    expect(second).toEqual({ ran: false, reason: "running" });
    expect((await first).ran).toBe(true);
    expect(queue.maxActive).toBe(1);
    expect(queue.calls).toEqual(["enqueue"]);
  });

  it("维护域串行：排在一个正在跑的维护任务后面，不并发扫描（峰值=1）", async () => {
    const { reconciler, queue } = makeReconciler();
    disposables.push(reconciler);
    reconciler.onSyncComplete();
    reconciler.dispose();
    let release!: () => void;
    const blocker = queue.enqueue(() => new Promise<void>((resolve) => { release = resolve; }));
    const run = reconciler.tryRun();
    await Promise.resolve();
    expect(queue.maxActive).toBe(1); // 只在跑 blocker
    release();
    await blocker;
    expect((await run).ran).toBe(true);
    expect(queue.maxActive).toBe(1);
  });

  it("manual 报告：功能关闭也能手动生成（只读）", async () => {
    const { reconciler } = makeReconciler({ enabled: false });
    disposables.push(reconciler);
    const out = await reconciler.tryRun({ manual: true });
    expect(out.ran).toBe(true);
    expect(out.report?.trigger).toBe("manual-report");
    expect(out.report?.enabled).toBe(false);
  });
});
