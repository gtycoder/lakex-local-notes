import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Library build for `@dlient/lakex-doc-react`.
// Only `react` / `react-dom` are externalized so the consumer's single React
// instance is reused (the lakex framework is built against React 18 and must
// NOT be paired with a second React copy).
//
// `@xiangfa/mindmap` is intentionally NOT externalized: its package.json lists
// `react: ^19` in `dependencies` (in addition to `peerDependencies`), which
// causes npm to nest-install react@19 under @xiangfa/mindmap on the consumer
// side. That second React instance triggers "Invalid hook call". Bundling
// mindmap into our output makes its `import … from "react"` resolve to the
// externalized (consumer-provided) React, guaranteeing a single instance.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // lakex-drawnix@0.1.0 keeps the upstream import specifiers in its
    // published bundle. Resolve those specifiers to the Lakex-maintained
    // packages while bundling, without exposing the old packages to users.
    alias: {
      '@plait-board/react-board': 'lakex-drawnix-react-board',
      '@plait-board/react-text': 'lakex-drawnix-react-text',
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format: string) => `index.${format}.js`,
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        // 重型卡片依赖外部化（由宿主应用打包）：
        // 1) @plait-board/mermaid-to-drawnix 内嵌的 mermaid 预构建文件被 rolldown 重打印后
        //    自身无法再解析（emit→parse bug），必须外置；
        // 2) 体积与应用侧已有的 drawnix 分包策略一致。
        // 例外：@xiangfa/mindmap 必须打进包（其 node_modules 里嵌套了 react@19，外置会双 React）。
        'mermaid',
        '@viz-js/viz',
        'flowchart.ts',
        // 必须用正则：精确字符串匹配不到子路径（@plantuml/core/plantuml.js 约 7MB、
        // viz-global.js 约 1.4MB），会被内联进宿主主 chunk 导致超预算。
        /^@plantuml\/core(\/|$)/,
        'roughjs',
        'classnames',
        'slate',
        'slate-dom',
        'slate-react',
        'slate-history',
        'lakex-drawnix',
        'lakex-drawnix-react-board',
        'lakex-drawnix-react-text',
        /^@plait\//,
        /^@plait-board\//,
      ],
      output: {
        assetFileNames: 'style.css',
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'ReactDOMClient',
        },
        // inlineDynamicImports 必须关闭：画板卡懒加载 DrawnixBoardCore 需要产出独立 chunk，
        // 否则动态 import 被内联回主 bundle，宿主仍会首屏加载整个白板引擎。
      },
    },
    // The framework bundle (lakex.js) is ~9.7 MB; lift the warning threshold.
    chunkSizeWarningLimit: 12000,
  },
});
