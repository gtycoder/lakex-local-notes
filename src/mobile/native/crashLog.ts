/**
 * 原生崩溃记录（Android，261105）：读 MainActivity 的 UncaughtExceptionHandler 落盘的最近一条崩溃。
 *
 * 链路：android/.../CrashLogPlugin.kt 在进程崩溃前把 stack 写到 filesDir/crash/last-crash.txt →
 * 下次启动这里读一次、并入移动端 crashLog 环形缓冲（scope=native）→ 清掉原生文件（只展示一次）。
 *
 * 为什么要有：移动端原来没有任何原生崩溃落盘，现场只有"闪退"，没有堆栈（桌面有 installCrashLogging）。
 * web 预览 / vitest 没有该插件 ⇒ registerPlugin 调用会抛，一律 catch 后当"没有崩溃记录"。
 */
import { registerPlugin } from "@capacitor/core";
import { reportCrash } from "../lib/crashLog";

interface CrashLogPluginApi {
  read(): Promise<{ text: string | null; at: number | null }>;
  clear(): Promise<void>;
}

const plugin = registerPlugin<CrashLogPluginApi>("CrashLog");

/** 读并消费上一条原生崩溃（返回 stack 文本；没有/不可用返回 null）。 */
export async function consumeNativeCrashLog(): Promise<string | null> {
  try {
    const result = await plugin.read();
    const text = typeof result?.text === "string" ? result.text : null;
    if (!text) return null;
    const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "原生崩溃";
    reportCrash({ scope: "native", message: firstLine, stack: text });
    await plugin.clear().catch(() => undefined);
    return text;
  } catch {
    // 没有原生插件（web/vitest）或读取失败：不是错误，静默跳过。
    return null;
  }
}
