# 手写板 POC（kind=ink）

> 分支：`feat/ink-pad-poc`。目标：用**通用 Web 技术**验证桌面与 Android 共用的手写板，不接 Jetpack Ink / PencilKit。

## 技术路线

- 墨迹轮廓：`perfect-freehand@1.2.3`（MIT）。
- 输入：Pointer Events；触控笔有压力时用真实压力，鼠标/手指用速度模拟压力。
- 存储：矢量点 JSON，正文落 `inks/{noteId}.ink.json`；PNG 不作为正文。
- 页面：A4 固定尺寸（794 × 1123），多页数据结构；POC 默认单页，可新增/切换/删除页。
- 工具：画笔、高亮笔、整笔橡皮、撤销/重做、纸张背景（空白/横线/网格/点阵）。
- 跨端：桌面 Electron 与 Android Capacitor 共用 `InkPad` 控制器与数据模型；两端各自持有样式层。
- iPad：当前无 iOS 端；实现保持纯 Web + Pointer Events，后续可直接运行在 WKWebView。

## 数据契约

```json
{
  "kind": "ink",
  "version": 1,
  "pages": [
    {
      "id": "page-1",
      "width": 794,
      "height": 1123,
      "background": "blank",
      "strokes": [
        {
          "id": "stroke-...",
          "tool": "pen",
          "color": "#262626",
          "width": 2.5,
          "points": [{ "x": 100, "y": 120, "pressure": 0.72, "t": 13 }]
        }
      ]
    }
  ],
  "activePageId": "page-1"
}
```

- `InkDoc` 严格解析；坏正文返回 `null`，编辑器只读保护，不得用空文档覆盖。
- 手写正文当前不进入全文搜索（OCR 未接入）；标题仍按 `notes.title` 搜索。
- 历史快照按结构化摘要展示页面/笔迹/采样点数量。

## S3 / 同步

- `NoteKind` 新增 `"ink"`。
- `MANIFEST_VERSION` 升到 **2**；V1 仍可读取用于已有云端清单升级。
- 正文仍走内容寻址对象与现有 Manifest V1 schema；`kind` 随 manifest note 透传。
- 旧端不得继续写同一空间；所有端需一起升级后才能识别 `ink`。

## 当前 POC 已实现

- 桌面：新建手写板、打开、编辑、自动保存、历史/回收站/搜索索引类型分派。
- Android：新建手写板、打开编辑、自动保存；复用 Web InkPad。
- 桌面 IPC：`create_ink_in`（register / preload / Web API 三方一致性）。
- 移动 bridge：`createInk`。
- 单测：正文往返/坏数据拒绝、几何路径、整笔橡皮、路由与 IPC 接线。
- 运行级验证（隔离 Electron，CDP）：
  - `createInkIn` 返回 `kind="ink"`，正文落盘并可读回；
  - InkPad 挂载，画笔拖动新增 1 条 11 点笔迹；
  - 撤销后 DOM/正文为 0 条，重做后恢复 1 条。

## 已跑门禁

- `npx tsc --noEmit`：0 错误。
- `npx vitest run`：301 文件通过 / 5 skip，2216 例通过 / 16 skip。
- `npx vite build`：桌面构建通过。
- `npx vite build -c vite.mobile.config.ts`：移动构建通过。
- `node scripts/ui-metrics.mjs`、`check:core`、`check:mobileui`、`check:bundle`：通过。
- `git diff --check`：通过。

## 未做 / 后续

- 真机 Android 手写笔验收（压力、掌托、延迟）——POC 目前只验证了 Web 指针与桌面鼠标路径。
- 真实 S3 上传/下载 roundtrip（需要隔离测试桶与凭证；本次未触碰正式 S3）。
- OCR / 手写转文字、套索选择、局部像素橡皮、导出 PNG/PDF。
- 压感曲线校准与 120Hz 设备性能专项。
- iPad 仅保留 Web 兼容性，尚未创建 iOS 工程，也未接 PencilKit。
