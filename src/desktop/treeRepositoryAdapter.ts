/**
 * 桌面 TreeRepository adapter（§20/§4.1，Phase C4）。
 * 实现共享接口 src/core/ports.ts TreeRepository：组合现有 Store 方法，
 * 让移动端与桌面共用同一套目录操作语义（校验已在 noteMetadataRepository 加固为共享 assertTreeNodeTitle）。
 * 类型桥接：Store 返回 core/noteQueries.TreeNode（nodeType/syncState 为 string），
 * 共享接口用 lib/types.TreeNode（nodeType: TreeNodeType / syncState: 联合）——adapter 负责边界转换。
 */
import type { CreateNotebookInput, TreeRepository } from "../core/ports.js";
import type { TreeNode, TreeNodeType } from "../lib/types.js";
import type { Store } from "../../electron/store.js";

type StoreNode = ReturnType<Store["listTreeNodes"]>[number];

/** 类型桥接：store 节点（宽松 string 字段）→ 共享 TreeNode（收窄联合）。 */
function toSharedTreeNode(n: StoreNode): TreeNode {
  return {
    ...n,
    nodeType: n.nodeType as TreeNodeType,
    syncState: n.syncState as TreeNode["syncState"],
    icon: n.icon ?? null,
  };
}

/** 桌面 TreeRepository 实现：透传 Store（同步 API → Promise 包装 + 类型桥接）。 */
export class DesktopTreeRepository implements TreeRepository {
  constructor(private readonly store: Store) {}

  async listTreeNodes(): Promise<TreeNode[]> {
    return this.store.listTreeNodes().map(toSharedTreeNode);
  }

  async createNotebook(input: CreateNotebookInput): Promise<TreeNode> {
    const node = this.store.createNotebook(input.title);
    if (input.icon) return toSharedTreeNode(this.store.setNodeIcon(node.id, input.icon));
    return toSharedTreeNode(node);
  }

  async createGroup(parentId: string, title: string): Promise<TreeNode> {
    return toSharedTreeNode(this.store.createGroup(parentId, title));
  }

  async renameTreeNode(id: string, title: string): Promise<TreeNode> {
    return toSharedTreeNode(this.store.renameTreeNode(id, title));
  }

  async setNodeIcon(id: string, icon: string | null): Promise<TreeNode> {
    return toSharedTreeNode(this.store.setNodeIcon(id, icon));
  }

  async moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
    return toSharedTreeNode(this.store.moveTreeNodeOrdered(id, parentId, orderedIds));
  }
}
