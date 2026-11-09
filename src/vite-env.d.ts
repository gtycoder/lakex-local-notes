declare module "*.css" {
  const css: string;
  export default css;
}

/** Vite ?raw 导入（移动端与桌面更新中心都渲染 docs/RELEASE-NOTES.md 原文；不引 markdown 依赖）。 */
declare module "*?raw" {
  const content: string;
  export default content;
}

/** Vite 注入的环境变量（只声明用到的；刻意不引 vite/client —— 项目其余部分没用到，避免全局类型面变化）。
 *  注意：必须是字面量写法 `import.meta.env.DEV`，Vite 才能在产物里静态替换、从而 tree-shake 掉 dev-only 分支。 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
