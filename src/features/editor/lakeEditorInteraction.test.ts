/**
 * LakeEditor 交互档（Q07A）与预览字号（Q05B）的源码级护栏。
 *
 * 预览宿主（移动回收站 / 移动历史快照）要求：
 *  · interaction="preview" 必须**跳过**卡片长按菜单与 copy/cut 接管（只读宿主不提供写操作入口）；
 *  · 必须**保留** tap 图片预览与 file 卡打开（Q07A 选 A 的全部理由：别丢能力）；
 *  · 默认值 "editor" 完全等于现状（默认值回退，可回退）。
 * 真机内核无法在 vitest 里起，故用源码断言锁契约（与 desktopKernelLazy 等既有护栏同风格）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSrc = (rel: string) => readFileSync(rel, "utf8");
const LAKE_EDITOR = readSrc("src/features/editor/LakeEditor.tsx");
const NOTE_DOC_PREVIEW = readSrc("src/components/app/NoteDocPreview.tsx");

describe("LakeEditor interaction=preview（Q07A）", () => {
  it("新增 interaction 档，默认 editor（默认值回退）", () => {
    expect(LAKE_EDITOR).toContain('export type LakeEditorInteraction = "editor" | "preview"');
    expect(LAKE_EDITOR).toMatch(/interaction = "editor"/);
    expect(LAKE_EDITOR).toContain("const previewOnly = interaction === \"preview\";");
  });

  it("preview 档跳过卡片长按菜单与 copy/cut 接管", () => {
    // 长按：previewOnly 直接 return（不挂 attachLongPress）
    expect(LAKE_EDITOR).toMatch(/if \(!host \|\| previewOnly\) return;/);
    // 复制/剪切：preview 档不挂 attachSelectionClipboard
    expect(LAKE_EDITOR).toMatch(/const detachSelectionClipboard = previewOnly \? \(\) => undefined : attachSelectionClipboard\(host\);/);
    // 两个 effect 都要把 interaction 纳入依赖（切档必须重挂监听）
    expect(LAKE_EDITOR).toContain("}, [previewOnly]);");
    expect(LAKE_EDITOR).toContain("}, [noteId, mode, previewOnly, tocEnabled, prefs?.fontSize, prefs?.showToolbar]);");
  });

  it("preview 档保留 tap 图片预览与 file 卡打开", () => {
    expect(LAKE_EDITOR).toContain("attachImagePreviewClick");
    expect(LAKE_EDITOR).toContain("attachFileCardClick");
    // 图片/附件监听不得被 previewOnly 短路（只有长按和 copy/cut 被跳过）
    expect(LAKE_EDITOR).not.toMatch(/if \(previewOnly\) return;[\s\S]{0,200}attachImagePreviewClick/);
  });
});

describe("预览固定阅读档字号（Q05B）", () => {
  it("LakeEditor 与桌面 NoteDocPreview 用同一档值（16），移动用自己的常量引用它", () => {
    const lake = LAKE_EDITOR.match(/export const LAKE_PREVIEW_FONT_SIZE = (\d+);/);
    const doc = NOTE_DOC_PREVIEW.match(/export const NOTE_DOC_PREVIEW_FONT_SIZE = (\d+);/);
    expect(lake?.[1]).toBeTruthy();
    expect(doc?.[1]).toBeTruthy();
    // 同语义同值：两边都是字面量，靠这条断言防漂移（不要各自改成不同档）
    expect(lake?.[1]).toBe(doc?.[1]);
    expect(lake?.[1]).toBe("16");
  });
});
