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
    const ws = code(read("./QuickNotesWorkspace.tsx"));
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
