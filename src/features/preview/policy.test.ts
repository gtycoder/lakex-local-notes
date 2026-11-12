/**
 * 预览策略预设的护栏（261112 R1 预览基础层）。
 *
 * 目的：把「预览里能做什么」从 30 个入口各自的 if 收敛成 5 个预设。
 * 这里钉三件事：
 * 1. 预设键集合/顺序固定（新增空间先复用预设，不要自造字段）；
 * 2. 用户裁决的语义（Q05/Q06/Q09，261112 第二轮）：回收站/历史可放大原图、标签空间不内嵌正文；
 * 3. policy 模块保持**纯数据**（不 import React / 平台 / 内核）——它会被两端共用。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PREVIEW_POLICY } from "./policy";

describe("PREVIEW_POLICY：5 个预设", () => {
  it("键集合与顺序固定（docPane/trash/history/tagSpace/quickNoteCard）", () => {
    expect(Object.keys(PREVIEW_POLICY)).toEqual(["docPane", "trash", "history", "tagSpace", "quickNoteCard"]);
    for (const policy of Object.values(PREVIEW_POLICY)) {
      expect(["keep-alive", "reveal-latch"]).toContain(policy.mount);
      expect(typeof policy.inlineBody).toBe("boolean");
    }
  });

  it("文档阅读面 = 编辑器能力面：可复制、可卡片菜单、放大取原图", () => {
    expect(PREVIEW_POLICY.docPane).toMatchObject({
      inlineBody: true,
      zoomImage: { intent: "original" },
      openAttachment: true,
      copySelection: true,
      cardMenu: true,
      mount: "keep-alive",
    });
  });

  it("回收站/历史（Q04/Q06）：只读预览仍可放大原图/开附件，但不给复制与卡片菜单", () => {
    for (const key of ["trash", "history"] as const) {
      const policy = PREVIEW_POLICY[key];
      expect(policy, key).toMatchObject({
        inlineBody: true,
        zoomImage: { intent: "original" },
        openAttachment: true,
        copySelection: false,
        cardMenu: false,
      });
    }
  });

  it("标签空间（Q09 维持点击打开）：不内嵌正文、不放大、不开附件", () => {
    expect(PREVIEW_POLICY.tagSpace).toMatchObject({
      inlineBody: false,
      zoomImage: false,
      openAttachment: false,
      copySelection: false,
      cardMenu: false,
    });
  });

  it("小记卡片（Q02 放大换原图）：视口闩锁挂载 + 放大取原图", () => {
    expect(PREVIEW_POLICY.quickNoteCard).toMatchObject({
      inlineBody: true,
      zoomImage: { intent: "original" },
      mount: "reveal-latch",
    });
  });

  it("policy 模块是纯数据：不 import React / 内核 / 平台模块", () => {
    const src = readFileSync(new URL("./policy.ts", import.meta.url), "utf8");
    expect(src).toMatch(/from "\.\/types"/);
    expect(src).not.toMatch(/from "react"/);
    expect(src).not.toMatch(/lakeRuntime/);
    expect(src).not.toMatch(/from "react-dom"/);
  });
});
