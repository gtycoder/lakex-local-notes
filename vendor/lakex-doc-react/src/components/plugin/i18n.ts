// src/components/plugin/i18n.ts
//
// 图片 / 书签浮动工具栏的中英文文案。
// 使用方式：const t = makeT(language); t('image.crop.tip') -> 中文或英文。
// 字典的 key 与中文文案一一对应（中文即原有硬编码文本），英文为翻译等价物。

export type ToolbarLang = "zh-cn" | "en-us";

export type Translator = (key: string) => string;

const ZH_CN: Record<string, string> = {
  // ─── 图片工具栏 ───
  "image.rotation.tip": "逆时针旋转90度",
  "image.crop.tip": "剪切",
  "image.size.title": "宽高",
  "image.size.tip": "图片尺寸",
  "image.link.tip": "链接",
  "image.desc.title": "描述",
  "image.desc.tip": "图片描述",
  "image.style.title": "样式",
  "image.style.tip": "图片样式",
  "image.style.none": "无样式",
  "image.style.stroke": "图片描边",
  "image.style.shadow": "图片阴影",
  "image.link.placeholder": "请输入网址",
  "image.link.newWindow": "新窗口打开",
  "image.size.width": "宽",
  "image.size.height": "高",
  // ─── 书签工具栏 ───
  "bookmark.toLink": "转为链接",
  "bookmark.title": "标题",
  "bookmark.card": "卡片",
  "bookmark.openLink": "打开链接",
  "bookmark.edit": "编辑链接",
  "bookmark.title.placeholder": "请输入标题",
  // ─── 通用 ───
  "common.ok": "确定",
};

const EN_US: Record<string, string> = {
  "image.rotation.tip": "Rotate 90° CCW",
  "image.crop.tip": "Crop",
  "image.size.title": "Size",
  "image.size.tip": "Image size",
  "image.link.tip": "Link",
  "image.desc.title": "Caption",
  "image.desc.tip": "Image description",
  "image.style.title": "Style",
  "image.style.tip": "Image style",
  "image.style.none": "None",
  "image.style.stroke": "Border",
  "image.style.shadow": "Shadow",
  "image.link.placeholder": "Enter URL",
  "image.link.newWindow": "Open in new window",
  "image.size.width": "W",
  "image.size.height": "H",
  "bookmark.toLink": "Convert to link",
  "bookmark.title": "Title",
  "bookmark.card": "Card",
  "bookmark.openLink": "Open link",
  "bookmark.edit": "Edit link",
  "bookmark.title.placeholder": "Enter title",
  "common.ok": "OK",
};

const DICTS: Record<ToolbarLang, Record<string, string>> = {
  "zh-cn": ZH_CN,
  "en-us": EN_US,
};

/**
 * 生成翻译函数。找不到 key 时回退到 key 本身（方便排查缺失文案）。
 */
export function makeT(language: ToolbarLang): Translator {
  const dict = DICTS[language] || ZH_CN;
  return (key: string) => dict[key] ?? key;
}
