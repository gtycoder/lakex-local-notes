/**
 * DT-06 类型护栏：五种编辑器宿主的 props 必须仍是 `EditorHostProps` 的**子集/超集契约**。
 *
 * 用 vitest 的 `expectTypeOf`（编译期断言，运行时是空操作）：宿主 prop 词表一旦漂移
 * （漏掉 noteId/readOnly/onCapture，或有人又把 active/paneVisible 写回宿主层），
 * 类型检查即失败——不需要渲染内核，也不想再加源码字符串断言。
 *
 * 边界：只锁「契约字段齐不齐」，不锁生命周期/时序（那些仍由各宿主实现与设备级走查覆盖）。
 */
import { describe, expectTypeOf, it } from "vitest";
import type { EditorHostProps } from "./editorHost";
import type { EditorTabProps } from "./EditorTab";
import type { UsheetEditorProps } from "../usheet/UniverSheetEditor";
import type { BitableEditorProps } from "../bitable/BitableEditor";
import type { BoardEditorProps } from "../board/BoardEditor";
import type { DesktopInkPadProps } from "../ink/DesktopInkPad";

describe("DT-06 宿主契约（features/editor/editorHost.ts）", () => {
  it("5 种宿主都消费同一份 prop 词表", () => {
    // doc 宿主没有 capture 注册入口（正文由内核实例现取），故只要求除 onCapture 外的全部字段。
    expectTypeOf<EditorTabProps>().toMatchTypeOf<Omit<EditorHostProps, "onCapture">>();
    expectTypeOf<UsheetEditorProps>().toMatchTypeOf<EditorHostProps>();
    expectTypeOf<BitableEditorProps>().toMatchTypeOf<EditorHostProps>();
    expectTypeOf<BoardEditorProps>().toMatchTypeOf<EditorHostProps>();
    expectTypeOf<DesktopInkPadProps>().toMatchTypeOf<EditorHostProps>();
  });
});
