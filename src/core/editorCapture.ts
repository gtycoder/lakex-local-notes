/**
 * 编辑器「按需取正文」的唯一类型来源（DT-16）。
 *
 * 背景（审计 F15）：usheet / bitable / board / ink 这类编辑器不再随每次按键回传正文，
 * 而是在挂载时注册一个 capture 回调、卸载时注册 null；保存 / 草稿 / 关闭 / 退出时按需现取。
 * 这套签名此前在 10 个文件里各写一遍 `(() => string | null) | null`，改口径时容易漏，
 * 这里收敛成 core 的单类型（纯类型模块，不依赖 React / 宿主，任何端都能引用）。
 */

/** 取当前正文（没有可序列化正文时返回 null）。 */
export type EditorCapture = () => string | null;

/** 注册 / 注销入口：组件挂载时传 capture，卸载时传 null。 */
export type EditorCaptureHandler = (capture: EditorCapture | null) => void;

/** 宿主层（多标签）入口：额外带 noteId，按标签登记 / 注销。 */
export type EditorCaptureRegistrar = (noteId: string, capture: EditorCapture | null) => void;
