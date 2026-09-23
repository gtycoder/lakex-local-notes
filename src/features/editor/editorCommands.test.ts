import { describe, it, expect } from "vitest";
import {
  KNOWN_COMMAND_NAMES, isKnownEditorCommand, STYLE_BLOCKS,
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
});
