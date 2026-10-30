/**
 * 移动端多维表「数据表」抽屉（261030 用户点单：钉钉有多数据表切换，我们也要）。
 *
 * 形态对齐钉钉：左侧滑出面板 = 搜索 + 表列表（当前项高亮）+ 底部「新建数据表」。
 * 语义来自 core：一张文档 = 多张数据表（`BitableDoc.tables`），切换只写**设备本地导航**（不进正文/不同步）；
 * 「新建数据表」= 文档写入，只在编辑态可用（只读态置灰 + 写明理由）。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, MoreHorizontal, Plus, Search, Table2, X } from "lucide-react";
import type { BitableTable } from "../../core/bitableDoc.js";
import { pushBackHandler } from "../ui/backStack";
import { dismissKeyboard } from "../ui/dismissKeyboard";

export interface MobileBitableTableDrawerProps {
  open: boolean;
  tables: readonly BitableTable[];
  activeTableId: string;
  editable: boolean;
  onSelect: (tableId: string) => void;
  onCreate?: () => void;
  /** 行内 ⋮：把「要操作哪张表」交给父级（操作面板是外层浮层，避免与抽屉抢层序）。 */
  onActions: (tableId: string) => void;
  onClose: () => void;
}

export function MobileBitableTableDrawer({ open, tables, activeTableId, editable, onSelect, onCreate, onActions, onClose }: MobileBitableTableDrawerProps) {
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) setQuery(""); }, [open]);
  // 返回键/返回手势先关抽屉（否则会退到工作区）。
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);
  useEffect(() => { if (open) dismissKeyboard(); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tables.filter((table) => table.name.toLowerCase().includes(q)) : tables;
  }, [tables, query]);

  if (!open) return null;
  return (
    <>
      <div className="mbt-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="mbt-drawer" role="dialog" aria-modal="true" aria-label="数据表">
        <header className="mbt-drawer__head">
          <span className="mbt-drawer__title">数据表</span>
          <button type="button" className="mb-iconbtn" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="mbt-drawer__search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索数据表" aria-label="搜索数据表" />
        </div>
        <div className="mbt-drawer__list">
          {filtered.map((table) => {
            const on = table.id === activeTableId;
            return (
              <div key={table.id} className={"mbt-drawer__row" + (on ? " is-on" : "")}
                role="button" tabIndex={0} aria-current={on ? "true" : undefined}
                onClick={() => onSelect(table.id)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(table.id); } }}>
                <Table2 size={16} className="mbt-drawer__icon" aria-hidden="true" />
                <span className="mbt-drawer__name">{table.name}</span>
                {on && <Check size={16} className="mbt-drawer__check" aria-hidden="true" />}
                <button type="button" className="mbt-drawer__more" aria-label={"数据表操作 " + table.name}
                  onClick={(event) => { event.stopPropagation(); onActions(table.id); }}>
                  <MoreHorizontal size={16} />
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="mbt-drawer__empty">没有匹配的数据表</div>}
        </div>
        <footer className="mbt-drawer__foot">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" disabled={!editable || !onCreate} onClick={() => onCreate?.()}>
            <Plus size={15} />新建数据表
          </button>
          {!editable && <div className="mbt-drawer__hint">只读状态不能新建数据表</div>}
        </footer>
      </aside>
    </>
  );
}

export default MobileBitableTableDrawer;
