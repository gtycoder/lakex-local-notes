/** 应用字体令牌（`--lake-font-family`，即 MiSans 栈）；表格一律用它，**禁止自定义字体**。 */
export function lakeFontFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--lake-font-family").trim();
  return value && !value.includes("var(") ? value : "MiSans, sans-serif";
}
