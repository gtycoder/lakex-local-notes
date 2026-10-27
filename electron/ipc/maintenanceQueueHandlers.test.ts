/**
 * 维护域范围护栏（IPC 侧，261023）：**出网的"恢复"类 IPC 必须进 enqueueMaintenance**。
 *
 * 为什么要有：桌面 261023 新增的两条云恢复通道里，正文那条一开始是裸 handle ⇒
 * 读清单/取对象都是网络往返，落地后还要改 sync_base/sync_state，与在途整轮同步/GC
 * 并发就会互踩同一篇的账本（AGENTS §4 互斥域：I1 网络往返不得持有写域、I3 同域串行）。
 * 小记那条从一开始就是对的（本用例把它一起钉住），正文这条本批修正。
 *
 * 判据来源：src/core/maintenancePolicy.ts（write / maintenance / priority 必须分域）。
 * 反向（F16：本地写不得进维护域）由 electron/maintenanceQueueScope.test.ts 盯住主进程入口。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 通道 → 期望它在处理体里调用的恢复函数（也是"提取器没静默失效"的自证样本）。 */
const RECOVERY_CHANNELS = [
  {
    file: "electron/ipc/registerSync.ts",
    channel: "restore_missing_body_from_cloud",
    fn: "restoreMissingBodyFromCloud",
  },
  {
    file: "electron/ipc/registerQuickNotes.ts",
    channel: "restore_missing_quick_note_from_cloud",
    fn: "fetchQuickNoteFromV3",
  },
] as const;

/**
 * 取一个通道的处理体：从 `ipc.handle("<channel>"` 那行起，到下一个 `ipc.handle(` 行为止。
 * （本仓的 handle 都是平铺注册、不在别处嵌套定义，够用且不给未来加解析器。）
 */
function handlerBody(source: string, channel: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes('ipc.handle("' + channel + '"'));
  if (start < 0) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start && /^\s*ipc\.handle\(/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

describe("出网恢复类 IPC 必须进维护域", () => {
  it("每个通道都能从源码里取到处理体（提取器自证，防静默失效）", () => {
    for (const { file, channel, fn } of RECOVERY_CHANNELS) {
      const body = handlerBody(read(file), channel);
      expect(body.length, file + " 里找不到 " + channel).toBeGreaterThan(0);
      expect(body, channel + " 的处理体里应调用 " + fn).toContain(fn);
    }
  });

  it("云端恢复正文 / 云端恢复小记都包在 enqueueMaintenance 里", () => {
    for (const { file, channel } of RECOVERY_CHANNELS) {
      const body = handlerBody(read(file), channel);
      expect(body, channel + " 是出网通道：必须 enqueueMaintenance 包裹，否则与整轮同步并发互踩账本").toContain(
        "enqueueMaintenance(",
      );
    }
  });
});
