/**
 * 移动端"返回栈"：全屏面板 / 底部 Sheet / 抽屉 / 侧栏共用一条后退链（统一入口，不各写一套）。
 * 之前返回键只在 MobileApp 里按 route 硬编码优先级，工作区内部的浮层（长按菜单/切换笔记本）
 * 拿不到返回键。改成注册栈：谁在最上层谁先消费。
 */
import { activeIsTextInput, dismissKeyboard } from "./dismissKeyboard";

type Handler = () => boolean; // 返回 true = 已消费
const stack: Handler[] = [];

/** 注册一个"更上层"的返回处理器，返回卸载函数。 */
export function pushBackHandler(handler: Handler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 只交给栈顶浮层消费（**不做**「返回键优先收键盘」判定）；无人消费返回 false。
 *  给「键盘已经收起」的场景用（快捷 capture 退出链，见 useBackHandler）：此时没有键盘可收，
 *  但写作卡里的浮层（标签面板/确认框）仍是真正的「最上层」，必须先于退出 capture 消费。 */
export function consumeBackOverlay(): boolean {
  const top = stack[stack.length - 1];
  return top ? top() === true : false;
}

/** 交给栈顶消费；无人消费返回 false（由调用方走系统/路由兜底）。
 *  **返回键优先收键盘**（261117 用户点单，Android 原生惯例）：焦点在文本输入上时第一次返回
 *  只收起软键盘、不触发返回动作（否则键盘开着按返回会直接关面板/退出，没有「完成编辑」的出口）。 */
export function consumeBack(): boolean {
  if (activeIsTextInput()) {
    dismissKeyboard();
    return true;
  }
  return consumeBackOverlay();
}
