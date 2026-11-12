/**
 * 字段级操作（增删改 / 复制 / 插入 / 视图内排序 / 隐藏）。字段与视图配置的清理全部走 core 单一来源。
 *
 * 261112 R1-S2：从 BitableEditor.tsx **原样搬出**（纯搬移：语句/依赖数组/行为零变化）。
 * 组件作用域的依赖通过参数显式传入（hook 不反向 import 容器）。
 */
import { useCallback } from "react";
import type { BitableField, BitableFieldType } from "../../core/bitableDoc.js";
import { createBitableField, isKnownFieldType, orderedAllTableFields, orderedTableFields } from "../../core/bitableDoc.js";
import { deleteBitableField, duplicateBitableField, renameAiFieldToken, stripViewRefsForFieldType } from "../../core/bitableMutations.js";
import type { BitableChromeMenuApi } from "./useBitableChromeMenu";
import type { DocRef, MoveItem, PatchActiveTable, UpdateDoc } from "./bitableEditorModel";
export function useBitableFields(deps: {
  patchActiveTable: PatchActiveTable;
  updateDoc: UpdateDoc;
  docRef: DocRef;
  moveItem: MoveItem;
  chrome: Pick<BitableChromeMenuApi, "setAddFieldAnchor" | "setFieldEditor" | "setColumnMenu">;
}) {
  const { patchActiveTable, updateDoc, docRef, moveItem, chrome } = deps;
  const { setAddFieldAnchor, setFieldEditor, setColumnMenu } = chrome;
  // ---- 字段 ----
  const addField = useCallback((rawType: string) => {
    // 菜单只给已知类型；未知类型（编辑弹窗里保留的）回落到文本，不做静默清空
    const type = (isKnownFieldType(rawType) ? rawType : "text") as BitableFieldType;
    const field = createBitableField(type);
    let added = false;
    patchActiveTable((table) => {
      added = true;
      return { ...table, fields: [...table.fields, field] };
    });
    setAddFieldAnchor(null);
    // 新建即进入编辑（261030 用户点单）：直接打开「编辑字段」弹窗改这个新字段，不用再去列菜单里找。
    if (added) setFieldEditor({ fieldId: field.id });
  }, [patchActiveTable]);
  /** 打开「新增字段」弹窗（记录详情抽屉 / 字段面板共用）。 */
  const openAddField = useCallback(() => setFieldEditor({ fieldId: null }), []);
  const updateField = useCallback((fieldId: string, patch: Partial<BitableField>) => {
    patchActiveTable((table) => {
      const before = table.fields.find((f) => f.id === fieldId);
      const fields = table.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
      const field = fields.find((f) => f.id === fieldId);
      if (!field) return table;
      // 字段重命名 → 同表 AI 字段命令里的 {{旧名}} 跟随改写（「插入字段」的变量保持可用；261003）。
      const nextName = typeof patch.name === "string" ? patch.name : null;
      const oldName = before?.name ?? null;
      const renamed = nextName && oldName && nextName !== oldName
        ? fields.map((f) => renameAiFieldToken(f, oldName, nextName))
        : fields;
      // 类型变更后清掉不再成立的视图引用（AR-F7 续）：只清配置、不迁移记录值。
      const views = table.views.map((view) => stripViewRefsForFieldType(view, field));
      return { ...table, fields: renamed, views };
    });
  }, [patchActiveTable]);
  /** 删除字段（AR02）：解除双向配对 + 清空**全部视图**里指向它的配置，收敛到 core 单一来源。 */
  const deleteField = useCallback((fieldId: string) => {
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => deleteBitableField(prev, tableId, fieldId));
    setColumnMenu(null);
    setFieldEditor(null);
  }, [updateDoc]);
  const duplicateField = useCallback((fieldId: string) => {
    // AR-F7 续：复制关联字段回落为单向、不继承配对（单一来源在 core）。
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => ({ ...prev, tables: duplicateBitableField(prev.tables, tableId, fieldId) }));
    setColumnMenu(null);
  }, [updateDoc]);
  const insertField = useCallback((fieldId: string, side: "before" | "after") => {
    const field = createBitableField("text");
    let inserted = false;
    patchActiveTable((table) => {
      const index = table.fields.findIndex((f) => f.id === fieldId);
      if (index < 0) return table;
      inserted = true;
      const fields = [...table.fields];
      fields.splice(side === "before" ? index : index + 1, 0, field);
      return { ...table, fields };
    });
    setColumnMenu(null);
    // 插入列同样「建完即编辑」：打开该新字段的「编辑字段」弹窗（261030 用户点单）。
    if (inserted) setFieldEditor({ fieldId: field.id });
  }, [patchActiveTable]);
  /** 列顺序是**视图级配置**（对齐云端）：拖拽只改当前视图的 fieldOrder，不动全局字段顺序。 */
  const reorderVisibleFields = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => {
      const view = table.views.find((v) => v.id === table.activeViewId);
      if (!view) return table;
      const currentIds = orderedTableFields(table, view).map((f) => f.id);
      const reordered = moveItem(currentIds.map((id) => ({ id })), fromId, toId, (x) => x.id).map((x) => x.id);
      const all = table.fields.map((f) => f.id);
      const fieldOrder = [...reordered, ...all.filter((id) => !reordered.includes(id))];
      return { ...table, views: table.views.map((v) => (v.id === view.id ? { ...v, fieldOrder } : v)) };
    });
  }, [patchActiveTable]);
  /** 表格配置面板拖拽排序：改视图 fieldOrder（视图级，网格列顺序跟随），不动全局字段顺序。 */
  const reorderPanelFields = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => {
      const view = table.views.find((v) => v.id === table.activeViewId);
      if (!view) return table;
      // 与网格列顺序 / 关联选择器同源：orderedAllTableFields（不再自己算 rank/sort）
      const current = orderedAllTableFields(table, view).map((f) => f.id);
      const fieldOrder = moveItem(current, fromId, toId, (id) => id);
      return { ...table, views: table.views.map((v) => (v.id === view.id ? { ...v, fieldOrder } : v)) };
    });
  }, [patchActiveTable]);
  const toggleFieldHidden = useCallback((fieldId: string) => {
    patchActiveTable((table) => ({
      ...table,
      views: table.views.map((v) => {
        if (v.id !== table.activeViewId) return v;
        const hidden = v.hiddenFieldIds ?? [];
        return { ...v, hiddenFieldIds: hidden.includes(fieldId) ? hidden.filter((id) => id !== fieldId) : [...hidden, fieldId] };
      }),
    }));
  }, [patchActiveTable]);


  return { addField, openAddField, updateField, deleteField, duplicateField, insertField, reorderVisibleFields, reorderPanelFields, toggleFieldHidden };
}
