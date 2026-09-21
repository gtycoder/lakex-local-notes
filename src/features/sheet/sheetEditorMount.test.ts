/**
 * SheetEditor（FortuneSheet）挂载护栏（260919）。
 *
 * 背景：表格内核由 jspreadsheet CE 换成 FortuneSheet（见 docs/FORTUNESHEET-FEASIBILITY-260919.md）。
 * vitest 是 node 环境、起不了 FortuneSheet（canvas），故用源码级断言（与 blockMenuNative.test.ts 同套路），
 * 锁死三条易回归的集成约束：
 * - keep-alive：只在「首次可见」后才挂载 <Workbook>（canvas 在 display:none 里初始化会量成 0 尺寸）；
 * - 非受控数据：data 只作初始值，不能把 onChange 回来的 data 再 setState 回灌（会打断输入/光标跳）；
 * - 只读：allowEdit=false + 只读态不挂自动保存。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SheetEditor.tsx", import.meta.url), "utf8");

describe("SheetEditor（FortuneSheet）挂载护栏", () => {
  it("引入 FortuneSheet 的 Workbook，且不再引用 jspreadsheet CE", () => {
    expect(SRC).toMatch(/from "@fortune-sheet\/react"/);
    expect(SRC).not.toMatch(/from "jspreadsheet-ce"/);
  });

  it("keep-alive：用 everVisible 保证首次可见后才挂载 Workbook", () => {
    expect(SRC).toMatch(/everVisible/);
    expect(SRC).toMatch(/\{everVisible && sheets\.length > 0 && \(/);
  });

  it("非受控数据：onChange 只写 ref，绝不 setSheets 回灌", () => {
    expect(SRC).toMatch(/latestRef\.current = next/);
    expect(SRC).not.toMatch(/setSheets\(/);
  });

  it("只读：allowEdit 取反；只读态不自动保存", () => {
    expect(SRC).toMatch(/allowEdit=\{!readOnly\}/);
    expect(SRC).toMatch(/readOnlyRef\.current/);
  });

  it("完全去掉浮动图片：工具栏 / 右键菜单都用 cell-image 取代 image", () => {
    expect(SRC).not.toMatch(/TOOLBAR_ITEMS = \[[\s\S]*?"image"/);
    expect(SRC).toContain('"filter", "link", "cell-image", "comment"');
    expect(SRC).toContain('cellContextMenu={CELL_CONTEXT_MENU}');
    expect(SRC).toMatch(/const CELL_CONTEXT_MENU = \[[\s\S]*?"cell-image"[\s\S]*?\];/);
    expect(SRC).not.toMatch(/const CELL_CONTEXT_MENU = \[[\s\S]*?"image"/);
    // 同一个 key 两处复用（内核补丁按 customToolbarItems 的 key 解析）
    expect(SRC).toContain('key: "cell-image", tooltip: "插入图片"');
  });

  it("工具栏：用户 260921 点名加回的 4 项必须在列（防再次被静默精简）", () => {
    for (const item of ["format", "link", "comment", "locationCondition"]) {
      expect(SRC).toContain(`"${item}"`);
    }
  });

  it("宿主宽度变化补发 window.resize（内核只监听 resize，无 ResizeObserver ⇒ 目录栏切换后会留白）", () => {
    expect(SRC).toMatch(/new ResizeObserver/);
    expect(SRC).toMatch(/dispatchEvent\(new Event\("resize"\)\)/);
    expect(SRC).toMatch(/ref=\{hostRef\}/);
  });
});

/**
 * 图片资产化（260920 P1，见 docs/SHEET-IMAGE-MANAGEMENT-260919.md §4）。四条易回归的集成约束。
 */
describe("SheetEditor 图片走资产管线（P1）", () => {
  it("复用内核同一条上传通道，不自己造落盘路径", () => {
    expect(SRC).toMatch(/uploadLakeResource\(\{ type: "base64", data: /);
    expect(SRC).not.toMatch(/native\.uploadResource/);
    expect(SRC).not.toMatch(/writeFile|writeSync/);
  });

  it("提升未落地前推迟保存（正文绝不落 base64）", () => {
    expect(SRC).toMatch(/promoteInFlightRef\.current > 0/);
    expect(SRC).toMatch(/promoteInFlightRef\.current \+= 1/);
    expect(SRC).toMatch(/promoteInFlightRef\.current -= 1/);
  });

  it("保存口径：提升过的 data URL 换成资产 URL（URL→filename 由 core sanitize 负责）", () => {
    expect(SRC).toMatch(/sheetsToBody\(withPromotedImageSrc\(latestRef\.current, promotedRef\.current\)\)/);
    expect(SRC).toMatch(/withPromotedImageSrc/);
  });

  it("渲染口径：磁盘 filename 拼本实例端口的 URL（A/B 双开各用各的）", () => {
    expect(SRC).toMatch(/sheetImageSrc\(src, noteId, ASSET_PORT, width\)/);
    expect(SRC).toMatch(/withRenderableImageSrc\(sheet, noteId\)/);
  });

  it("打开即自愈：正文里遗留的内联图片在挂载时就提升（不写旧数据兼容代码）", () => {
    expect(SRC).toMatch(/promoteInlineImages\(latestRef\.current\)/);
    // 不按版本号分支：filename 与 data: 两种形态走同一条路径
    expect(SRC).not.toMatch(/SHEET_DOC_VERSION/);
  });
});

/**
 * 单元格图片（260921 P2，见 docs/SHEET-IMAGE-MANAGEMENT-260919.md）。
 * 设计定案：**不改内核、不自建 DOM 覆盖层**——复用内核浮动图通道渲染（滚动跟随/视口裁剪/缩放全免费），
 * 只在模型里多一个 `cell` 锚点 + 宿主维护几何 + CSS 控比例。以下每条都是易回归的集成约束。
 */
describe("SheetEditor 单元格图片（P2）", () => {
  const CSS = readFileSync(new URL("./sheetEditor.css", import.meta.url), "utf8");

  it("锚点写在 images[].cell 上，几何按单元格矩形同步（onOp 触发）", () => {
    expect(SRC).toContain("cell: { r: anchor.r, c: anchor.c }");
    expect(SRC).toContain("sheetRangeRect(");
    expect(SRC).toContain("onOp={handleOp}");
  });

  it("几何写回走 applyOp 的 replace 整数组（幂等；noHistory 不污染撤销栈）", () => {
    expect(SRC).toContain('path: ["images"]');
    expect(SRC).toContain('op: "replace"');
    expect(SRC).toContain("applyOp(");
  });

  it("渲染：复用内核浮动图通道 + CSS 锁比例（object-fit: scale-down / 禁指针事件）", () => {
    expect(CSS).toContain('.sheet-editor [id^="cellimg_"] {');
    expect(CSS).toContain("pointer-events: none;");
    expect(CSS).toContain("object-fit: scale-down;");
  });

  it("冻结窗格内的图补 translate 偏移（内核 DOM 图不冻结，会和内容一起滚走）", () => {
    expect(SRC).toContain("applyFrozenOffsets");
    expect(SRC).toContain("area.scrollTop");
    expect(SRC).toContain('addEventListener("scroll"');
  });

  it("只读态：不改模型、不给入口", () => {
    expect(SRC).toContain("if (!changed || readOnlyRef.current) return;");
    expect(SRC).toMatch(/readOnly\s*\?\s*\[\]/);
  });

  it("插入走文档同一条资产管线（不自己造落盘路径）", () => {
    expect(SRC).toContain("await uploadLakeResource(file, noteId)");
    expect(SRC).toContain("cellImageInputRef");
  });

  it("粘贴图片挂 document 捕获阶段（文本/表格粘贴仍归内核）", () => {
    expect(SRC).toContain('document.addEventListener("paste", onPaste, true)');
    expect(SRC).toContain("host.contains(event.target)");
    // 2A 后不再自己处理 Delete/Backspace（内核 deleteSelectedCellText 把 cell 换成 {}，img 随之消失）
    expect(SRC).not.toContain('document.addEventListener("keydown", onKeyDown, true)');
  });


  it("单元格图片工具弹窗：选区变化弹条 + 查看大图 / 下载原图 / 删除", () => {
    expect(SRC).toContain("afterSelectionChange");
    expect(SRC).toContain("refreshCellImageMenu");
    expect(SRC).toContain('className="sheet-cell-image-menu"');
    expect(SRC).toContain("openCellImageLightbox");
    expect(SRC).toContain("openImagePreview([{ src: url }], 0)");
    expect(SRC).toContain("downloadCellImage");
    expect(SRC).toContain("native.saveAssetAs(noteId, disk, disk)");
    expect(SRC).toContain("deleteCellImageById");
    // 原图 URL 从落盘 filename 重拼（模型里的 src 可能带缩略图档位）
    expect(SRC).toContain("sheetImageDiskSrc(src)");
  });

  it("2A：单元格图片的唯一真相是 cell.img，images[] 由 reconcile 反推", () => {
    expect(SRC).toContain("reconcileCellImages");
    expect(SRC).toContain("img: { id, src: filename }");
    expect(SRC).toContain("reconcileCellImages();");
    // 同一 id 被复制到多格时补新 id（copy 会连带复制 img.id）
    expect(SRC).toContain("if (!id || seen.has(id))");
    // 不再有应用层剪贴板桥 / onOp 锚点平移
    expect(SRC).not.toContain("recordClipboardCellImages");
    expect(SRC).not.toContain("pasteClipboardCellImages");
    expect(SRC).not.toContain("applyRowColImageShifts");
    expect(SRC).not.toContain("clipboardCellImagesRef");
  });

  it("选区读取一律走 safeGetSelection（内核 getSelection 在选区非数组时会抛错并触发错误边界卸载编辑器）", () => {
    expect(SRC).toContain("function safeGetSelection");
    expect(SRC).toContain("Array.isArray(sel) ? (sel as Array<{ row?: number[]; column?: number[] }>) : []");
    // 不允许再有裸的 getSelection 调用
    expect(SRC).not.toContain("workbookRef.current?.getSelection?.()");
    expect(SRC).not.toContain("wb.getSelection()");
  });

  it("右键「向上/向下插入」默认数量 = 选中行/列数（内核补丁）", () => {
    const PATCH = readFileSync(new URL("../../../patches/@fortune-sheet+react+1.0.4.patch", import.meta.url), "utf8");
    expect(PATCH).toContain("defaultValue: String(selection && selection.row");
    expect(PATCH).toContain("defaultValue: String(selection && selection.column");
  });

  it("弹窗刷新对相同值早退（内核 onChange 身份每次 render 都变 ⇒ 否则与 rAF 形成 60fps 死循环）", () => {
    expect(SRC).toContain("prev && prev.id === id && prev.left === left && prev.top === top ? prev : { id, left, top }");
    // 图片 DOM 可能晚于刷新提交：有界重试
    expect(SRC).toContain("menuRetryRef.current < 12");
  });

  it("A：插入/删除行列由内核搬 cell 数据，图片随 cell.img 一起走", () => {
    expect(SRC).toContain("reconcileCellImages");
    expect(SRC).toContain("cell: { r: info.r, c: info.c }");
    expect(SRC).not.toContain("applyRowColImageShifts");
  });

  it("B：copy/cut/paste 由内核搬 cell 数据，图片随 cell.img 一起走（不再自建剪贴板桥）", () => {
    expect(SRC).not.toContain("recordClipboardCellImages");
    expect(SRC).not.toContain("pasteClipboardCellImages");
    expect(SRC).not.toContain("cellimg_paste_");
    expect(SRC).toContain("const src = typeof img.src === \"string\" ? img.src : \"\";");
  });

  it("保留两处内核补丁：右键「粘贴」用内部 HTML、Cmd+A 不吃页面选区", () => {
    const RPATCH = readFileSync(new URL("../../../patches/@fortune-sheet+react+1.0.4.patch", import.meta.url), "utf8");
    const CPATCH = readFileSync(new URL("../../../patches/@fortune-sheet+core+1.0.4.patch", import.meta.url), "utf8");
    expect(RPATCH).toContain("_lakeUseInternal");
    expect(CPATCH).toContain('} else if (e.code === "KeyA") {');
    expect(CPATCH).toContain("e.preventDefault();");
  });

  it("细滚动条与色条裁切：CSS 覆盖内核自带样式", () => {
    expect(CSS).toContain(".sheet-editor .luckysheet-scrollbar-ltr::-webkit-scrollbar {");
    expect(CSS).toContain("box-shadow: inset 0 0 5px 5px var(--lake-scrollbar-thumb");   // P7：令牌已由 --b3-scroll-color 迁到 --lake-scrollbar-thumb
    expect(CSS).toContain('[style*="absolute"]) svg {');
    expect(CSS).toContain("clip-path: inset(0 0 26% 0);");
  });

  it("缩略图档位跟着显示宽度走（省掉大图的整张解码内存）", () => {
    // 档位按「模型宽度 × zoom × DPR」选，不能拿模型单位直接选（zoom=1.1 时差 10%）
    expect(SRC).toContain("cellImageThumbWidth(rect.width, zoom)");
    expect(SRC).toContain("assetThumbWidthForCss(rectWidth * zoom)");
    // 读取路径（打开即用缩略图，不能等几何同步那一次才换 src）与插入路径都要带上档位
    expect(SRC).toContain("cellImageThumbWidth(Number(image.width) || 0, zoom)");
    expect(SRC).toContain("cellImageThumbWidth(rect.width, sheetZoom(sheet))");
    // src 变了也算「几何变了」：否则早退会把档位换代吃掉
    expect(SRC).toContain("image.src === sized");
    // 浮动图不能被带上档位（可被用户任意拖大，档位会连续抖动）
    expect(SRC).toContain("cellAnchorOf(image) ? cellImageThumbWidth(");
  });
});
