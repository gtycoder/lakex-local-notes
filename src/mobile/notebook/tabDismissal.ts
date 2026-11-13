/**
 * 「删除后关闭已打开标签」单一通道（261114 task-8，对齐桌面 useNoteLifecycle.deleteTreeNode）。
 *
 * 桌面在删除前用 treeNodes 算出子树 note ids → clearNote/清滚动记忆/删草稿/收 tab；
 * 移动端的删除入口散布在首页（长按删笔记本）、日记页（删条目 / 转小记）、工作区目录树与批量多选、
 * 设置（缺正文彻底删除），它们都拿不到工作区的 tab state，而且**当前树不一定加载全**
 * （首页入口只有全库快照、工作区只加载当前笔记本子树）⇒ 子树由数据层算：
 * trashTreeItem / trashNote 返回真正被软删的 note id 列表，UI 只负责把这份 id 交给本模块。
 *
 * 工作区（useWorkspaceSession）注册唯一 dismisser = cancelAutoSave + discardTab
 * （编辑器实例/正文 capture 由 useNotebookTabs.onDrop 释放）。没挂载工作区时是 no-op ——
 * 此时没有内存标签；重新进工作区也会按「当前目录已知 id」过滤存档（useWorkspaceAssemble）。
 */
export type NoteTabDismisser = (noteIds: readonly string[]) => void;

const dismissers = new Set<NoteTabDismisser>();

/** 注册 dismisser；返回注销函数（effect cleanup / 测试隔离用）。 */
export function registerNoteTabDismisser(dismisser: NoteTabDismisser): () => void {
  dismissers.add(dismisser);
  return () => { dismissers.delete(dismisser); };
}

/** 通知工作区关闭这些文档的标签（幂等：没打开的不受影响；空/缺省 = no-op）。 */
export function dismissNoteTabs(noteIds: readonly string[] | null | undefined): void {
  if (!noteIds || noteIds.length === 0) return;
  for (const dismisser of [...dismissers]) dismisser(noteIds);
}
