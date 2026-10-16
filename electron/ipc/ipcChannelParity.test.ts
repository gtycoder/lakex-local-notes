/**
 * IPC 通道**三方一致性**护栏（C2-2，261016）。
 *
 * ## 为什么不是"把通道名抽成常量表"（原方案）
 * 原方案：抽 `electron/ipc/channels.ts`，preload / native / register 都从它引。**实测不可行**：
 * `electron/preload.cjs` 是**原生 CJS**（`package.json` 的 files / asarUnpack 直接列该文件，**不进 Vite 构建**），
 * 它无法 import TS 模块；要让它消费常量表就得引入 codegen / 打包步骤——为省几张字面量引入构建复杂度不划算
 * （AGENTS §3#17）。⇒ 改成**护栏**：运行时一字不改，只把"三方必须一致"变成可执行判据。
 *
 * ## 三方（缺一方都只在运行时才炸）
 * ① **注册侧**：`electron/ipc/register*.ts` 的 `handle("<channel>")` / `handleEvent("<channel>")`
 * ② **暴露侧**：`electron/preload.cjs` 的 `invoke("<channel>")`
 * ③ **HTTP 侧**：`electron/webApiServer.ts` 的 `WEB_METHODS`（Web 客户端复用同一批 handler）
 *
 * ②↔③ 已有 `electron/webApiServer.test.ts` 断言（方法名与通道名逐条相等）；**本文件补上缺失的 ①↔② 与 ①↔③**。
 * 缺口的后果：只在 preload 暴露却忘了注册 ⇒ 运行时报 "No handler registered for ..."（用户点下去才知道）；
 * 只注册不暴露 ⇒ 死通道。**261016 实际发生过同类事故**：并发会话给 preload 加了 `find_in_document`
 * 却漏了 `WEB_METHODS`，被 ②↔③ 那条测试当场抓住 —— 那时 ①↔② 仍无人守。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WEB_METHODS } from "../webApiServer.js";

const ELECTRON = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** ① 注册侧：electron/ipc/*.ts 里 handle/handleEvent 的通道名。 */
function registrarChannels(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(ELECTRON, "ipc");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/\.(handle|handleEvent)\(\s*"([a-z0-9_]+)"/g)) {
      if (out.has(m[2])) throw new Error("通道被重复注册：" + m[2] + "（" + out.get(m[2]) + " 与 " + file + "）");
      out.set(m[2], file);
    }
  }
  return out;
}

/** ② 暴露侧：preload.cjs 的 invoke 通道（与 webApiServer.test.ts 同一提取口径）。 */
function preloadChannels(): Map<string, string> {
  const src = fs.readFileSync(path.join(ELECTRON, "preload.cjs"), "utf8");
  const out = new Map<string, string>();
  const re = /^\s*(\w+):\s*(?:\([^)]*\))?\s*=>\s*invoke\("([a-z0-9_]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (out.has(m[1])) throw new Error("preload.cjs 方法重复：" + m[1]);
    out.set(m[1], m[2]);
  }
  return out;
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe("IPC 通道三方一致性（C2-2）", () => {
  it("①↔②：注册侧与 preload 暴露侧完全一致（缺一都在运行时才炸）", () => {
    const registered = new Set(registrarChannels().keys());
    const exposed = new Set(preloadChannels().values());
    const notExposed = sorted([...registered].filter((c) => !exposed.has(c)));
    const notRegistered = sorted([...exposed].filter((c) => !registered.has(c)));
    expect(
      { 注册了但preload未暴露: notExposed, preload暴露但未注册: notRegistered },
      "注册侧（electron/ipc/register*.ts）与暴露侧（electron/preload.cjs）不一致：\n" +
        "  注册了但未暴露 = " + (notExposed.join(" ") || "（无）") + "\n" +
        "  暴露了但未注册 = " + (notRegistered.join(" ") || "（无）"),
    ).toEqual({ 注册了但preload未暴露: [], preload暴露但未注册: [] });
  });

  it("①↔③：注册侧与 WEB_METHODS 完全一致（Web 客户端复用同一批 handler）", () => {
    const registered = new Set(registrarChannels().keys());
    const webChannels = new Set(Object.values(WEB_METHODS));
    const missingInWeb = sorted([...registered].filter((c) => !webChannels.has(c)));
    const unknownInWeb = sorted([...webChannels].filter((c) => !registered.has(c)));
    expect(
      { 注册了但WEB_METHODS缺: missingInWeb, WEB_METHODS有但未注册: unknownInWeb },
      "注册侧与 electron/webApiServer.ts 的 WEB_METHODS 不一致：\n" +
        "  注册了但表里没有 = " + (missingInWeb.join(" ") || "（无）") + "\n" +
        "  表里有但未注册 = " + (unknownInWeb.join(" ") || "（无）"),
    ).toEqual({ 注册了但WEB_METHODS缺: [], WEB_METHODS有但未注册: [] });
  });

  it("规模钉死（防止无声增删通道）", () => {
    expect(registrarChannels().size, "通道数变了 ⇒ 请确认是有意的并在 commit 里说明").toBe(116);
    expect(preloadChannels().size).toBe(116);
    expect(Object.keys(WEB_METHODS).length).toBe(116);
  });
});
