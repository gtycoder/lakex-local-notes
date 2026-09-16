// 所有 CSS 审计脚本共用的两个位置常量。脚本本身进版本库，数据不进（默认写进 .css-audit/）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根（带结尾斜杠，历史脚本里按字符串拼接用） */
export const REPO = path.resolve(HERE, "../..") + "/";

/** 审计数据目录：默认 <仓库根>/.css-audit/，可用 LK_CSS_AUDIT_DIR 覆盖（/tmp 会被清空，别默认放那） */
export const DATA = process.env.LK_CSS_AUDIT_DIR || REPO + ".css-audit/";

/** 拼数据文件路径 */
export const data = (name) => path.join(DATA, name);

fs.mkdirSync(DATA, { recursive: true });
