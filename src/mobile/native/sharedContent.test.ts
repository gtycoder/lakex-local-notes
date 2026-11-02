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
    // 261102 T2-C：PDF 分享入口（不声明 octet-stream，避免成为所有二进制的分享目标）
    expect(mf).toMatch(/android:mimeType="application\/pdf"/);
    expect(mf).toMatch(/android\.intent\.category\.DEFAULT/);
  });

  it("原生插件接住分享，冷启动 load / 热启动 handleOnNewIntent 都覆盖", () => {
    const kt = read("../../../android/app/src/main/java/com/lakexlocalnotes/android/SharedContentPlugin.kt");
    expect(kt).toMatch(/Intent\.ACTION_SEND/);
    expect(kt).toMatch(/override fun load\(\)/);
    expect(kt).toMatch(/handleOnNewIntent/);
    expect(kt).toMatch(/notifyListeners\("shared"/);
    expect(kt).toMatch(/shared-inbox/);
    // 261102 T2-C：PDF 扩展名 + octet-stream 时按 DISPLAY_NAME 兜底 + 显式 kind 分类 + PDF 单独限额
    expect(kt).toMatch(/mime\.startsWith\("application\/pdf"\) -> return "\.pdf"/);
    expect(kt).toMatch(/OpenableColumns\.DISPLAY_NAME/);
    expect(kt).toMatch(/endsWith\("\.pdf"\)/);
    expect(kt).toMatch(/classifyShared/);
    expect(kt).toMatch(/const val KIND_PDF = "pdf"/);
    expect(kt).toMatch(/MAX_PDF_INBOX_BYTES/);
    expect(kt).toMatch(/out\.put\("kind"/);
    // 旧字段必须还在（向后兼容/回滚）
    expect(kt).toMatch(/out\.put\("imageFilename"/);
  });

  it("App 冷启动 consume + 热启动 subscribe，并把分享变成小记 seed", () => {
    const app = read("../MobileApp.tsx");
    expect(app).toMatch(/consumeSharedContent\(/);
    expect(app).toMatch(/subscribeSharedContent\(/);
    // 261010：seed 不再走 prop，而是先落成草稿（图片落盘 + body 合成），再由 composer 恢复
    expect(app).toMatch(/sharedContentToSeed/);
    // 261102 T2-C：PDF/文件分享先给可见提示，不静默当图片
    expect(app).toMatch(/sharedContentUnsupportedHint\(content\)/);
    expect(app).toMatch(/showToast\(unsupported, \{ type: "error" \}\)/);
    expect(app).toMatch(/saveQuickNoteDraft\(\{ id, text: captureSeed\.text, body, images \}\)/);
    expect(app).toMatch(/<QuickNoteComposerLazy[\s\S]{0,200}draft/);
    const share = read("./sharedContent.ts");
    expect(share).toMatch(/Directory\.Data/);
    expect(share).toMatch(/registerPlugin<SharedContentPluginApi>\("SharedContent"\)/);
    // 261102 T2-C：seed 守卫 —— 只有 image 才读字节；旧 APK 无 kind 时按 mime/后缀兜底
    expect(share).toMatch(/export function sharedContentKind/);
    expect(share).toMatch(/kind !== "image"/);
    expect(share).toMatch(/application\/pdf/);
  });
});
