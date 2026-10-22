// Package-level ambient declarations.
export {};

// CSS side-effect imports (asset styles, framework styles) are resolved by the
// bundler at build time and need an ambient module declaration for tsc.
// The wildcard covers `*.css`; the explicit subpath is a belt-and-suspenders
// guard so editors that don't load `vite/client` still resolve
// `@xiangfa/mindmap/style.css` (avoids TS2882 on side-effect imports).
declare module '*.css';
declare module '@xiangfa/mindmap/style.css';

declare global {
  interface Window {
    // The lakex-doc framework root object, when loaded globally.
    Doc?: any;
  }
}
