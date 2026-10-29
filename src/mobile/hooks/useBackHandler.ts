/**
 * Android 返回键处理（§9.2，Phase B1）。
 * 优先级：浮层返回栈（含小记写作内打开的浮层）→ 关闭小记 → 关闭 Sheet → 关闭 Drawer
 *        → 文档页回笔记本 → 笔记本页回首页 → 首页交给系统。
 * 实现：@capacitor/app 的 backButton 监听；Web 浏览器环境（预览）无此插件时静默跳过（不注册）。
 * P1-1（GPT 审计）：listener 只注册一次，handler 通过 ref 读取最新 state/回调，
 * 避免"进入编辑态时的旧闭包丢失后续输入"的 stale closure 数据丢失。
 */
import { useEffect, useRef } from "react";
import type { Route } from "../MobileApp";
import { consumeBack } from "../ui/backStack";

export interface BackHandlerState {
  route: Route;
  drawerOpen: boolean;
  createNbOpen: boolean;
  searchOpen: boolean;
  /** 小记独立入口（全屏）是否打开：返回键必须能先关它，否则会直接退出 App、丢掉正在写的速记。 */
  captureOpen?: boolean;
  onCloseCapture?: () => void;
  onBackFromNotebook: () => void;
  onCloseDrawer: () => void;
  onCloseSheets: () => void;
  onAppExit: () => void;
}

/** 注册返回键监听。返回 true = 已消费（阻止系统退出）；false = 交给系统。 */
export function useBackHandler(state: BackHandlerState) {
  // ref 保存最新 state：每次渲染更新，listener 只注册一次（依赖 []），永远读到最新闭包
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    let listener: { remove(): void } | null = null;
    (async () => {
      try {
        const mod = await import("@capacitor/app");
        const l = await mod.App.addListener("backButton", () => {
          const s = stateRef.current;
          // 0) 浮层返回栈（思源：#model / .b3-menu--fullscreen / side-panel 谁在上层谁先吃返回）。
          //    必须在小记之前：小记写作界面内打开的标签面板/浮层才是真正的「最上层」。
          if (consumeBack()) return;
          // 1) 小记（全屏独立入口）：没有更上层浮层时再关它
          if (s.captureOpen) { s.onCloseCapture?.(); return; }
          // 2) 最上层 Sheet（新建知识库/搜索）
          if (s.createNbOpen || s.searchOpen) { s.onCloseSheets(); return; }
          // 3) 设置 Drawer
          if (s.drawerOpen) { s.onCloseDrawer(); return; }
          // 4) 笔记本/工作区 → 首页（编辑态与浮层已由返回栈在 1) 消费）
          if (s.route.kind === "notebook") { s.onBackFromNotebook(); return; }
          // 5) 首页：交给系统退出
          s.onAppExit();
        });
        // 竞态防护：async import 期间 effect 已 cleanup → 立即移除刚注册的监听
        if (cancelled) { void l.remove(); return; }
        listener = l;
      } catch {
        // 非 Capacitor 环境（Web 预览/测试）：不注册，浏览器 history 或物理键兜底
      }
    })();
    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, []);
}
