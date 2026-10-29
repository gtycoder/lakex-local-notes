# MOBILE-SHEET-EXCEPTIONS.md — MOB-11：未迁 `ui/MobileSheet` 的浮层例外

> 判定口径（261028/29 收口）：**只有结构等价才迁**到 `src/mobile/ui/MobileSheet.tsx`（scrim / 右滑关闭 /
> 返回栈 / 焦点收放 / 页面滚动锁只此一份）；**语义或头部结构不同的一律不迁**，逐条登记在这里。
> **不要为了「统一」改交互或给原语加视觉开关**（AGENTS §3#14/#17、`MobileSheet.tsx` 文件头边界）。
> 护栏：`src/mobile/mobileBackOverlays.test.ts` 的「MOB-11 例外」用例（每个例外面板必须自带 `pushBackHandler`）。
> 未来某处结构真的对齐后可迁移 ⇒ **同步删本清单条目并改护栏测试**；改 DOM/视觉前必须过 `check:mobilesnap`。

## 已迁移（11 处，对照）

NoteInfoSheet · MobileQuickNoteTagSheet · CreateNotebookSheet · SearchSheet · 工作区图标面板 · 工作区历史面板 ·
DocListSheet · OutlineSheet（底部形态；右侧抽屉变体不套原语）· 多维表字段面板 · 多维表记录面板 · 首页笔记本图标面板。

## 例外清单（6 组 / 8 个文件）

| # | 文件 | 表面类名 | 为什么不是「结构等价」 | 返回栈 |
|---|---|---|---|---|
| 1 | `src/mobile/ai/AiCorpusSheet.tsx` | `.mb-sheet.ai-sheet` | 头部右侧是**文字动作按钮**（「取消」，`mb-btn--ghost--sm`）而不是 ×；无 `.mb-sheet__grab`；搜索条 + `.ai-sheet__foot` 是 `.mb-sheet__body` 的兄弟节点（固定底栏）。`MobileSheet` 固定渲染 grab + 标题 + ×，并只有一个 body/footer 槽 ⇒ 迁移会改头部与 DOM | 自带 |
| 2 | `src/mobile/ai/AiImageSheet.tsx` | `.mb-sheet.ai-sheet` | 同 1（头部「取消」+ 底部预算/添加 foot） | 自带 |
| 3 | `src/mobile/ai/AiSendSheet.tsx` | `.mb-sheet.ai-sheet` | 同 1（头部「完成」+ 说明段 + foot） | 自带 |
| 4 | `src/mobile/ai/MobileAiPage.tsx` | `.mb-actionsheet` | 「附件」菜单 = **ActionSheet 语义**（图标项组 + 取消按钮），不是底部 Sheet；属 `floating.css` 的 ActionSheet 原语 | 自带（本批补：打开时先关面板，不再直接退出 AI 页） |
| 5 | `src/mobile/ui/ConfirmDialog.tsx` | `.mb-actionsheet` `role="alertdialog"` | **alert 语义**：确认 + 取消两组、破坏性操作走 `--danger`（用户 261012 定稿 C1：移动端没有居中对话框，破坏性确认走 ActionSheet） | 自带 |
| 6 | `src/mobile/ui/CreateSheet.tsx` | `.mb-sheet--create` | **无头**底部面板：没有 `.mb-sheet__head` / `.mb-sheet__grab` / ×，`section` 直接挂在 `.mb-sheet` 下（没有 `.mb-sheet__body` 包裹），关闭只靠遮罩/右滑/返回 | 自带 |
| 7 | `src/mobile/ui/PickerSheet.tsx` | `.mb-sheet--picker` | 头部**只有标题、没有 ×**；`.mb-sheet__body` 需要 `role="listbox"` + `role="option"/aria-selected`；触发器与面板同组件。套原语需给 `MobileSheet` 加「头部开关 + body role」两个视觉/结构旋钮（只为 1 个消费者，违反 §3#17） | 自带 |
| 8 | `src/mobile/ui/MobileSheetMenu.tsx` | `.mb-menusheet` | **可下钻菜单**原语（子菜单整屏平移、返回先退子层）；`MobileSheet.tsx` 文件头已写明「可下钻菜单走 MobileSheetMenu，不要套本原语」 | 自带 |

## 备注

- 本批（261029）只补了一处**行为**缺口：`MobileAiPage` 的附件 ActionSheet 此前没有自己的返回处理器，返回键会直接退出 AI 页；现与其它浮层一致（先关面板）。无视觉/DOM 变化，因此**未跑** `check:mobilesnap`（模拟器门禁由 Lead 用专用 AVD 跑）。
- 例外本身没有新增第二套视觉：8 个文件全部沿用 `floating.css` 的既有四类表面（Sheet / ActionSheet / 菜单 Sheet），只是没有共用 `MobileSheet` 的骨架。
