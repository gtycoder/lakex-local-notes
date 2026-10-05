/**
 * 块句柄菜单「AI 助手」接线护栏（261005）。
 *
 * 要求：块菜单唤起 AI 面板时，**上下文 = 句柄覆盖的块**，且落库/替换**复用文字浮栏那一套**
 * （aiResultOps），绝不在块手柄侧另写一份插入/替换语义（AGENTS §3.14 单一来源）。
 * vitest 起不了内核，这里做源码级断言（与 blockMenuNative.test.ts 同一套路）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MOUNT = readFileSync(new URL("./blockHandleMount.ts", import.meta.url), "utf8");
const OPS = readFileSync(new URL("./selectionToolbar/aiResultOps.ts", import.meta.url), "utf8");
const MENU = readFileSync(new URL("../../../vendor/lakex-doc-react/src/components/BlockContextMenu/BlockContextMenu.tsx", import.meta.url), "utf8");

describe("块菜单「AI 助手」（261005）", () => {
  it("vendor 给所有块注入菜单项，且动作走宿主透传", () => {
    expect(MENU).toContain("items.unshift({ action: 'aiOutline', label: 'AI 助手'");
    expect(MENU).toContain("'aiOutline',");
  });

  it("手柄宿主接 onBlockAction，只处理 aiOutline", () => {
    expect(MOUNT).toContain("onBlockAction");
    expect(MOUNT).toContain('if (action !== "aiOutline"');
  });

  it("上下文 = 句柄覆盖的块（模型选区 / 自选整块 + 读选区内容）", () => {
    expect(MOUNT).toContain("captureModelRange(props.editor)");
    expect(MOUNT).toContain("selectBlockModelRange(props.editor, data.blockElement)");
    expect(MOUNT).toContain('execCommand?.("getSelectionContent", "text/markdown")');
    expect(MOUNT).toContain("selectionText: ai.text");
  });

  it("折叠选区必须自己选整块（菜单点击会把选区压成光标，否则替换退化成光标处插入）", () => {
    expect(MOUNT).toContain("isCollapsedRange(range)");
    expect(MOUNT).toContain("selectBlockModelRange(props.editor, data.blockElement)");
    expect(MOUNT).toContain("range.start.node === range.end.node");
  });
  it("落库/替换复用浮栏同源实现，不在手柄侧另写一套", () => {
    expect(MOUNT).toContain("applyAiInsertAfter(props.editor, props.container, ai.range, text)");
    expect(MOUNT).toContain("applyAiReplace(props.editor, props.container, ai.range, text)");
    expect(MOUNT).toContain("AiAssistantDialog");
    // 手柄侧不得直接拼内核插入命令（那是 aiResultOps 的职责）
    expect(MOUNT).not.toContain('"insertAtSelection"');
    expect(MOUNT).not.toContain('"insertAtPosition"');
    expect(MOUNT).not.toContain("buildAiInsertMarkdown");
    expect(OPS).toContain("export function applyAiInsertAfter");
    expect(OPS).toContain("export function applyAiReplace");
  });
});
