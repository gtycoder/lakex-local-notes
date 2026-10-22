/**
 * 系统分享（ACTION_SEND）接线护栏（260920）。
 *
 * 链路：别的 App 分享 → MainActivity（android.intent.action.SEND）→ SharedContentPlugin 接住
 *   （文本原样；图片复制到 filesDir/shared-inbox/）→ JS 冷启动 consume / 热启动 "shared" 事件
 *   → 打开小记 capture 入口并预填：261010 统一成内核卡片后，seed **先落成草稿**（图片落盘 + 正文由无内核写入通道合成），
 *     再由 composer 挂载时恢复 —— 不再有 `seed=` prop（详见 quickNoteCapturePath.test.ts）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("系统分享接入（ACTION_SEND）", () => {
  it("Manifest 注册了文本/图片分享 intent-filter（要 CATEGORY_DEFAULT）", () => {
    const mf = read("../../../android/app/src/main/AndroidManifest.xml");
    expect(mf).toMatch(/android\.intent\.action\.SEND/);
    expect(mf).toMatch(/android:mimeType="text\/plain"/);
    expect(mf).toMatch(/android:mimeType="image\/\*"/);
    expect(mf).toMatch(/android\.intent\.category\.DEFAULT/);
  });

  it("原生插件接住分享，冷启动 load / 热启动 handleOnNewIntent 都覆盖", () => {
    const kt = read("../../../android/app/src/main/java/com/locallakexnotes/mobile/SharedContentPlugin.kt");
    expect(kt).toMatch(/Intent\.ACTION_SEND/);
    expect(kt).toMatch(/override fun load\(\)/);
    expect(kt).toMatch(/handleOnNewIntent/);
    expect(kt).toMatch(/notifyListeners\("shared"/);
    expect(kt).toMatch(/shared-inbox/);
  });

  it("App 冷启动 consume + 热启动 subscribe，并把分享变成小记 seed", () => {
    const app = read("../MobileApp.tsx");
    expect(app).toMatch(/consumeSharedContent\(/);
    expect(app).toMatch(/subscribeSharedContent\(/);
    // 261010：seed 不再走 prop，而是先落成草稿（图片落盘 + body 合成），再由 composer 恢复
    expect(app).toMatch(/sharedContentToSeed/);
    expect(app).toMatch(/saveQuickNoteDraft\(\{ id, text: captureSeed\.text, body, images \}\)/);
    expect(app).toMatch(/<QuickNoteComposerLazy[\s\S]{0,200}draft/);
    const share = read("./sharedContent.ts");
    expect(share).toMatch(/Directory\.Data/);
    expect(share).toMatch(/registerPlugin<SharedContentPluginApi>\("SharedContent"\)/);
  });
});
