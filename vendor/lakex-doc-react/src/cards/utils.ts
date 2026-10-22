
// 查找框架卡片节点（class 含 "ne-card" 且带有 id 属性），
// 返回该卡片的 id。框架内部正是用这个 id 调 execCommand("deleteCard", id) 删除卡片
// （lakex.js 中 _domEventFilter 通过 Zu(node, "ne-card") 找卡片节点再 getAttribute("id")）。
function findCardId(target: EventTarget | null): string | null {
  let el = target as HTMLElement | null;
  while (el && el !== document.body) {
    const cls = el.getAttribute && el.getAttribute('class');
    const id = el.getAttribute && el.getAttribute('id');
    if (id && cls && cls.indexOf('ne-card') !== -1) {
      return id;
    }
    el = el.parentElement;
  }
  return null;
}

export default findCardId