import type { PlaitElement } from "@plait/core";
export type MaterialCategory = "hot" | "teamwork" | "product" | "technology" | "thinking";
export interface MaterialTemplate {
    id: string;
    categories: MaterialCategory[];
    zh: string;
    en: string;
    /** Metadata mirrored from the selected Yuque material records. */
    sourceId?: number;
    docletId?: number;
    descriptionZh?: string;
    descriptionEn?: string;
    usageCount?: number;
    cover?: string;
    build: (locale: "zh-CN" | "en-US") => PlaitElement[];
}
export declare const materialTemplates: MaterialTemplate[];
