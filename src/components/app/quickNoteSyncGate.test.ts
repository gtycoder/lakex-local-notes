/**
 * 「保存并同步」的**可用性门禁**护栏（用户 261013 定稿：云同步关闭 ⇒ 按钮**置灰 + 给理由**，两端同构）。
 *
 * 两条硬要求：
 *  1. 判据必须来自 core/cloudState（桌面 isCloudActive / 移动 canTouchNetwork(getCloudState)），**不许各自读 enabled**（AGENTS §3#20）；
 *  2. 置灰必须给得出理由（桌面 title→.ln-tip；移动一行可见说明 —— 移动端没有 hover）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 去掉块注释与整行行注释，避免"注释里提到某名字"误判。 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("「保存并同步」可用性门禁（云同步关闭 ⇒ 置灰 + 理由）", () => {
  it("桌面：App 用 cloudState 的 UI 判据，工作区按钮按 cloudReady 置灰", () => {
    const app = code(read("../../App.tsx"));
    const ws = code(read("./QuickNoteComposer.tsx"));
    expect(app, "判据走 cloudState 的 UI 判据（没配置/关了开关都算本地）").toMatch(/isCloudActive\(cloudConfigured, cloudEnabled\)/);
    expect(app).toMatch(/cloudReady=\{/);
    expect(ws, "「保存并同步」在云同步不可用时置灰").toMatch(/disabled=\{busy \|\| !cloudReady\}/);
    expect(ws, "置灰要给理由（title 会被全局换成 .ln-tip）").toMatch(/云同步已关闭/);
  });

  it("移动：写作卡按 getCloudState 置灰 + 给一行可见说明（移动端没有 hover）", () => {
    const composer = code(read("../../mobile/home/QuickNoteComposer.tsx"));
    const bridge = code(read("../../mobile/bridge.ts")) + code(read("../../mobile/bridge/quickNotes.ts"));
    expect(bridge, "bridge 应暴露云状态（复用 mobileCloudState 单一判据）").toMatch(/async getCloudState\(\)/);
    expect(composer).toMatch(/bridge\.getCloudState\(\)/);
    expect(composer).toMatch(/canTouchNetwork\(state\)/);
    expect(composer, "「保存并同步」在云同步不可用时置灰").toMatch(/disabled=\{saving \|\| syncing \|\| !cloudReady\}/);
    expect(composer, "置灰必须给可见理由").toMatch(/mobile-qn-hint/);
  });
});
/**
 * F-04（261112 审计）：`full-sync.reason` 曾被两端适配层折叠成 `no-remote-manifest` ⇒
 * 「云端索引已变化 / 本机缺基线」被谎报成「云端还没有小记数据」。这里钉住：
 *  ① 理由词表 = core/s3v3/quickPush 的真实 4 个（单边改词表会被抓住）；
 *  ② 4 句文案来自**唯一来源** `core/quickNoteSyncTypes.QUICK_NOTE_FULL_SYNC_TEXT`，两端都取它、不再手写条件分支。
 */
import { QUICK_NOTE_FULL_SYNC_TEXT } from "../../core/quickNoteSyncTypes";

describe("「保存并同步」回退整轮：4 个理由 → 准确文案（F-04）", () => {
  it("理由词表与 quickPush 管线一致（4 个，且不再是折叠值）", () => {
    expect(Object.keys(QUICK_NOTE_FULL_SYNC_TEXT).sort()).toEqual([
      "cloud-changed", "no-baseline", "no-cloud", "remote-deleted",
    ]);
    const pipeline = code(read("../../core/s3v3/quickPush/pipeline.ts"));
    for (const reason of ["no-cloud", "no-baseline", "cloud-changed", "remote-deleted"]) {
      expect(pipeline, `quickPush 必须真的能返回 reason=${reason}`).toContain('"' + reason + '"');
    }
    // 词表与 quickPush 的类型定义逐字一致（单边加/删理由会被抓住）
    const pipelineTypes = code(read("../../core/s3v3/quickPush/types.ts"));
    expect(pipelineTypes).toMatch(/reason: "no-cloud" \| "no-baseline" \| "cloud-changed" \| "remote-deleted"/);
    // 折叠值已废：禁止再出现在类型与两端适配层
    const types = code(read("../../core/quickNoteSyncTypes.ts"));
    expect(types).not.toMatch(/no-remote-manifest/);
    expect(code(read("../../../electron/s3v3/desktopSync.ts"))).not.toMatch(/no-remote-manifest/);
    expect(code(read("../../mobile/bridge/sync.ts"))).not.toMatch(/no-remote-manifest/);
  });

  it("4 句文案互不相同；非删除类都说明「已改为执行一次完整同步」，删除类说明按删除处理", () => {
    const entries = Object.entries(QUICK_NOTE_FULL_SYNC_TEXT);
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map(([, text]) => text)).size, "4 句必须互不相同（否则等于没分理由）").toBe(4);
    for (const [reason, text] of entries) {
      if (reason === "remote-deleted") {
        expect(text, "远端墓碑 = 按删除处理，且已跑过整轮").toMatch(/其他设备删除/);
        expect(text).toMatch(/完整同步/);
      } else {
        expect(text, `reason=${reason} 必须如实说明已执行完整同步`).toContain("已改为执行一次完整同步");
      }
    }
  });

  it("两端 UI 都从同一来源取文案（不再按单个理由手写字符串）", () => {
    const ws = code(read("./QuickNotesWorkspace.tsx"));
    const composer = code(read("../../mobile/home/QuickNoteComposer.tsx"));
    for (const [name, src] of [["桌面 QuickNotesWorkspace", ws], ["移动 QuickNoteComposer", composer]] as const) {
      expect(src, `${name} 必须用 QUICK_NOTE_FULL_SYNC_TEXT[outcome.reason]`).toMatch(/QUICK_NOTE_FULL_SYNC_TEXT\[outcome\.reason\]/);
    }
  });
});
