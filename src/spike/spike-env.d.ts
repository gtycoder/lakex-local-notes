/** Vite worker 入口的 URL 形态（spike 专用；项目其余部分不用 ?worker&url）。 */
declare module "*?worker&url" {
  const url: string;
  export default url;
}
