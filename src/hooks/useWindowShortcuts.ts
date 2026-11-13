import { useEffect, useRef } from "react";
import { detectPlatform, matchShellCommand, type ShellCommandId } from "../lib/shortcuts/registry";

export interface WindowShortcutHandlers {
  /** 壳层命令处理函数（键位与展示文案由 registry 单一来源提供）。 */
  run: Partial<Record<ShellCommandId, () => void>>;
  onEscape: () => void;
}

/**
 * 壳层快捷键：**一个** capture 阶段监听器（编辑器/内核不会先吞掉壳层组合键）。
 * 匹配规则全部在 `src/lib/shortcuts/registry.ts`（纯函数 + 单测）；本文件只负责接线与 preventDefault。
 *
 * 约定：
 *  · Escape 保持无条件处理（菜单/浮层关闭是既有语义；输入法组字态也照旧关面板）。
 *  · 其它命令：`isComposing`（输入法组字中）或已被更早的捕获处理器 `preventDefault` 时跳过。
 *  · 只有真正命中且有处理函数时才 preventDefault —— 不抢内核/系统组合键。
 */
export function useWindowShortcuts(handlers: WindowShortcutHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const platform = detectPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        latest.current.onEscape();
        return;
      }
      if (event.defaultPrevented || event.isComposing) return;
      const command = matchShellCommand(event, platform);
      if (!command) return;
      const handler = latest.current.run[command];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
