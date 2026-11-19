/**
 * AI 助手「拍照」入口护栏（261118「拍照变相册」修复）：拍照走原生相机（takeCameraPhoto）；
 * 「相册」保持既有 file input 选择行为不变；AI 页不得再有 capture 型 file input。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string): string => readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const AI_PAGE = strip(read("src/mobile/ai/MobileAiPage.tsx"));

describe("AI 助手「拍照」= 原生相机直出（261118）", () => {
  it("拍照走 takeCameraPhoto；相册仍是 pickLocalFiles（行为保持现状）", () => {
    expect(AI_PAGE).toContain('void import("../native/cameraCapture").then((m) => m.takeCameraPhoto()).then((file) => addPickedImages(file ? [file] : [], "拍照"))');
    expect(AI_PAGE).toContain('void pickLocalFiles("image/*").then((files) => addPickedImages(files, "相册"))');
    expect(AI_PAGE).not.toContain('pickLocalFile("image/*", "environment")');
    expect(AI_PAGE).not.toContain("\"environment\"");
  });
});
