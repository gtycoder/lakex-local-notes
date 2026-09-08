/**
 * 移动端"返回栈"（对齐思源：#model / .b3-menu--fullscreen / side-panel 共用一条后退链）。
 * 之前返回键只在 MobileApp 里按 route 硬编码优先级，工作区内部的浮层（长按菜单/切换笔记本）
 * 拿不到返回键。改成注册栈：谁在最上层谁先消费。
 */
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

/** 交给栈顶消费；无人消费返回 false（由调用方走系统/路由兜底）。 */
export function consumeBack(): boolean {
  const top = stack[stack.length - 1];
  return top ? top() === true : false;
}
