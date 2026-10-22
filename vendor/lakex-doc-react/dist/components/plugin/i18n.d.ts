export type ToolbarLang = "zh-cn" | "en-us";
export type Translator = (key: string) => string;
/**
 * 生成翻译函数。找不到 key 时回退到 key 本身（方便排查缺失文案）。
 */
export declare function makeT(language: ToolbarLang): Translator;
