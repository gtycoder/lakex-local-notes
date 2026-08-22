/** Vite `?url` 导入类型（wasm 资源 URL；项目 vite-env 未引入 vite/client，本地声明） */
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
