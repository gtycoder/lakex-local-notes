import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeAssetMeta {
  filename: string;
  size: number;
  hash: string;
}

/** 原生资产同步插件契约（Android AssetSyncPlugin）。 */
export interface AssetSyncNativePlugin {
  configure(options: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
  }): Promise<{ ok: boolean }>;
  isAvailable(): Promise<{ available: boolean }>;
  putFile(options: { key: string; localKey: string }): Promise<{ status: number; bytes: number }>;
  getFile(options: { key: string; localKey: string; maxBytes?: number }): Promise<{ status: number; size?: number; sha256?: string }>;
  listAssets(options: { noteId: string }): Promise<{ assets: NativeAssetMeta[] }>;
}

export const NativeAssetSync = registerPlugin<AssetSyncNativePlugin>("AssetSync");

/**
 * 原生 AssetSync 是否可用（仅原生平台且插件已注册）。
 * 同步判断，供端口决定「挂载原生流式（有则用）还是回退现有字节/base64 路径（无则退）」。
 */
export function nativeAssetSyncSupported(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("AssetSync");
  } catch {
    return false;
  }
}
