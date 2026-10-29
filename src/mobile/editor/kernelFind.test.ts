import { describe, expect, it, vi } from "vitest";
import { getKernelFindService, type KernelFindService } from "./kernelFind.js";

/** MOB-04：内核 search 服务是私有路径 ⇒ 适配层必须「取不到就归 null」，绝不抛错。 */
describe("getKernelFindService（内核查找服务适配层）", () => {
  it("非对象/空编辑器 → null", () => {
    expect(getKernelFindService(null)).toBeNull();
    expect(getKernelFindService(undefined)).toBeNull();
    expect(getKernelFindService("x")).toBeNull();
    expect(getKernelFindService({})).toBeNull();
  });

  it("没有 _$commandUnderlay/_renderer/getService → null", () => {
    expect(getKernelFindService({ _$commandUnderlay: {} })).toBeNull();
    expect(getKernelFindService({ _$commandUnderlay: { _renderer: {} } })).toBeNull();
    expect(getKernelFindService({ _$commandUnderlay: { _renderer: { getService: 1 } } })).toBeNull();
  });

  it("getService 抛错/返回空/返回无 onSearch 的对象 → null", () => {
    const throwing = { _$commandUnderlay: { _renderer: { getService: () => { throw new Error("boom"); } } } };
    expect(getKernelFindService(throwing)).toBeNull();
    const empty = { _$commandUnderlay: { _renderer: { getService: () => null } } };
    expect(getKernelFindService(empty)).toBeNull();
    const wrong = { _$commandUnderlay: { _renderer: { getService: () => ({}) } } };
    expect(getKernelFindService(wrong)).toBeNull();
  });

  it("按 { value: 'ISearchService' } 取到服务时原样返回", () => {
    const onSearch = vi.fn();
    const service: KernelFindService = { onSearch } as unknown as KernelFindService;
    const getService = vi.fn(() => service);
    const editor = { _$commandUnderlay: { _renderer: { getService } } };
    expect(getKernelFindService(editor)).toBe(service);
    expect(getService).toHaveBeenCalledWith({ value: "ISearchService" });
  });
});
