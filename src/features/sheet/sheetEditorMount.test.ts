/**
 * SheetEditor（FortuneSheet）挂载护栏（260919）。
 *
 * 背景：表格内核由 jspreadsheet CE 换成 FortuneSheet（见 docs/ARCHITECTURE.md）。
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
    expect(SRC).toMatch(/\{everVisible && fillMin && sheets\.length > 0 && \(/);
  });

  it("网格铺满：挂载前按宿主体量补足 row/column 下限（避免短表下方留白）", () => {
    expect(SRC).toMatch(/fillMin/);
    expect(SRC).toMatch(/Math\.max\(50, Math\.ceil\(host\.clientHeight/);
    expect(SRC).toMatch(/data=\{renderSheets as never\}/);
  });

  it("本机视图 / 脏判定（261006）：当前工作表 + 缩放走 sheetViewStore；只改展示不标脏", () => {
    expect(SRC).toMatch(/readSheetView/);
    expect(SRC).toMatch(/writeSheetView/);
    expect(SRC).toMatch(/if \(bodyOf\(latestRef\.current\) === lastSerializedRef\.current\) return;/);
  });

  it("非受控数据：onChange 只写 ref，绝不 setSheets 回灌", () => {
    expect(SRC).toMatch(/latestRef\.current = next/);
    expect(SRC).not.toMatch(/setSheets\(/);
  });

  it("只读：allowEdit 取反；只读态不自动保存", () => {
    expect(SRC).toMatch(/allowEdit=\{!readOnly\}/);
    expect(SRC).toMatch(/readOnlyRef\.current/);
  });

  it("内核级只读：patch 让全局锁定时单元格输入框也不可编辑", () => {
    // 上游 InputBox 的 edit 只看行/列级 rowReadOnly/colReadOnly、不看全局 context.allowEdit ⇒
    // 锁定时仍能往输入框敲字（提交被内核丢弃，但观感等同"还能编辑"）。补丁把全局锁定纳入判定。
    const patch = readFileSync(new URL("../../../patches/@fortune-sheet+react+1.0.4.patch", import.meta.url), "utf8");
    expect(patch).toContain("context.allowEdit === false ? false");
  });

  it("自动换行行高：编辑提交 / 批量写入（粘贴）/ 打开文档三条路都要触发（内核只在单格提交且列宽行高未被显式设置时才自适应）", () => {
    expect(SRC).toMatch(/afterUpdateCell[\s\S]{0,600}syncAutoRowHeights\(\[row\]\)/);
    expect(SRC).toMatch(/const handleOp[\s\S]{0,240}scheduleAutoRowHeights\(\)/);
    expect(SRC).toMatch(/syncAutoRowHeights\(rowsWithCells\(activeSheet/);
    // 粘贴进来的单元格没有 tb（内核批量写入不走我们的补默认路径）⇒ 缺省必须按自动换行处理
    expect(SRC).toMatch(/if \(cell\.tb != null && String\(cell\.tb\) !== "2"\) continue;/);
  });

  it("粘贴归属：内核单例 selectionCache 只能由「聚焦的那份 Workbook」消费（多标签下隐藏表格会抢走第一遍 Cmd+V）", () => {
    // core 的 selectionCache 是**模块级单例**，而每份挂载的 Workbook 都会在 document 上挂一个 paste 监听 ⇒
    // 内核原判据只看 document.activeElement 的**类名**，隐藏标签页里的表格也命中、把 isPasteAction 消费掉：
    // 活动表格这一遍拿不到剪贴板数据（行被撑开、内容为空），用户要按第二次 Cmd+V。补丁把判据限定在**本实例容器内**。
    const patch = readFileSync(new URL("../../../patches/@fortune-sheet+react+1.0.4.patch", import.meta.url), "utf8");
    expect(patch).toContain("contains(document.activeElement)");
    // 别再回到「在 core 里放宽判据」的老路：那会让所有挂载实例各自粘贴一遍。
    const corePatch = readFileSync(new URL("../../../patches/@fortune-sheet+core+1.0.4.patch", import.meta.url), "utf8");
    expect(corePatch).not.toContain("isPasteAction || e.clipboardData");
  });

  it("只读工具栏：只留视图类（批注查看/定位条件/查找），写操作项不渲染", () => {
    // 260930 用户：只读时不必全隐藏，留一部分不影响数据的；依据=内核 allowEdit 门禁。
    expect(SRC).toMatch(/const TOOLBAR_ITEMS_READONLY = \["comment", "locationCondition", "\|", "search"\];/);
    expect(SRC).toMatch(/toolbarItems=\{readOnly \? TOOLBAR_ITEMS_READONLY : TOOLBAR_ITEMS\}/);
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

  it("右键精简（261008）：排序/筛选 4 项与「插入链接」不进右键菜单；工具栏仍保留 filter/link", () => {
    const menu = SRC.match(/const CELL_CONTEXT_MENU = \[[\s\S]*?\];/)?.[0] ?? "";
    expect(menu).toContain('"cell-image"');
    // 261008 第二轮又点名去掉「隐藏/显示行列」（内核这两个 key 各渲染两行）
    for (const gone of ["sort", "orderAZ", "orderZA", "filter", "link", "hide-row", "hide-column"]) {
      expect(menu).not.toContain('"' + gone + '"');
    }
    // 本版内核单元格右键渲染器不认这几个名字（列了也不渲染）⇒ 不能留在清单里假装有功能
    for (const dead of ["delete-cell", "chart", "data", "cell-format", '"image"']) {
      expect(menu).not.toContain(dead);
    }
    // 精简的是**右键**：工具栏这两个入口必须还在（否则功能就真没了）
    expect(SRC).toMatch(/const TOOLBAR_ITEMS = \[[\s\S]*?"filter", "link", "cell-image"/);
  });

  it("工作表标签右键精简（261008）：去掉「向左移 / 向右移」，其余保持内核默认", () => {
    const menu = SRC.match(/const SHEET_TAB_CONTEXT_MENU = \[[\s\S]*?\];/)?.[0] ?? "";
    // 内核默认 = ["delete","copy","rename","color","hide","|","move"]：只砍 move（+ 末位分隔线）
    for (const keep of ["delete", "copy", "rename", "color", "hide"]) {
      expect(menu).toContain('"' + keep + '"');
    }
    expect(menu).not.toContain('"move"');
    expect(menu).not.toContain('"|"');
    expect(SRC).toContain("sheetTabContextMenu={SHEET_TAB_CONTEXT_MENU}");
  });

  it("单元格字体 = MiSans（内核 getFontSet 把多族串当**单族名**加引号 ⇒ 我们只给单族名）；旧值打开即归一化", () => {
    expect(SRC).toMatch(/const GLOBAL_FONT = "MiSans";/);
    expect(SRC).toMatch(/const LEGACY_GLOBAL_FONT =\s*'BlinkMacSystemFont, "Segoe UI"/);
    expect(SRC).toContain("next.ff === LEGACY_GLOBAL_FONT");
    // DOM 外壳的字体接线必须落在**未分层**的 sheetEditor.css（内核 CSS 未分层 ⇒ layer(feature) 压不过它）
    const CSS = readFileSync(new URL("./sheetEditor.css", import.meta.url), "utf8");
    expect(CSS).toMatch(/\.sheet-editor \.fortune-container,[\s\S]{0,200}font-family: var\(--lake-font-family\)/);
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
 * 颜色入口（261008）：工具栏「文字颜色 / 背景颜色」自绘 + 工作表标签「更改颜色」旁路内核 ChangeChange，
 * 三处统一走应用内公共选色盘（components/ColorPalette），图标用云端字形。
 */
/** 261008：云端对齐 —— 小数位增减（内核这版没有该能力，自建）+ 删除项文案带目标（补丁）。 */
describe("SheetEditor 云端对齐（261008）", () => {
  it("小数位 ± 自建：只动纯数字格式，其余（General/日期/文本）按口径处理", async () => {
    const { adjustDecimals } = await import("./SheetEditor.js");
    expect(adjustDecimals("0", 1)).toBe("0.0");
    expect(adjustDecimals("0.00", 1)).toBe("0.000");
    expect(adjustDecimals("0.00", -1)).toBe("0.0");
    expect(adjustDecimals("0", -1)).toBe("0");
    expect(adjustDecimals("#,##0.0", 1)).toBe("#,##0.00");
    expect(adjustDecimals("0.0%", 1)).toBe("0.00%");
    expect(adjustDecimals("General", 1)).toBe("0.0");
    expect(adjustDecimals("General", -1)).toBe("General");
    expect(adjustDecimals("yyyy-mm-dd", 1)).toBe("yyyy-mm-dd");
    expect(adjustDecimals("@", 1)).toBe("@");
  });

  it("工具栏两个按钮 + 右键删除文案带目标行/列（补丁）", () => {
    const toolbar = SRC.match(/const TOOLBAR_ITEMS = \[[\s\S]*?\];/)?.[0] ?? "";
    expect(toolbar).toContain('"lake-decimals-decrease", "lake-decimals-increase"');
    expect(SRC).toContain('key: "lake-decimals-decrease"');
    expect(SRC).toContain('key: "lake-decimals-increase"');
    expect(SRC).toContain('tooltip: "减少小数位"');
    expect(SRC).toContain('tooltip: "增加小数位"');
    expect(SRC).toContain("wb.setCellFormatByRange(\"ct\" as never, value, range as never)");
    // （删除项文案带目标曾做过，用户 261008 决定撤销 ⇒ 已还原内核原样，护栏一并去掉）
  });
});

describe("SheetEditor 颜色入口（261008）", () => {
  const ICONS = readFileSync(new URL("./sheetColorIcons.tsx", import.meta.url), "utf8");
  const CLOUD = JSON.parse(readFileSync(new URL("../../../scripts/sheet-icons.cloud.json", import.meta.url), "utf8")).icons;
  const RPATCH = readFileSync(new URL("../../../patches/@fortune-sheet+react+1.0.4.patch", import.meta.url), "utf8");

  it("工具栏不再用内核的颜色按钮（它会在云端字形上再叠一条硬编码色条），改用宿主自绘 key", () => {
    const toolbar = SRC.match(/const TOOLBAR_ITEMS = \[[\s\S]*?\];/)?.[0] ?? "";
    expect(toolbar).toContain('"lake-text-color", "lake-bg-color"');
    expect(toolbar).not.toContain('"font-color"');
    expect(toolbar).not.toContain('"background"');
    expect(SRC).toContain('key: "lake-text-color"');
    expect(SRC).toContain('key: "lake-bg-color"');
    expect(SRC).toContain('openColorPick("text", event.currentTarget)');
    expect(SRC).toContain('openColorPick("bg", event.currentTarget)');
  });

  it("上色走内核公开 API（一条历史），标签颜色走补丁加的 setSheetColor", () => {
    expect(SRC).toContain("wb.setCellFormatByRange(");
    expect(SRC).toContain("wb.setSheetColor?.(");
    expect(RPATCH).toContain("setSheetColor: function setSheetColor(");
    expect(RPATCH).toContain("settings.hooks.onSheetTabColor");
    expect(SRC).toContain("onSheetTabColor: (sheetId: string, anchor: HTMLElement | null)");
  });

  it("三处颜色入口共用公共选色盘，最近使用按入口分桶", () => {
    expect(SRC).toContain('from "../../components/ColorPalette.js"');
    expect(SRC).toContain("<ColorPalette");
    for (const bucket of ["sheet-text-color", "sheet-bg-color", "sheet-tab-color"]) {
      expect(SRC).toContain(bucket);
    }
    expect(SRC).toContain("refreshCellColors");
    expect(SRC).toContain('wb.getCellValue(focus.r, focus.c, { type } as never)');
  });

  it("颜色按钮 = 分体交互（261008，对齐 Lake）：点图标用上次颜色、点下拉三角开选色盘，且记忆跨会话", () => {
    // 三角：内核 sprite 的 combo-arrow + 独立命中区（stopPropagation 免得同时触发「用上次颜色」）
    expect(SRC).toContain("function ColorCaret(");
    expect(SRC).toContain('xlinkHref="#combo-arrow"');
    expect(SRC).toContain("event.stopPropagation(); onOpen(event.currentTarget.parentElement)");
    expect(SRC).toContain("children: <ColorCaret onOpen={(anchor) => openColorPick(\"text\", anchor)} />");
    expect(SRC).toContain("children: <ColorCaret onOpen={(anchor) => openColorPick(\"bg\", anchor)} />");
    // 点图标 = 上次颜色；没有记忆才退化成开选色盘
    expect(SRC).toContain('if (last) applyCellColor("text", last);');
    expect(SRC).toContain('if (last) applyCellColor("bg", last);');
    expect(SRC).toContain('else openColorPick("text", event.currentTarget);');
    // 记忆 = 该入口「最近使用」桶的第一条（不另存一份），初值也从桶里读
    expect(SRC).toContain("lastUsedColor(COLOR_BUCKET.text)");
    expect(SRC).toContain("lastUsedColor(COLOR_BUCKET.bg)");
    expect(SRC).toContain("const COLOR_BUCKET = { text: \"sheet-text-color\", bg: \"sheet-bg-color\", tab: \"sheet-tab-color\" }");
    const SHARED = readFileSync(new URL("../../components/ColorPalette.tsx", import.meta.url), "utf8");
    expect(SHARED).toContain("export function lastUsedColor(");
    // 色条：当前格颜色优先，其次才是上次用过的颜色
    expect(SRC).toContain("<SheetTextColorIcon color={cellColors.text ?? lastColors.text} />");
    expect(SRC).toContain("<SheetBgColorIcon color={cellColors.bg ?? lastColors.bg} />");
    // 坐标锚点：右键菜单项点完就卸载 ⇒ 必须**当场**量坐标（261008 用户报「选色盘跑到左上角」）
    expect(SRC).toContain("const rect = anchor.getBoundingClientRect();");
    expect(SRC).toContain("at: { x: rect.left, y: rect.bottom + 2 }");
    expect(SRC).toContain("at={colorPick.at}");
    expect(readFileSync(new URL("../../components/ColorPalette.tsx", import.meta.url), "utf8")).toContain("at?: { x: number; y: number } | null;");
  });

  it("颜色图标 = 云端字形（path d 与 cloud.json 一致），色条按传入颜色而不是云端写死的红", () => {
    const pathsOf = (name: string): string[] => {
      const out: string[] = [];
      const walk = (nodes: unknown[]) => {
        for (const node of nodes as Array<[string, Record<string, string>, unknown[]?]>) {
          if (node[0] === "path" && node[1].d) out.push(node[1].d);
          if (node[2]) walk(node[2]);
        }
      };
      walk(CLOUD[name].nodes);
      return out;
    };
    for (const [name, comp] of [["font-color", "SheetTextColorIcon"], ["background", "SheetBgColorIcon"]] as const) {
      expect(ICONS).toContain(comp);
      for (const d of pathsOf(name)) expect(ICONS).toContain(d.slice(0, 60));
    }
    // 云端那条色条写死 #F5222D；我们生成时把它换成按 color 上色（注释里提到该色值不算）
    expect(ICONS).toContain('fill={color ?? "none"}');
    expect(ICONS).not.toContain('"#F5222D"');
    // 云端约定 nodes[0] 是包装组（带 scale(0.09375)）：写成自闭合就会把 256 网格直接画进 24 viewBox ⇒ 图标看不见（261008 踩过）
    expect(ICONS).not.toContain('scale(0.09375)" />');
    expect(ICONS).toMatch(/transform="scale\(0\.09375\)">[\s\S]*?<path d="/);
  });
});

/**
 * 图片资产化（260920 P1，见 docs/STORAGE-LAYERS.md §4）。四条易回归的集成约束。
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
 * 单元格图片（260921 P2，见 docs/STORAGE-LAYERS.md）。
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

  it("滚轮：逐像素平滑滚动（不再 100px 阈值吸附整行导致卡顿）", () => {
    const CPATCH = readFileSync(new URL("../../../patches/@fortune-sheet+core+1.0.4.patch", import.meta.url), "utf8");
    expect(CPATCH).not.toContain("LAKE_WHEEL_ROW_THRESHOLD");
    expect(CPATCH).toContain("scrollbarY.scrollTop = scrollTop + e.deltaY;");
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

  it("底部「选区统计」行与文档状态栏融合成一条常驻底栏（260926 用户提议）", () => {
    // 统计行保持内核默认高度（常驻），只做「给状态栏让位」这一件事；
    // 不再是上一版那种「空态收起 / 有数据展开」+ 随之补发 resize 的算逻辑
    expect(CSS).toMatch(/\.sheet-editor \.fortune-stat-area \{\s*padding-right: var\(--lake-sheet-status-w, 0px\);\s*\}/);
    expect(CSS).not.toContain(".fortune-stat-area:has(");
    // 让位宽度必须实测（同步文案会变）+ 观察状态栏本身体积
    expect(SRC).toContain('host.style.setProperty("--lake-sheet-status-w"');
    expect(SRC).toContain('querySelector<HTMLElement>(".document-statusbar")');
    expect(SRC).toContain("observer.observe(statusBar);");
    // 状态栏那一侧（data-doc-kind + 各类型的落位）由 src/styles/uiPrimitives.test.ts 围栏
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
