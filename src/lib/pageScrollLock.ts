/** 模态浮层共用页面滚动锁；最后一层关闭才恢复，释放顺序和重复释放不影响其他层。 */
let locks = 0;
let previous = { body: "", root: "" };
export function lockPageScroll(): () => void {
  if (locks++ === 0) {
    previous = { body: document.body.style.overflow, root: document.documentElement.style.overflow };
    document.body.style.overflow = document.documentElement.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks) return;
    document.body.style.overflow = previous.body;
    document.documentElement.style.overflow = previous.root;
  };
}
