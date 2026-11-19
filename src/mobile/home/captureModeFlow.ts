/**
 * 快捷入口「拍照小记 / 剪切板小记」的取数与入卡时序（261119）。
 *
 * 本模块只被 MobileApp **动态 import**：相机/剪贴板链路只在快捷入口用到，不进 mobile-entry 静态图
 * （入口预算 261119 刚上调、余量极小）。三种模式共用「假单独模块」capture 语义由 MobileApp 收口，
 * 这里只负责「取什么、什么时候取、取到交给谁」；每次快捷入口触发只跑一次（调用方给 isCurrent 代际）。
 *
 * **camera 与 clipboard 同走 captureSeed 草稿通道（261119 用户裁决「都做成替换」）**：
 * camera = text 空 + images=[拍照图]，clipboard = text=剪贴板文本 + images 空 —— 两者都先把种子交给
 * MobileApp 的 seed 落草稿 effect（写入即**整份替换**未提交旧草稿），写作卡再从草稿恢复；
 * **不再**走 setCaptureInsert/insertFiles 的「并入草稿」语义。
 *
 * ⚠️ **不要 import 任何入口图模块**（尤其 quickNoteComposerLazy）：入口与懒 chunk 共享的模块会被
 * rolldown 提升成独立共享块并进 index.html 的 modulepreload（261119 实测 12→13/14 超预算）。
 * 「写作卡就绪」的 loader 由调用方以 whenReady 传入（入口图里本来就有，引用即零新增）。
 */
import { takeCameraPhoto } from "../native/cameraCapture";
import { readClipboardText } from "../native/clipboardText";
import type { QuickNoteSeed } from "../native/sharedContent";
import { showToast } from "../ui/toastBus";
import { QUICK_NOTE_PREPARE_FAILED_TEXT } from "../ui/toastCopy";

/** captureSeed 图片项（与 QuickNoteSeed.images 同形）。 */
type SeedImage = QuickNoteSeed["images"][number];

/**
 * 快捷入口取数流总入口（MobileApp 只留这一行动态 import + 一组 setter 入参）。
 * camera / clipboard 都产出 captureSeed（见头注释「都做成替换」）：
 * camera = text 空 + images=[拍照图]；clipboard = text=剪贴板文本 + images 空。
 */
export async function runCaptureFlow(input: {
  mode: "camera" | "clipboard";
  whenReady: () => Promise<unknown>;
  isCurrent?: () => boolean;
  setCaptureSeed: (seed: QuickNoteSeed | null) => void;
  setSeedReady: (ready: boolean) => void;
  prefill: { current: boolean };
}): Promise<void> {
  const isCurrent = input.isCurrent ?? (() => true);
  if (input.mode === "camera") {
    await runCameraCapture({
      whenReady: input.whenReady,
      isCurrent,
      onPhoto: (image) => {
        // 「替换」语义（261119 用户裁决）：camera = text 空 + images=[拍照图] —— 与 clipboard 同一条
        // captureSeed 草稿通道，种子落草稿即整份替换未提交旧草稿（卡里只有这张图），不再 insertFiles 并入。
        input.prefill.current = false;
        input.setSeedReady(false);
        input.setCaptureSeed({ text: "", images: [image] });
      },
      onCancel: () => {
        // 取消 = **不落任何种子**（等价表达）⇒ 旧草稿一动不动（什么都没发生），写作卡照常挂载并走
        // 草稿恢复态。原生失败同口径（可见提示已由 takeCameraPhoto 给出）。
        // 挂载时序微差（HANDOFF §1 批注「已注释」条目补注）：camera 取消后写作卡才挂载、才弹键盘
        //（原为卡先挂、相机盖在上面）；数据语义不变。
        input.prefill.current = false;
        input.setSeedReady(true);
      },
    });
    return;
  }
  await runClipboardPrefill({
    isCurrent,
    onText: (text) => {
      // clipboard = text=剪贴板文本 + images 空：同一 captureSeed 草稿通道（落草稿替换未提交旧草稿）。
      input.prefill.current = false;
      input.setSeedReady(false);
      input.setCaptureSeed({ text, images: [] });
    },
    onEmpty: () => {
      // 空/非文本 = 不落种子（旧草稿不动）+ 可见提示，写作卡走草稿恢复态。
      input.prefill.current = false;
      input.setSeedReady(true);
      showToast("剪贴板没有可用的文本");
    },
  });
}

/**
 * camera 模式：写作卡分包就绪（与懒加载壳同一个 loader）即懒调系统相机；
 * 成功把照片转成 captureSeed 图片项交回（调用方经 captureSeed 草稿通道落卡，「替换」未提交旧草稿 ——
 * 与 clipboard 同通道）；用户取消/失败 ⇒ onCancel（**不落任何种子** ⇒ 旧草稿不动，卡走草稿恢复态，
 * 不退出、不再自动弹相机）。
 */
export async function runCameraCapture(input: {
  whenReady: () => Promise<unknown>;
  isCurrent?: () => boolean;
  onPhoto: (image: SeedImage) => void;
  onCancel: () => void;
}): Promise<void> {
  const isCurrent = input.isCurrent ?? (() => true);
  // 写作卡分包就绪 = 懒加载壳同一 loader（调用方传入）的分包已求值。
  await input.whenReady().catch(() => undefined);
  if (!isCurrent()) return;
  const file = await takeCameraPhoto();
  if (!isCurrent()) return;
  if (!file) { input.onCancel(); return; }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    // 读照片字节失败（文件被回收/读取异常）= 语义等价的失败回传：与原生失败同口径走 onCancel
    //（不落任何种子、清 pending、放行挂载）+ 可见提示 —— 不许静默留空壳写作卡（P2-2）。
    if (!isCurrent()) return;
    showToast(QUICK_NOTE_PREPARE_FAILED_TEXT, { type: "error" });
    input.onCancel();
    return;
  }
  if (!isCurrent()) return;
  input.onPhoto({ filename: file.name, mimeType: file.type || "image/jpeg", bytes });
}

/**
 * clipboard 模式：读最新一条剪贴板文本交回调用方预填正文（onText）；空/非文本 ⇒ onEmpty
 * （调用方给短 toast + 草稿恢复态写作卡）。
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
