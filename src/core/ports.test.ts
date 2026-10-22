import { describe, expect, it } from "vitest";
import type { AppInfoPort, CachePort, CreateNotebookInput, SecretStore, TreeRepository } from "./ports.js";

describe("ports 共享接口（Phase 0A）", () => {
  it("CreateNotebookInput 形状：title 必填 string，icon string|null", () => {
    const valid: CreateNotebookInput = { title: " 我的知识库 ", icon: null };
    const withIcon: CreateNotebookInput = { title: "知识库", icon: "📚" };
    expect(valid.title.trim()).toBe("我的知识库");
    expect(withIcon.icon).toBe("📚");
  });

  it("TreeRepository 接口方法签名齐全（编译期校验）", () => {
    const repo: TreeRepository = {
      listTreeNodes: async () => [],
      createNotebook: async (input) => ({
        id: "n1", workspaceId: "w", parentId: null, nodeType: "notebook",
        title: input.title, noteFileId: null, sortOrder: 0,
        createdAt: "", updatedAt: "", syncState: "local", isConflict: false, icon: input.icon,
      }),
      createGroup: async () => { throw new Error("unused"); },
      renameTreeNode: async () => { throw new Error("unused"); },
      setNodeIcon: async () => { throw new Error("unused"); },
      moveTreeNodeOrdered: async () => { throw new Error("unused"); },
    };
    expect(typeof repo.createNotebook).toBe("function");
    expect(typeof repo.listTreeNodes).toBe("function");
  });

  it("SecretStore memory fake 语义：write/read/remove", async () => {
    const store: SecretStore = { read: async () => null, write: async () => {}, remove: async () => {} };
    await store.write("s3.secret", "abc");
    // fake 仅用于类型验证；真实实现语义由各平台 adapter 测试覆盖
    await expect(store.read("s3.secret")).resolves.toBeNull();
    await store.remove("s3.secret");
  });

  it("CachePort 接口方法签名齐全（编译期校验）", () => {
    const port: CachePort = {
      getCacheSummary: async () => ({
        runtimeBlobBytes: 0, tempFileBytes: 0,
        downloadableAssetBytes: 0, pendingUploadBytes: 0,
      }),
      clearDerivedCaches: async () => ({ cleared: {} }),
    };
    expect(typeof port.getCacheSummary).toBe("function");
    expect(typeof port.clearDerivedCaches).toBe("function");
  });

  it("AppInfoPort 接口方法签名齐全（编译期校验）", () => {
    const port: AppInfoPort = {
      getAppInfo: async () => ({ name: "LocalLakexNotes", version: "0.1.0", build: "1", protocolVersion: "4", platform: "test" }),
    };
    expect(typeof port.getAppInfo).toBe("function");
  });
});
