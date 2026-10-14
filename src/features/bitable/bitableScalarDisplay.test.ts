// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CellEditor } from "./bitableCells";
let host: HTMLDivElement;let root: ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
function render(type:string,value:unknown,readOnly=true,readOnlyScalarDisplay=false){act(()=>root.render(createElement(CellEditor,{field:{id:"f",name:"值",type},value,readOnly,readOnlyScalarDisplay,onChange:vi.fn(),onAddOption:vi.fn()})));}
describe("选择器标量展示仍复用CellEditor，不改变普通输入/锁定复制入口",()=>{
 it("只读选择器文本使用文字，不分配只读input",()=>{render("text","全文",true,true);expect(host.querySelector("input")).toBeNull();expect(host.textContent).toBe("全文");});
 it("只读选择器数字零/负数/小数/空值不改展示字符串",()=>{for(const value of [0,-1,12.25,"",null]){render("number",value,true,true);expect(host.querySelector("input")).toBeNull();expect(host.textContent).toBe(value==null?"":String(value));}});
 it("普通可编辑格即使传展示标志仍是可编辑input",()=>{render("text","编辑值",false,true);expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("编辑值");expect(host.querySelector<HTMLInputElement>("input")!.readOnly).toBe(false);});
 it("默认锁定格保留原只读input供原生选字复制",()=>{render("text","可复制值");expect(host.querySelector<HTMLInputElement>("input")!.readOnly).toBe(true);expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("可复制值");render("number",0);expect(host.querySelector<HTMLInputElement>("input")!.type).toBe("number");});
 it("默认memo/重新渲染不能把展示值冻住或注入HTML",()=>{render("text","旧值",true,true);render("text","<b>新值</b>",true,true);expect(host.textContent).toBe("<b>新值</b>");expect(host.querySelector("b")).toBeNull();});
 it("选择器布尔/单选/日期仍按既有控件只读展示",()=>{render("boolean",true,true,true);expect(host.querySelector<HTMLInputElement>("input")!.checked).toBe(true);expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);render("date","2026-10-14",true,true);expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);});
});
