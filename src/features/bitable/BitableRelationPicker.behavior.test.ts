// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BitableRelationPicker } from "./BitableRelationPicker";
import type { BitableField, BitableTable } from "../../core/bitableDoc";

const target: BitableTable = {
  id: "target", name: "目标表",
  fields: Array.from({length: 20}, (_, i) => ({id: "f"+i, name: "列"+i, type: i===0?"text":"number", width:150})),
  records: Array.from({length: 5000}, (_, i) => ({id:"t"+i, values:{f0:"目标"+i, f1:i}, createdAt:"2026-10-14T00:00:00Z", updatedAt:"2026-10-14T00:00:00Z"})),
  views: [{id:"v", name:"全部", type:"grid"}], activeViewId:"v",
};
const field: BitableField={id:"rel",name:"关联",type:"relationOneWay",relation:{tableId:"target",allowMultiple:true}};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let confirm = vi.fn<(ids: string[]) => void>();
let cancel = vi.fn<() => void>();
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("ResizeObserver",class{observe(){} unobserve(){} disconnect(){}});
  vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockImplementation(function(this:HTMLElement){return this.className==="bt-rel-body"?600:36;});
  vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(900);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);confirm=vi.fn<(ids: string[]) => void>();cancel=vi.fn<() => void>();
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
function render(value: string[]=["t0"], nextField=field, table=target){act(()=>root.render(createElement(BitableRelationPicker,{field:nextField,value,ctx:{tables:[table]},onConfirm:confirm,onCancel:cancel})));}
function click(selector:string){const el=document.querySelector<HTMLElement>(selector)!;expect(el).not.toBeNull();act(()=>el.click());}
function clickText(selector:string,text:string){const el=[...document.querySelectorAll<HTMLElement>(selector)].find(e=>e.textContent===text)!;expect(el).not.toBeUndefined();act(()=>el.click());}
function search(text:string){const el=document.querySelector<HTMLInputElement>('input[aria-label="搜索相关记录"]')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,text);el.dispatchEvent(new Event("input",{bubbles:true}));});}

describe("关联选择器有界视口与完整草稿语义",()=>{
  it("5000×20只挂窗口控件，保留完整候选数量和字段",()=>{
    render();
    const rows=document.querySelectorAll(".bt-rel-grid tr[data-record-id]");
    expect(rows.length).toBeGreaterThan(0);expect(rows.length).toBeLessThan(50);
    expect(document.querySelector(".bt-rel-grid tbody")?.getAttribute("data-record-count")).toBe("5000");
    expect(document.querySelectorAll(".bt-rel-grid thead th")).toHaveLength(21);
    expect(document.querySelectorAll(".bt-rel-grid tbody input").length).toBe(rows.length);
    expect(document.querySelectorAll(".bt-rel-grid tbody input:not([type=checkbox])")).toHaveLength(0);
    expect(document.querySelector('.bt-rel-grid tr[data-record-id="t0"]')?.textContent).toContain("目标0");
    expect(document.querySelector('.bt-rel-grid tr[data-record-id="t4999"]')).toBeNull();
    expect(target.records).toHaveLength(5000);
  });
  it("全局搜索能命中从未挂载的末记录，清空恢复完整窗口",()=>{
    render();search("目标4999");
    expect(document.querySelectorAll(".bt-rel-grid tr[data-record-id]")).toHaveLength(1);
    expect(document.querySelector('.bt-rel-grid tr[data-record-id="t4999"]')).not.toBeNull();
    search("");expect(document.querySelector(".bt-rel-grid tbody")?.getAttribute("data-record-count")).toBe("5000");expect(confirm).not.toHaveBeenCalled();
  });
  it("跨屏选择只改草稿，确认后保序输出屏外与末行ID",()=>{
    const initial=JSON.stringify(target);render();
    const body=document.querySelector<HTMLElement>(".bt-rel-body")!;
    act(()=>{body.scrollTop=5000*36-600;body.dispatchEvent(new Event("scroll"));});
    click('.bt-rel-grid tr[data-record-id="t4999"] input[type="checkbox"]');
    expect(confirm).not.toHaveBeenCalled();expect(JSON.stringify(target)).toBe(initial);
    clickText(".bt-rel-foot button","确认");expect(confirm).toHaveBeenLastCalledWith(["t0","t4999"]);
  });
  it("取消不确认、不改变原模型，卸载释放选择器行",()=>{
    render();click('.bt-rel-grid tr[data-record-id="t1"] input[type="checkbox"]');clickText(".bt-rel-foot button","取消");
    expect(cancel).toHaveBeenCalledOnce();expect(confirm).not.toHaveBeenCalled();
    act(()=>root.render(null));expect(document.querySelectorAll(".bt-rel-grid tr[data-record-id]")).toHaveLength(0);
  });
  it("已选页签保持选择顺序，不因原表顺序重排",()=>{
    render(["t4999","t0"]);click('.bt-rel-tabs button[aria-selected="false"]');
    expect([...document.querySelectorAll<HTMLElement>(".bt-rel-grid tr[data-record-id]")].map(e=>e.dataset.recordId)).toEqual(["t4999","t0"]);
  });
  it("单条关联选择仍然替换旧值",()=>{
    render(["t0"],{...field,relation:{...field.relation,allowMultiple:false}});
    click('.bt-rel-grid tr[data-record-id="t1"] input[type="checkbox"]');clickText(".bt-rel-foot button","确认");expect(confirm).toHaveBeenLastCalledWith(["t1"]);
  });
  it("数据范围过滤与分组复用core，候选不是视口子集",()=>{
    const table={...target,views:[{id:"v",name:"尾部范围",type:"grid",filters:[{fieldId:"f1",operator:"greaterThanOrEqualTo" as const,value:"4990"}],groups:[{fieldId:"f1"}]}]};
    render([], {...field,relation:{...field.relation,viewId:"v"}},table);
    expect(document.querySelector(".bt-rel-tabs")?.textContent).toContain("10");
    expect(document.querySelector(".bt-rel-grid tbody")?.getAttribute("data-record-count")).toBe("10");
    expect(document.querySelectorAll(".bt-rel-group-row").length).toBeGreaterThan(0);
    expect(document.querySelector('.bt-rel-grid tr[data-record-id="t0"]')).toBeNull();
  });
});
