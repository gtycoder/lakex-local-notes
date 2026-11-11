/**
 * 「复制为 Lake」内核注册表（261110）：登记 / 撤销 / 取最近一个。
 *
 * 行为约束：AI 写作可能同时挂多个答案 viewer（长会话），复制动作必须拿到**最近挂载**
 * 的那个内核；实例销毁前撤销，不能命中已销毁实例。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  getRegisteredLakeKernel,
  registerLakeKernel,
  unregisterLakeKernel,
} from "./aiLakeKernelRegistry";
import type { LakePayloadKernel } from "./aiLakeClipboard";

/** 只用于身份比较的假内核（注册表只存引用）。 */
function fakeKernel(): LakePayloadKernel {
  return { readData: () => null, writeData: () => "" };
}

const created: LakePayloadKernel[] = [];
function make(): LakePayloadKernel {
  const kernel = fakeKernel();
  created.push(kernel);
  return kernel;
}

afterEach(() => {
  // 测试隔离：把本文件登记过的内核全部撤销（注册表是模块级单例）。
  for (const kernel of created.splice(0)) unregisterLakeKernel(kernel);
});

describe("aiLakeKernelRegistry", () => {
  it("没有登记时返回 null（调用方回退到活动文档 / 隐藏宿主）", () => {
    expect(getRegisteredLakeKernel()).toBeNull();
  });

  it("登记后返回该内核；多个时返回最近登记的一个", () => {
    const first = make();
    const second = make();
    registerLakeKernel(first);
    expect(getRegisteredLakeKernel()).toBe(first);
    registerLakeKernel(second);
    expect(getRegisteredLakeKernel()).toBe(second);
  });

  it("撤销最近一个后回落到上一个；全部撤销后返回 null", () => {
    const first = make();
    const second = make();
    registerLakeKernel(first);
    registerLakeKernel(second);
    unregisterLakeKernel(second);
    expect(getRegisteredLakeKernel()).toBe(first);
    unregisterLakeKernel(first);
    expect(getRegisteredLakeKernel()).toBeNull();
  });

  it("重复登记同一实例只保留一份，撤销一次即移除；撤销未登记的实例静默无操作", () => {
    const kernel = make();
    registerLakeKernel(kernel);
    registerLakeKernel(kernel);
    unregisterLakeKernel(make());
    expect(getRegisteredLakeKernel()).toBe(kernel);
    unregisterLakeKernel(kernel);
    expect(getRegisteredLakeKernel()).toBeNull();
  });
});
