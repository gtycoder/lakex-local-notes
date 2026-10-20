import { Capacitor, registerPlugin } from "@capacitor/core";

interface StylusInputPlugin {
  setHandwritingEnabled(options: { enabled: boolean }): Promise<void>;
}

const StylusInput = registerPlugin<StylusInputPlugin>("StylusInput");

/** Android 手写板编辑态关闭系统手写接管；非原生环境静默 no-op。 */
export async function setStylusHandwritingEnabled(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StylusInput.setHandwritingEnabled({ enabled });
  } catch {
    // 老系统 / 非 Android 壳层没有该能力：手写板仍可使用 Pointer Events。
  }
}
