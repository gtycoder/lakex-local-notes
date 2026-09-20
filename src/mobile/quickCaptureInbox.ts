/**
 * 导入原生「新建小记」秒开框提交的内容。
 *
 * 原生 QuickCaptureActivity 把提交文本写到 filesDir/quick-capture-inbox/<uuid>.txt（UTF-8）；
 * 这里在 App 启动 / 回前台时读出来建成小记，再删掉文件（纯本地；正文由 bridge.createQuickNote 合成）。
 */
import { Directory, Filesystem } from "@capacitor/filesystem";
import { bridge } from "./bridge";

function isNativePlatform(): boolean {
  return (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 返回本次导入的小记条数。 */
export async function importQuickCaptureInbox(): Promise<number> {
  if (!isNativePlatform()) return 0;
  let entries: Array<{ name: string }> = [];
  try {
    const listing = await Filesystem.readdir({ path: "quick-capture-inbox", directory: Directory.Data });
    entries = listing.files ?? [];
  } catch {
    return 0; // 目录不存在 = 没有待导入
  }
  let imported = 0;
  for (const entry of entries) {
    if (!entry.name.endsWith(".txt")) continue;
    const path = "quick-capture-inbox/" + entry.name;
    try {
      const file = await Filesystem.readFile({ path, directory: Directory.Data });
      const text = typeof file.data === "string" ? decodeBase64Utf8(file.data).trim() : "";
      if (text) {
        await bridge.createQuickNote(text);
        imported += 1;
      }
    } catch { /* 单条失败不阻断其它 */ }
    await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
  }
  return imported;
}
