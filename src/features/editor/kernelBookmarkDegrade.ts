/**
 * 内核兼容补丁（文件原为「bookmark 卡粘贴降级」，261114 用户改判后只保留热键兜底）。
 *
 * 261114 用户裁决：语雀链接卡要保留成卡片、并提供和语雀一致的浮动工具条（转为链接/标题/卡片/
 * 打开/编辑），撤销 126e906f 的「新粘贴 bookmark 卡自动降级为普通超链接」——降级是为绕开当时
 * 卡片没有工具条的死卡问题，现在由 vendor 的 BookmarkToolbar（已导出）在宿主挂载解决。
 *
 * 公共符号由 ./lakeRuntime 门面 re-export；内核 lazy 边界不变（只被 lakeRuntime 静态 import）。
 */

/**
 * 内核兼容补丁：**实例销毁后，工具条的 tooltip 仍会查一次热键表**。
 *
 * 内核 hotkey 插件的 `destroy()` 会 `delete this._named`（bundle 实测），但工具条每个按钮渲染时都会走
 * `getTooltip → renderer.getHotKeyByName(name) → this._named[name]` ⇒ 销毁之后再渲染一次就
 * `TypeError: Cannot read properties of undefined (reading 'undo'/'slash'/…)`，
 * 而这是 **React 渲染期抛错**：整棵工具条（进而整个小记面板）崩掉、不断重试 ⇒ 用户看到"反复闪烁、
 * 保存/取消都点不动"（260920 实测：列表视图里保存/取消/换条目连续操作，12 秒内 20+ 条同类错误）。
 *
 * 我们的编辑器生命周期里"销毁旧实例"是常态（小记切草稿、换条目、保存后重建），所以这里给
 * `renderer.getHotKeyByName` 包一层：**拿不到就返回 null**（工具条少一个快捷键提示），
 * 不再让一次迟到渲染炸掉整棵 UI。对健康实例是完全透明的（正常路径直接透传返回值）。
 */
export function hardenDestroyedHotKeyLookup(editor: unknown): void {
  try {
    const renderer = (editor as { renderer?: Record<string, unknown> } | null | undefined)?.renderer;
    const original = renderer?.getHotKeyByName;
    if (!renderer || typeof original !== "function") return;
    renderer.getHotKeyByName = function hardened(this: unknown, name: unknown) {
      try { return (original as (this: unknown, value: unknown) => unknown).call(this, name) ?? null; }
      catch { return null; }
    };
  } catch { /* 拿不到 renderer 就跳过：补丁只是兜底，不改变正常路径 */ }
}
