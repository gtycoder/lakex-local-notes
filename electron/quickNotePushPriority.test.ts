/**
 * 「保存并同步」= 高优先域（261110 提速）的**接线护栏**。
 *
 * 用户原话：这是唯一用户主动发起的 S3 同步特例，**必须最快**；只推当前这条小记，
 * 不等在途整轮同步、不处理其他待同步。
 *
 * 钉住三件事：
 *  · 桌面 `sync_quick_note` 不再包 `enqueueMaintenance`（那会和整轮同步/GC 同一串行队列）；
 *  · controller 的单条推送走独立 priority 门（不等 v3 整轮串行门）；跨进程互斥仍靠 S3 发布锁 + CAS；
 *  · 判据登记在 core maintenancePolicy：syncQuickNote = priority（桌面/移动同语义）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyOp, PRIORITY_OPS } from "../src/core/maintenancePolicy.js";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("保存并同步 = 高优先域（261110）", () => {
  it("桌面 sync_quick_note 不再进维护队列，直接走 priority 推送入口；存在性只查 DB 行", () => {
    const src = read("electron/ipc/registerQuickNotes.ts");
    const start = src.indexOf('ipc.handle("sync_quick_note"');
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf("ipc.handle(", start + 1);
    const block = src.slice(start, next < 0 ? undefined : next);
    expect(block).toContain("pushQuickNoteViaEngine(store, id");
    expect(block, "单条推送不得再排维护队列（会等大同步）").not.toContain("enqueueMaintenance");
    expect(block, "存在性判断不读正文（引擎里还会读一次正文）").toContain("hasQuickNote(id)");
    expect(block).not.toContain("readQuickNote(id)");
  });

  it("controller：单条推送有自己的 priority 门，不与整轮 v3 串行门互相等待；回退整轮仍走同步入口", () => {
    const src = read("electron/syncEngineController.ts");
    const start = src.indexOf("export async function pushQuickNoteViaEngine");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("export async function ensureTrashNoteAssets");
    const block = src.slice(start, end < 0 ? undefined : end);
    expect(block).toContain("serializedQuickPush");
    expect(block, "不得再等 v3 整轮串行门（那正是用户说的\"顾虑其他待同步\"）").not.toContain("serializedV3(");
    // 回退整轮仍走同步入口（含 v3Gate），避免同进程两个整轮并发写基线。
    expect(block).toContain("fullSync: (onProgress) => syncNowViaEngine(store, onProgress)");
    // remote/client 缓存（同 settings 复用，失败失效）。
    expect(block).toContain("pushRemoteFor(settings)");
  });

  it("判据登记：syncQuickNote 属于高优先域（沿用既有 op，不新造第二套）", () => {
    expect(PRIORITY_OPS).toContain("syncQuickNote");
    expect(classifyOp("syncQuickNote")).toBe("priority");
  });

  it("移动端同语义：bridge 走 runPriority，且只读一次设置（mobileCloudContext）", () => {
    const quick = read("src/mobile/bridge/quickNotes.ts");
    expect(quick).toContain("runPriority(\"syncQuickNote\"");
    expect(quick).toContain("mobileCloudContext()");
    expect(read("src/mobile/bridge/sync.ts")).toContain("deps.cfg ?? await syncDomain.getS3Settings()");
  });
});
