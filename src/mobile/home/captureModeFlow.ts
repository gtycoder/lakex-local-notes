/**
 * 快捷入口「拍照小记 / 剪切板小记」的取数与入卡时序（261119）。
 *
 * 本模块只被 MobileApp **动态 import**：相机/剪贴板链路只在快捷入口用到，不进 mobile-entry 静态图
 * （入口预算 261119 刚上调、余量极小）。三种模式共用「假单独模块」capture 语义由 MobileApp 收口，
 * 这里只负责「取什么、什么时候取、取到交给谁」；每次快捷入口触发只跑一次（调用方给 isCurrent 代际）。
 *
 * ⚠️ **不要 import 任何入口图模块**（尤其 quickNoteComposerLazy）：入口与懒 chunk 共享的模块会被
 * rolldown 提升成独立共享块并进 index.html 的 modulepreload（261119 实测 12→13/14 超预算）。
 * 「写作卡就绪」的 loader 由调用方以 whenReady 传入（入口图里本来就有，引用即零新增）。
 */
import { takeCameraPhoto } from "../native/cameraCapture";
import { readClipboardText } from "../native/clipboardText";
import type { QuickNoteSeed } from "../native/sharedContent";
import { showToast } from "../ui/toastBus";

/**
 * 快捷入口取数流总入口（MobileApp 只留这一行动态 import + 一组 setter 入参）。
 * camera = 写作卡就绪即相机，照片以 initialInsert/insertFiles 入卡（与首页「拍摄」同语义）；
 * clipboard = 读剪贴板预填正文（空/非文本 = 短 toast + 空白写作卡）。
 */
export async function runCaptureFlow(input: {
  mode: "camera" | "clipboard";
  whenReady: () => Promise<unknown>;
  setCaptureInsert: (insert: { files?: File[] } | null) => void;
  setCaptureNonce: (next: (n: number) => number) => void;
  setCaptureSeed: (seed: QuickNoteSeed | null) => void;
  setSeedReady: (ready: boolean) => void;
  prefill: { current: boolean };
}): Promise<void> {
  if (input.mode === "camera") {
    await runCameraCapture({
      whenReady: input.whenReady,
      onPhoto: (file) => {
        input.setCaptureInsert({ files: [file] });
        input.setCaptureNonce((n) => n + 1);
      },
    });
    return;
  }
  await runClipboardPrefill({
    onText: (text) => {
      input.prefill.current = false;
      input.setSeedReady(false);
      input.setCaptureSeed({ text, images: [] });
    },
    onEmpty: () => {
      input.prefill.current = false;
      input.setSeedReady(true);
      showToast("剪贴板没有可用的文本");
    },
  });
}

/**
 * camera 模式：写作卡就绪（与懒加载壳同一个 loader，分包/内核 chunk 起跑）即懒调系统相机；
 * 成功把 File 交回（调用方经 initialInsert/insertFiles 注入卡内，与首页「拍摄」同一语义）；
 * 用户取消/失败 ⇒ 不回调（保留空白写作卡，不退出、不再自动弹相机）。
 */
export async function runCameraCapture(input: { whenReady: () => Promise<unknown>; isCurrent?: () => boolean; onPhoto: (file: File) => void }): Promise<void> {
  const isCurrent = input.isCurrent ?? (() => true);
  // 写作卡就绪 = 懒加载壳同一 loader（调用方传入）的分包已求值。
  await input.whenReady().catch(() => undefined);
  if (!isCurrent()) return;
  const file = await takeCameraPhoto();
  if (file && isCurrent()) input.onPhoto(file);
}

/**
 * clipboard 模式：读最新一条剪贴板文本交回调用方预填正文（onText）；空/非文本 ⇒ onEmpty
 * （调用方给短 toast + 空白写作卡）。
 *
 * 空结果 500ms 后复读一次再定论：Android 10+ 只有「有窗口焦点」的应用能读剪贴板，而热启动的
 * appUrlOpen 先于 onResume/焦点到达 —— 第一次读可能被系统按「无焦点」返回空（真·空剪贴板只是多等半秒）。
 */
export async function runClipboardPrefill(input: { isCurrent?: () => boolean; onText: (text: string) => void; onEmpty: () => void }): Promise<void> {
  const isCurrent = input.isCurrent ?? (() => true);
  let text = (await readClipboardText()).trim();
  if (!text && isCurrent()) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    text = (await readClipboardText()).trim();
  }
  if (!isCurrent()) return;
  if (text) input.onText(text);
  else input.onEmpty();
}
