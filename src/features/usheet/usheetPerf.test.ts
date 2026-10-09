/**
 * 表格编辑器（usheet）性能护栏 —— 261010 实测批次。
 *
 * 两条都**只读源码**做结构性断言（与本仓库既有姿势一致：activeEditor.test.ts /
 * historySnapshotPreview.test.ts 都是读文件源码卡口径），因为真正的行为只能靠真实
 * Electron 量（vitest 起不了 Univer），而这两条一旦被改回去，性能会**静默**退回：
 *  ① 隐藏标签时若再销毁 Univer 实例，每次切回都要重建 —— 实测空窗 0.69s（打包 scheme）/1.83s（dev）；
 *  ② 去掉 dev 空闲预取，dev 首次打开表格要重付 1.86s 的模块图加载（Vite 逐个下发 + 未压缩代码执行）。
 * 实测口径（261010，隔离 userData + 真实 Electron + CDP，dev/scheme 双模式）：
 *   切标签「点击 → 画面」0.69s（scheme）/ 1.83s（dev，含重建）→ keep-alive 后 0.01s；
 *   dev 首次打开表格 3.68s → 0.18s（模块图加载移到空闲预取）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

const USHEET = read("./UniverSheetEditor.tsx");
const MULTI_TAB = read("../editor/MultiTabEditor.tsx");

describe("usheet 打开/切换性能护栏", () => {
  it("隐藏标签只补落盘、不销毁实例（keep-alive）", () => {
    const marker = "if (visible || !instanceRef.current) return;";
    const start = USHEET.indexOf(marker);
    expect(start, "找不到隐藏分支（UniverSheetEditor 的 visible 副作用）").toBeGreaterThan(-1);
    // 取该 effect 的一段窗口做断言：隐藏路径里不允许再出现 setReady(false)（那会触发 cleanup → dispose）
    const hideBlock = USHEET.slice(start, start + 400);
    expect(hideBlock, "隐藏时又销毁实例了：切标签会重新付 0.69s/1.83s 的重建空窗").not.toContain("setReady(false)");
    expect(hideBlock, "隐藏时应至少把未落盘改动补齐").toContain("void doFlush();");
  });

  it("dev 下空闲预取表格编辑器模块（打包侧保持真懒加载）", () => {
    expect(MULTI_TAB, "dev 空闲预取被删：dev 首开表格会重付 1.86s 模块图加载").toContain('import("../usheet/UniverSheetEditor")');
    expect(MULTI_TAB, "预取必须限 dev（打包侧不常驻解析 6.3MB 分包）").toContain("import.meta.env.DEV");
  });
});
