/**
 * 回收站子树「两路边集」共享场景表（M-02，审计 03-mobile；判据 = AGENTS §3#5 / §3#24）。
 *
 * purge / restore / 软删级联的子树收集口径 = 两条边取并集：
 *   ① parent_id 边（未扁平化的常规子树）；
 *   ② deleted_from_parent_id + trashed_at 边（被同步「扁平化」成回收站容器后的原始父链；仅 trashed 行有效）。
 *
 * 两端**各自保留实现、不合并**（桌面 SQL 递归有 5k 文档性能理由）：
 *   - 移动：src/mobile/data/trashSubtree.ts `collectSubtree`（JS 图遍历）；
 *   - 桌面：electron/trashLifecycle.ts `flattenedSubtreeIds`（SQL 递归）。
 * 但判据**数据同源** = 本表：两端测试都消费它做对拍断言（移动 data/trashSubtree.test.ts、
 * 桌面 electron/trashCascade.test.ts）。边集语义漂移（历史 F-01：子文档漏 purge、云端索引残留）会被 CI 抓住。
 */
import { TRASH_NOTEBOOK_ID } from "./syncDecisions.js";

export interface TrashSubtreeScenarioNode {
  id: string;
  /** folder = 移动 folders 表 / 桌面 tree_nodes 非 note 行；note = 移动 notes 表 / 桌面 note 行（也可作父节点）。 */
  kind: "folder" | "note";
  parent_id: string | null;
  /** 删除前原始父（回收站平铺后保留）；与 trashed_at 同时存在才构成第②条边。 */
  deleted_from_parent_id?: string | null;
  trashed_at?: string | null;
}

export interface TrashSubtreeScenario {
  id: string;
  title: string;
  rootId: string;
  nodes: TrashSubtreeScenarioNode[];
  /** 从 rootId 按两路边集应收集到的子树（含自身）；数组顺序不承载语义（断言按集合比较）。 */
  expect: { folderIds: string[]; noteIds: string[]; allIds: string[] };
}

/** 场景内统一的「已进回收站」时刻（判据只看是否非空，不看具体值）。 */
const T = "2026-11-25T00:00:00.000Z";

export const TRASH_SUBTREE_SCENARIOS: readonly TrashSubtreeScenario[] = [
  {
    id: "notebook-root",
    title: "笔记本根：多顶层分组/文档 + 子文档/孙文档（仅 parent 边）",
    rootId: "nb1",
    nodes: [
      { id: "nb1", kind: "folder", parent_id: null },
      { id: "gTop1", kind: "folder", parent_id: "nb1" },
      { id: "gTop2", kind: "folder", parent_id: "nb1" },
      { id: "gInner", kind: "folder", parent_id: "gTop1" },
      { id: "nb2", kind: "folder", parent_id: null },
      { id: "t1", kind: "note", parent_id: "nb1" },
      { id: "t2", kind: "note", parent_id: "t1" },
      { id: "a", kind: "note", parent_id: "gTop1" },
      { id: "a1", kind: "note", parent_id: "a" },
      { id: "a11", kind: "note", parent_id: "a1" },
      { id: "b", kind: "note", parent_id: "gTop2" },
      { id: "z", kind: "note", parent_id: "nb2" },
    ],
    expect: {
      folderIds: ["nb1", "gTop1", "gTop2", "gInner"],
      noteIds: ["t1", "t2", "a", "a1", "a11", "b"],
      allIds: ["nb1", "gTop1", "gTop2", "gInner", "t1", "t2", "a", "a1", "a11", "b"],
    },
  },
  {
    id: "group-root",
    title: "分组根：多级分组嵌套文档（note 也可作父节点）",
    rootId: "g1",
    nodes: [
      { id: "nb1", kind: "folder", parent_id: null },
      { id: "g1", kind: "folder", parent_id: "nb1" },
      { id: "g2", kind: "folder", parent_id: "g1" },
      { id: "g3", kind: "folder", parent_id: "g2" },
      { id: "keep", kind: "folder", parent_id: "nb1" },
      { id: "d1", kind: "note", parent_id: "g1" },
      { id: "d2", kind: "note", parent_id: "g2" },
      { id: "d3", kind: "note", parent_id: "g3" },
      { id: "deep", kind: "note", parent_id: "d3" },
      { id: "s", kind: "note", parent_id: "keep" },
    ],
    expect: {
      folderIds: ["g1", "g2", "g3"],
      noteIds: ["d1", "d2", "d3", "deep"],
      allIds: ["g1", "g2", "g3", "d1", "d2", "d3", "deep"],
    },
  },
  {
    id: "note-root-multi-level",
    title: "文档根：文档下多级子文档（≥3 层）",
    rootId: "d1",
    nodes: [
      { id: "nb1", kind: "folder", parent_id: null },
      { id: "d1", kind: "note", parent_id: "nb1" },
      { id: "d2", kind: "note", parent_id: "d1" },
      { id: "d3", kind: "note", parent_id: "d2" },
      { id: "d4", kind: "note", parent_id: "d3" },
      { id: "sib", kind: "note", parent_id: "nb1" },
    ],
    expect: {
      folderIds: [],
      noteIds: ["d1", "d2", "d3", "d4"],
      allIds: ["d1", "d2", "d3", "d4"],
    },
  },
  {
    id: "sync-flattened-dfp-chain",
    title: "同步扁平化后 dfp 链：parent 全部归一回收站容器，原始父链只剩 deleted_from_parent_id",
    rootId: "g1",
    nodes: [
      { id: "nb", kind: "folder", parent_id: null },
      // 整棵子树已 trashed 且被 wire 归一：parent = 回收站容器，①边断掉 ⇒ 只靠 ②dfp 边收集
      { id: "g1", kind: "folder", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "nb", trashed_at: T },
      { id: "d1", kind: "note", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "g1", trashed_at: T },
      { id: "d2", kind: "note", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "d1", trashed_at: T },
      { id: "d3", kind: "note", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "d2", trashed_at: T },
      // 同容器的另一个回收站根（dfp 指向 nb）：不在 g1 子树，不得误收
      { id: "other", kind: "note", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "nb", trashed_at: T },
    ],
    expect: {
      folderIds: ["g1"],
      noteIds: ["d1", "d2", "d3"],
      allIds: ["g1", "d1", "d2", "d3"],
    },
  },
  {
    id: "mixed-parent-and-dfp",
    title: "混合形态：未扁平化子树（parent 边）∪ 先删后被扁平化的子树（dfp 边）",
    rootId: "g",
    nodes: [
      { id: "nb", kind: "folder", parent_id: null },
      { id: "g", kind: "folder", parent_id: "nb" },
      { id: "keep", kind: "folder", parent_id: "g" },
      { id: "c1", kind: "note", parent_id: "g" },
      // 子文档先单独删过（成回收站根）再被同步扁平化：parent 归一容器、原始父在 dfp
      { id: "c2", kind: "note", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "g", trashed_at: T },
      { id: "gc", kind: "note", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "c2", trashed_at: T },
      { id: "decoy", kind: "note", parent_id: TRASH_NOTEBOOK_ID, deleted_from_parent_id: "nb", trashed_at: T },
    ],
    expect: {
      folderIds: ["g", "keep"],
      noteIds: ["c1", "c2", "gc"],
      allIds: ["g", "keep", "c1", "c2", "gc"],
    },
  },
  {
    id: "dfp-requires-trashed",
    title: "dfp 边只对 trashed 行有效：deleted_from_parent_id 指向根但未 trashed 的行不得收进来",
    rootId: "g",
    nodes: [
      { id: "nb", kind: "folder", parent_id: null },
      { id: "g", kind: "folder", parent_id: "nb" },
      { id: "d", kind: "note", parent_id: "nb", deleted_from_parent_id: "g", trashed_at: null },
    ],
    expect: {
      folderIds: ["g"],
      noteIds: [],
      allIds: ["g"],
    },
  },
];
