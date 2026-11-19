/**
 * 「拍照」入口接线护栏（261118「拍照变相册」修复）：
 *  · dock 拍照必须走原生相机（takeCameraPhoto）→ 内核 insertFiles，不得再走隐藏 file input 的 capture 属性
 *    （WebView 会把 capture 吞掉退化成相册，见 native/cameraCapture.ts 头注释）；
 *  · 图片/附件/音频/视频仍走隐藏 file input（行为保持现状）；
 *  · web 预览降级（回退 file input）在 cameraCapture 模块里，必须保留。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string): string => readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOST = strip(read("src/mobile/editor/EditorDockHost.tsx"));
const CAMERA = strip(read("src/mobile/native/cameraCapture.ts"));

describe("dock「拍照」= 原生相机直出（261118）", () => {
  it("拍照走 takeCameraPhoto，不再给隐藏 input 传 capture", () => {
    expect(HOST).toContain("import { takeCameraPhoto }");
    expect(HOST).toContain("const file = await takeCameraPhoto()");
    expect(HOST).toContain('onInsertCamera={() => void insertCameraPhoto()}');
    expect(HOST).not.toMatch(/setAttribute\(\s*"capture"/);
    expect(HOST).not.toContain('insertFileViaInput("image/*", "environment")');
  });

  it("拍照结果与相册选图走同一条 insertFiles 通道", () => {
    expect(HOST).toContain('execEditorCommandResult(ed, "insertFiles", [file], opts)');
    expect(HOST).toContain("if (file) insertFile(file)");
  });

  it("隐藏 file input 仍是 图片/附件/音频/视频 的入口（行为保持现状）", () => {
    expect(HOST).toContain('onInsertImage={() => insertFileViaInput("image/*")}');
    expect(HOST).toContain('onInsertAttachment={() => insertFileViaInput("")}');
    expect(HOST).toContain('onInsertAudio={() => insertFileViaInput("audio/*")}');
    expect(HOST).toContain('onInsertVideo={() => insertFileViaInput("video/*")}');
  });

  it("web 预览降级保留在 cameraCapture：无原生桥回退 file input（保持现状）", () => {
    expect(CAMERA).toContain('return pickLocalFile("image/*", "environment")');
    // 原生失败/取消不得回退选择器（绝不静默开相册）。
    expect(CAMERA).not.toMatch(/catch \{[\s\S]{0,120}pickLocalFile/);
  });
});
