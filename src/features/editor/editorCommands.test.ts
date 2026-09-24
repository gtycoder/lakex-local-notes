import { describe, it, expect } from "vitest";
import {
  KNOWN_COMMAND_NAMES, isKnownEditorCommand, STYLE_BLOCKS, TOOLBAR_BLOCK_ITEMS,
  MARK_COMMANDS, BLOCK_INSERT_COMMANDS, HISTORY_COMMANDS,
} from "./editorCommands";

describe("editorCommands registry", () => {
  it("KNOWN_COMMAND_NAMES covers every registered command + style", () => {
    const registered = [...MARK_COMMANDS, ...BLOCK_INSERT_COMMANDS, ...HISTORY_COMMANDS].map((c) => c.name);
    for (const name of registered) expect(KNOWN_COMMAND_NAMES.has(name)).toBe(true);
    expect(KNOWN_COMMAND_NAMES.has("style")).toBe(true);
  });

  it("rejects true lakex no-op command names (HANDOFF §8.2/§8.8)", () => {
    const noOps = [
      "strike", "justifyLeft", "justifyCenter", "justifyRight",
      "formatBlock", "heading", "setHeading", "insertUnorderedList", "insertBulletList",
    ];
    for (const name of noOps) expect(isKnownEditorCommand(name)).toBe(false);
  });

  it("accepts desktop-verified commands (260924 P0: strikethrough/fontsize/…)", () => {
    for (const name of ["strikethrough", "fontsize", "indent", "outdent", "clearFormat", "alignment", "link", "unlink", "color", "bgColor"]) {
      expect(isKnownEditorCommand(name)).toBe(true);
    }
  });

  it("style blocks are p/h1..h4", () => {
    expect(STYLE_BLOCKS.map((b) => b.value)).toEqual(["p", "h1", "h2", "h3", "h4"]);
  });

  it("group filter returns only that group", () => {
    const markNames = MARK_COMMANDS.map((c) => c.name);
    expect(markNames).toEqual(["bold", "italic", "underline", "strikethrough", "code"]);
  });

  it("TOOLBAR_BLOCK_ITEMS：原「转为」拆散为 5 个独立按钮；无高亮块；仅行内代码是 mark（260924 续）", () => {
    expect(TOOLBAR_BLOCK_ITEMS.map((i) => i.name)).toEqual(["orderedList", "unorderedList", "taskList", "quote", "code"]);
    expect(TOOLBAR_BLOCK_ITEMS.some((i) => i.name === "alert" || i.label.includes("高亮"))).toBe(false);
    const code = TOOLBAR_BLOCK_ITEMS.find((i) => i.name === "code");
    expect(code?.label).toBe("行内代码");
    expect(code?.icon).toBe("editor-inlinecode");
    expect(code?.kind).toBe("mark");
    for (const item of TOOLBAR_BLOCK_ITEMS.filter((i) => i.name !== "code")) expect(item.kind).toBe("block");
  });
});
