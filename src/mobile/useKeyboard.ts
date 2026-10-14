/**
 * 移动端输入法（软键盘）探测（编辑态 dock 键盘适配）。
 * Android Capacitor 无 keyboard 插件，故用 window/visualViewport 双通道判断两种键盘模式：
 *   - adjustResize：WebView 自缩，keyboard 弹出时 window.innerHeight 变小（vv.height==innerHeight），
 *                    bottom:0 的 fixed 元素天然在键盘上方。此时 offset=0，无需上移。
 *   - edge-to-edge：WebView 不缩，visualViewport.height 变小，需把 fixed 元素 bottom 上移（offset）。
 * 返回：
 *   base         —— 键盘收起时的满高度（max(innerHeight)），用于让工具栏在键盘收起/面板展开中屏幕 Y 恒定
 *   innerHeight  —— 当前 innerHeight（实时跟随 resize）
 *   offset       —— 需把 dock/toolbar 的 bottom 上移的量（adjustResize=0；edge-to-edge=键盘高度）
 *   height       —— 键盘实际高度（两种模式统一：adjustResize 用基准回落、edge-to-edge 用 vv 差）
 *   keyboardOpen —— 键盘是否弹出（height>8）
 */
import { useEffect, useState } from "react";
import { noteViewport, resetShellHeight, shellHeight } from "./viewportShell";

export function useKeyboard() {
  // ⚠️ 初值直接取当前视口高，**不要给 0**：`base` 被 EditorDock 用来写 `--mb-app-h`（外壳高度），
  //    而那个写操作在 useLayoutEffect（绘制前）里、比本 hook 的测量 effect（passive，绘制后）更早跑
  //    ⇒ 初值 0 会让挂载首帧的外壳高度变成 0px（闪一下）。261014 查漏补缺时发现。
  const [base, setBase] = useState(() => (typeof window === "undefined" ? 0 : window.innerHeight));
  const [innerHeight, setInnerHeight] = useState(0);
  const [offset, setOffset] = useState(0);
  const [height, setHeight] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      const ih = window.innerHeight;
      // base = **跨实例共享**的稳定外壳高（单调取历史最大值 = 键盘收起时的高）——
      // 见 viewportShell.ts：只有输入法会让视口变矮，面板不会，所以这个值才是稳定基准。
      setBase(noteViewport(ih));
      setInnerHeight(ih);
      const vv = window.visualViewport;
      const vvH = vv ? vv.height : ih;
      const vvTop = vv ? Math.max(0, vv.offsetTop) : 0;
      const off = Math.max(0, Math.round(ih - vvH - vvTop));            // edge-to-edge 上移量
      const shrunk = Math.max(0, Math.round(shellHeight() - ih));       // adjustResize 回落（基准 = 稳定外壳高）
      const h = Math.max(off, shrunk);                                  // 键盘实际高度（两模式统一）
      setOffset(off);
      setHeight(h);
      setKeyboardOpen(h > 8);
    };
    const onOrient = () => { resetShellHeight(); update(); };
    update();
    window.addEventListener("orientationchange", onOrient);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("orientationchange", onOrient);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { base, innerHeight, offset, height, keyboardOpen };
}
