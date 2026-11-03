import { Capacitor, registerPlugin } from "@capacitor/core";

/** 本地资产占用（261103 十四批）：原生一次性递归统计 note-assets + quick-notes/assets。 */
export interface AssetUsage {
  files: number;
  bytes: number;
}

interface AssetUsagePluginApi {
  usage(): Promise<AssetUsage>;
}

const NativeAssetUsage = registerPlugin<AssetUsagePluginApi>("AssetUsage");

/** 只在原生端可用；Web 预览 / 测试环境返回 null（调用方隐藏该行）。 */
export async function readAssetUsage(): Promise<AssetUsage | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const result = await NativeAssetUsage.usage();
    const files = Number(result?.files);
    const bytes = Number(result?.bytes);
    if (!Number.isFinite(files) || !Number.isFinite(bytes)) return null;
    return { files: Math.max(0, Math.round(files)), bytes: Math.max(0, Math.round(bytes)) };
  } catch {
    return null;
  }
}
