/**
 * Phase C4 验证：桌面 TreeRepository adapter（DesktopTreeRepository）与直接 Store 调用语义一致；
 * 且实现共享接口（移动端 folders CRUD 同接口，两端目录语义统一）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../electron/store.js";
import { DesktopTreeRepository } from "./treeRepositoryAdapter.js";

function makePair(): { store: Store; repo: DesktopTreeRepository; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "lake-adapter-"));
  const store = new Store(dir);
  return { store, repo: new DesktopTreeRepository(store), dir };
}

describe("DesktopTreeRepository（共享 TreeRepository 接口适配）", () => {
  it("createNotebook + icon：与 store 组合语义一致（node 创建后 setNodeIcon）", async () => {
    const { repo, store, dir } = makePair();
    const node = await repo.createNotebook({ title: "  我的知识库  ", icon: "📚" });
    expect(node.title).toBe("我的知识库"); // trim
    expect(node.icon).toBe("📚"); // 组合 setNodeIcon
    const readBack = store.listTreeNodes().find((n) => n.id === node.id);
    expect(readBack?.icon).toBe("📚");
    rmSync(dir, { recursive: true, force: true });
  });

  it("listTreeNodes 透传", async () => {
    const { repo, store, dir } = makePair();
    store.createNotebook("本1");
    const nodes = await repo.listTreeNodes();
    expect(nodes.some((n) => n.title === "本1")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("renameTreeNode / setNodeIcon / moveTreeNodeOrdered 透传", async () => {
    const { repo, store, dir } = makePair();
    const nb = await repo.createNotebook({ title: "A", icon: null });
    const renamed = await repo.renameTreeNode(nb.id, "B");
    expect(renamed.title).toBe("B");
    const iconed = await repo.setNodeIcon(nb.id, "📕");
    expect(iconed.icon).toBe("📕");
    await repo.moveTreeNodeOrdered(nb.id, null, [nb.id]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("共享接口形状：移动端 bridge 与桌面 adapter 实现同一 TreeRepository（编译期约束）", async () => {
    const { repo, dir } = makePair();
    const methods: Array<keyof import("../core/ports.js").TreeRepository> = ["listTreeNodes", "createNotebook", "createGroup", "renameTreeNode", "setNodeIcon", "moveTreeNodeOrdered"];
    for (const m of methods) expect(typeof repo[m]).toBe("function");
    rmSync(dir, { recursive: true, force: true });
  });
});
