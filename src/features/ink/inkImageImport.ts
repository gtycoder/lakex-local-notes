/**
 * 手写板 v2「图片页」导入管线（纯逻辑 + 两端复用）。
 *
 * 目标：选图（可多选）→ 读像素尺寸 → 校验（25 MiB / 5000 万像素）→ 走既有资产通道
 * （桌面 native.uploadResource / 移动端 bridge.uploadResource）落成
 * `note-assets/{noteId}/{13ts}_{8hex}.{ext}` → 每张图各成一页（A4 794×1123、fit=contain、
 * 记录 pixelWidth/Height），正文里存 canonical 本地资产 URL（末段 = 磁盘名 ⇒
 * extractAssetRefs / 资产声明 / 同步 / GC 全链路复用现成能力）。
 *
 * 边界：本文件不 import 桌面/移动任一端的 IPC/bridge —— 上传能力由宿主注入，便于单测。
 */
import { parseLocalAssetUrl, withAssetWidth } from "../../core/assetUrl.js";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../../core/storeLimits.js";
import { INK_PAGE_HEIGHT, INK_PAGE_WIDTH, createInkPage, type InkBackgroundImage, type InkPage } from "../../core/inkDoc.js";
import { newInkId } from "./ids.js";

/** 单张家图的上限（与图片上传通道同一份 core 事实源）。 */
export const INK_IMAGE_MAX_BYTES = MAX_IMAGE_BYTES;
export const INK_IMAGE_MAX_PIXELS = MAX_IMAGE_PIXELS;

/** 缩略图取资产服务 256 档：N 张图页的预览不做全尺寸解码（见 InkPageStrip 调用点）。 */
export const INK_THUMB_WIDTH = 256;

export interface InkImageProbe {
  pixelWidth: number;
  pixelHeight: number;
}

export interface InkImageImportDeps {
  /** 上传像素字节（宿主注入：桌面走 IPC、移动端走 bridge）；返回的 url 必须是本地资产 URL。 */
  upload: (input: { bytes: Uint8Array; filename: string }) => Promise<{ url: string }>;
  /** 读图片像素尺寸（默认用浏览器解码；单测注入假值）。 */
  probe?: (file: File) => Promise<InkImageProbe | null>;
}

export interface InkImageImportOutcome {
  pages: InkPage[];
  /** 逐文件错误（可见提示用）；成功的文件仍会成页。 */
  errors: string[];
}

/** 缩略图 URL：本地资产走 `?w=256` 低清档；非本地/无档位原样返回。 */
export function inkThumbUrl(url: string): string {
  return withAssetWidth(url, INK_THUMB_WIDTH);
}

/** 导入前的校验：体积/像素上限 + 解码失败。通过返回 null。 */
export function inkImageImportError(fileSize: number, probe: InkImageProbe | null): string | null {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return "图片为空";
  if (fileSize > INK_IMAGE_MAX_BYTES) return "超过 25 MiB 上限";
  if (!probe || !Number.isFinite(probe.pixelWidth) || !Number.isFinite(probe.pixelHeight) || probe.pixelWidth <= 0 || probe.pixelHeight <= 0) {
    return "无法读取图片尺寸（不支持的图片格式）";
  }
  if (probe.pixelWidth * probe.pixelHeight > INK_IMAGE_MAX_PIXELS) return "超过 5000 万像素上限";
  return null;
}

/** 上传结果 → 背景图片对象；url 必须是本笔记空间的本地资产 URL，否则返回 null（拒绝写进正文）。 */
export function inkBackgroundImageFromUpload(upload: { url: string }, probe: InkImageProbe | null): InkBackgroundImage | null {
  const ref = parseLocalAssetUrl(upload.url);
  if (!ref || ref.space !== "note" || ref.staging) return null;
  const image: InkBackgroundImage = { url: upload.url, fit: "contain" };
  if (probe && probe.pixelWidth > 0 && probe.pixelHeight > 0) {
    image.pixelWidth = Math.round(probe.pixelWidth);
    image.pixelHeight = Math.round(probe.pixelHeight);
  }
  return image;
}

/** 一张背景图 → 一个 A4 页（页面坐标仍按 A4 逻辑尺寸；fit=contain 让整图可见、留白可批注）。 */
export function inkImagePage(image: InkBackgroundImage, pageId: string = newInkId("page")): InkPage {
  const page = createInkPage(pageId, "blank");
  return { ...page, width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, backgroundImage: image };
}

/** 浏览器解码像素尺寸：优先 createImageBitmap，退回 <img>（两端 Chromium 都可用；单测注入 probe 绕开）。 */
export async function probeInkImageFile(file: File): Promise<InkImageProbe | null> {
  const createBitmap = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (typeof createBitmap === "function") {
    try {
      const bitmap = await createBitmap(file);
      const probe = { pixelWidth: bitmap.width, pixelHeight: bitmap.height };
      bitmap.close?.();
      return probe;
    } catch {
      // 落到 <img> 兜底（某些格式 createImageBitmap 不支持）
    }
  }
  if (typeof Image === "undefined" || typeof URL?.createObjectURL !== "function") return null;
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

/**
 * 选图 → 上传 → 成页。逐文件容错：单张失败记 errors、其余继续；宿主负责把 pages 提交进正文
 * （只能在编辑态提交，见 InkPad 的只读约束）。
 */
export async function importInkImagePages(files: File[], deps: InkImageImportDeps): Promise<InkImageImportOutcome> {
  const probeOf = deps.probe ?? probeInkImageFile;
  const pages: InkPage[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const label = file.name || "图片";
    try {
      const probe = await probeOf(file);
      const error = inkImageImportError(file.size, probe);
      if (error) {
        errors.push(`${label}：${error}`);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const uploaded = await deps.upload({ bytes, filename: file.name });
      const image = inkBackgroundImageFromUpload(uploaded, probe);
      if (!image) {
        errors.push(`${label}：上传结果不是本地资产地址`);
        continue;
      }
      pages.push(inkImagePage(image));
    } catch (reason) {
      errors.push(`${label}：${reason instanceof Error ? reason.message : "导入失败"}`);
    }
  }
  return { pages, errors };
}

/** 选图（一次多选；取消返回空数组，不会悬挂）。桌面/移动共用（两端都是 Chromium 的 input[type=file]）。 */
export function pickInkImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    let done = false;
    const finish = (files: File[]): void => {
      if (done) return;
      done = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = (): void => {
      // 回到前台后给 change 一点时间；仍没有文件 = 用户取消
      window.setTimeout(() => finish(Array.from(input.files ?? [])), 300);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => finish([]));
    window.addEventListener("focus", onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
