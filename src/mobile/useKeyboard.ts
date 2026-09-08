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

export function useKeyboard() {
  const [base, setBase] = useState(0);
  const [innerHeight, setInnerHeight] = useState(0);
  const [offset, setOffset] = useState(0);
  const [height, setHeight] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    let maxBase = 0;
    const update = () => {
      const ih = window.innerHeight;
      if (ih > maxBase) maxBase = ih;
      setBase(maxBase);
      setInnerHeight(ih);
      const vv = window.visualViewport;
      const vvH = vv ? vv.height : ih;
      const vvTop = vv ? Math.max(0, vv.offsetTop) : 0;
      const off = Math.max(0, Math.round(ih - vvH - vvTop));            // edge-to-edge 上移量
      const shrunk = Math.max(0, Math.round(maxBase - ih));            // adjustResize 回落
      const h = Math.max(off, shrunk);                                  // 键盘实际高度（两模式统一）
      setOffset(off);
      setHeight(h);
      setKeyboardOpen(h > 8);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { base, innerHeight, offset, height, keyboardOpen };
}
