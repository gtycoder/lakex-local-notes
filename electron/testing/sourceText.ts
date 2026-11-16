/**
 * 测试专用源码工具（**进产物？不进** —— 只被 *.test.ts 引用，见 architecture.test.ts 的 TEST_SUPPORT_FILES）。
 *
 * 为什么需要它：门禁里有一批「源码文本断言」（buildContract.test / aiThinkingIpc.test / architecture.test）。
 * 直接 `source.includes("appDirOf(BUILD_DIR)")` 有个致命弱点 —— **注释也能满足它**：把实现改回旧写法、
 * 只要注释里还留着那串，门禁照绿。所以统一「先剥注释、再匹配」。
 *
 * 剥注释规则：字符级状态机，只处理 // 行注释与 /* *\/ 块注释；**保留字符串字面量**（因为要断言的正是
 * 字符串里的路径/调用文本）。模板字符串里的 ${} 不做插值分析（够用：这些断言都在普通代码里）。
 */

/** 把注释替换成空格（保留换行与字符串字面量），便于对源码做文本断言。 */
export function stripComments(source: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "str" = "code";
  let quote = "";
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; out += "  "; i += 1; continue; }
      if (c === "/" && next === "*") { mode = "block"; out += "  "; i += 1; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; out += c; continue; }
      out += c;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; } else { out += " "; }
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; out += "  "; i += 1; continue; }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    // mode === "str"
    if (c === "\\") { out += c + (next ?? ""); i += 1; continue; }
    if (c === quote) mode = "code";
    out += c;
  }
  return out;
}

/** 断言用：剥注释后是否包含该片段（注释里的同名字串不算）。 */
export function containsCode(source: string, snippet: string): boolean {
  return stripComments(source).includes(snippet);
}
