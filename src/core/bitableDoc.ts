/**
 * 多维表文档（kind = "bitable"）正文格式、序列化与视图求值 —— 桌面/移动端共享的单一事实源。
 *
 * 存储位置：bitables/{noteId}.bitable.json（本地）/ objects/{noteId}-{hash}.lake（S3，内容寻址）。
 * 正文是纯文本 JSON，天然复用「正文对象 + manifest.contentHash」的整条同步/GC/历史/回收站管线。
 *
 * 产品口径见 docs/STORAGE-LAYERS.md（v1）：
 * - 一个文档可含多张数据表（tables[]）——为后期「多数据表联合」预留（这是产品的硬要求）；
 * - 三层归属：文档 ⊃ 数据表 ⊃（字段 / 记录 / 视图）；视图只是配置投影，不存数据；
 * - v1 字段 7 种：文本(主字段) / 数字 / 单选 / 多选 / 日期 / 图片和附件 / 关联(占位)；
 * - 字段类型用**开放字符串**（未知类型只读展示、不清空），以后加类型不需要 bump 格式版本；
 * - 值按 fieldId 存（不按列序）；附件字段存 filename，直接复用 assets/{noteId}/{filename} 资产管线。
 *
 * 边界：本文件属 src/core（禁平台/第三方依赖），故不 import 任何 UI/Electron 模块；只依赖同层 core。
 *
 * **261112 R1-S1（纯搬移；拆分首批）**：实现按域拆到 ./bitable/{types,values,filter,fill,sortGroup,views,relations,ai,body}.ts，
 * 本文件退化为**门面**（只 re-export、不含实现）。导出符号与行为零变化，护栏 = `bitableDoc.test.ts` 的「导出符号表」两例
 * （138 个值导出运行时比对 + 34 个类型导出读门面文本比对）。条件求值仍只有一份：./bitable/filter.ts 的
 * `evaluateFilterNode` / `filterOperatorsFor`（AGENTS §3#19）；字段取值仍只有一份：./bitable/values.ts 的 `bitableFieldValue`。
 */

export type { BitableFieldType, BitableFieldOption, BitableRelation, BitableRelationFieldType, BitableAiConfig, BitableField, BitableRecord, BitableViewType, BitableFilterJoin, BitableFilterOperator, BitableDateFilterMode, BitableFilterValue, BitableFilterRule, BitableFilterGroup, BitableFilterNode, BitableFillMode, BitableFillRule, BitableSortRule, BitableSortMode, BitableGroupRule, BitableRowHeight, BitableView, BitableTable, BitableDoc, BitableStatType, BitableAttachment, BitableDisplayContext, BitableAiMessagesResult, BuildAiFieldOptions, BitableKanbanColumn, BitableCalendarEvent, BitableFilterValueKind, BitableFillMatch, BitableFillProjection } from "./bitable/types.js";
export { BITABLE_DOC_KIND, BITABLE_DOC_VERSION, BITABLE_FIELD_TYPES, BITABLE_FIELD_TYPE_LABEL, BITABLE_RELATION_DEFAULT, isRelationFieldType, isAiFieldType, BITABLE_DATE_FORMAT_OPTIONS, BITABLE_NUMBER_FORMAT_OPTIONS, BITABLE_VIEW_TYPES, BITABLE_VIEW_TYPE_LABEL, BITABLE_IMPLEMENTED_VIEW_TYPES, BITABLE_FILTER_MAX_GROUP_DEPTH, BITABLE_FILL_MODE_LABEL, BITABLE_FILL_MAX_RULES, BITABLE_FILL_NO_COLOR, BITABLE_SORT_MODE_LABEL, BITABLE_ROW_HEIGHT_OPTIONS, newBitableId, BITABLE_RATING_MAX, BITABLE_PROGRESS_MAX, BITABLE_OPTION_PALETTE, BITABLE_OPTION_COLORS, BITABLE_DEFAULT_OPTION_COLOR } from "./bitable/types.js";
export { isBitableFilterGroup, bitableFilterRuleCount, filterValueKindFor, filterOperatorsFor, BITABLE_FILTER_OPERATOR_LABEL, filterOperatorLabel, BITABLE_DATE_FILTER_MODE_LABEL, dateFilterModesFor, defaultFilterValueFor, createBitableFilterRule, createBitableFilterGroup, dateFilterRangeFor, bitableViewNeedsClock, evaluateFilter, evaluateFilterGroup, evaluateFilterNode, isBitableFilterRuleConfigured } from "./bitable/filter.js";
export { buildBitableFillProjection, bitableFillBackgroundTokens, stripFillRulesForField, createBitableFillRule } from "./bitable/fill.js";
export { formatBitableNumber, formatBitableDate, fieldSupportsFormat, isNumericFieldType, isSystemTimeField, isKnownFieldType, optionColorHex, optionChipStyle, BITABLE_STAT_LABEL, statDisplayText, statsForField, statForField, localMonthDiff, computeColumnStat, bitableAttachments, removeBitableAttachment, reorderBitableAttachments, renameBitableAttachment, ATTACHMENT_GRID, attachmentGridColumns, relationRecordIds, relationTargetTable, relationTargetRecords, relationTargetView, bitableDisplayValue, bitableRawDisplayValue, defaultRecordValues, localDateString, localDateTimeString, bitableFieldValue, bitableFieldText, bitableRecordTitle, localDateDiff, orderedTableFields, orderedAllTableFields } from "./bitable/values.js";
export { sortModesForField, sortModeLabel, sortModeOf, applySortMode, changeSortField, bitableRowHeightPx, applyViewToRecords, groupRecords, duplicateValues } from "./bitable/sortGroup.js";
export { isImplementedViewType, isKnownViewType, viewTypeLabel, defaultViewName, bitableSelectFields, kanbanGroupField, kanbanCardFieldCandidates, kanbanCardFields, kanbanColumns, isAttachmentLikeField, bitableAttachmentFields, galleryCoverField, galleryCardFieldCandidates, galleryCardFields, galleryCoverImage, bitableDateFields, calendarStartField, calendarEndField, calendarTitleField, calendarColorField, calendarEvents, calendarMonthDays, shiftLocalDate, calendarEventsByDay, calendarMovePatch } from "./bitable/views.js";
export { toggleRelationDraft, defaultGridView, relationPickerFields, relationCandidateRecords, relationReverseFieldName, createRelationPair, unpairRelationFields, applyRelationMirror } from "./bitable/relations.js";
export { BITABLE_AI_SYSTEM_PROMPT, BITABLE_AI_MAX_CHARS, aiPromptFieldNames, AI_FIELD_MAX_IMAGES, AI_FIELD_MAX_DOCUMENTS, buildAiFieldMessages } from "./bitable/ai.js";
export { createBitableFieldOptions, createBitableField, createBitableView, createBitableRecord, createDefaultBitableTable, emptyBitableBody, canonicalBitableNav, bitablesToBody, parseBitableBody, bitableToSearchText } from "./bitable/body.js";
