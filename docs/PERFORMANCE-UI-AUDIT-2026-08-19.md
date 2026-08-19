# Lake Notes UI 性能与生命周期审计

日期：2026-08-19
分支：`feat/lake-notes-ui-system`
运行窗口：Electron 43.4.0，macOS，1280×820 CSS px，DPR 2

## 当前实测

| 指标 | 结果 |
|---|---:|
| DOM 节点 | 2,098（最终健康检查） |
| Lake toolbar buttons | 27 |
| JS heap used | 约 74 MiB（CDP Performance） |
| JS heap total | 约 75 MiB |
| KaTeX 脚本 | 2 个（katex + mhchem，各 1） |
| Console exception / error | 0 |
| CSP violation | 0 |
| 初次编辑器 init | 约 50ms + StrictMode 二次约 9ms |

之前 master 基线在相同窗口约 3,603 DOM 节点；本分支最终健康检查为 2,098，差异受当前种子数据、面板状态和重载时机影响，不能单独作为性能结论，但没有发现节点随一次普通重载持续累积的证据。

## 已验证

- 搜索、同步状态和 shell token 不会修改 Lake 原生 toolbar DOM。
- 深色模式只接线壳层和文档正文颜色，不重排或隐藏 Lake toolbar。
- Focus Mode 使用 CSS grid 收起 rail/sidebar/outline/statusbar，编辑区保持存在。
- 现有标签生命周期没有贸然加入后台卸载；这避免了在缺少完整恢复测试前引入编辑器数据丢失风险。
- 窗口状态写入采用临时文件后 rename，不阻塞退出。

## 当前性能风险

### P2：主 bundle 仍然很大

`vite build` 报告：

- `index` JS 约 9.63 MB
- Drawnix chunk 约 4.16 MB
- KaTeX chunk 约 259 KB
- CSS 约 1.46 MB
- Vite 提示存在超过 500 KB 的 chunk

后续可选优化：把 Drawnix / 高级 Lake 卡片能力按编辑器首次需要动态加载。但这必须在 Lake 资源/思维导图/画板行为矩阵验证后执行，不在本轮为了指标贸然拆分。

### P2：Vite 构建已有历史资源警告

- CodeMirror 非 module script 无法被 Vite bundle，运行时保留。
- JetBrainsMono 字体路径在构建时无法解析，运行时保留。

它们不是本轮引入，但应在后续性能/发布整理中处理并加入生产资源冒烟测试。

## 暂不做的优化

- 不增加最近编辑视图。
- 不给新文档自动改标题。
- 不修改 Lake 原生 toolbar。
- 不在未完成编辑器恢复矩阵前强制卸载后台标签。

## 后续建议

1. 用真实含公式、思维导图、多图片文档做 Performance trace。
2. 比较“打开 1 个标签 / 8 个标签 / 24 个标签”的 heap 和 init 时间。
3. 若 Drawnix 在普通文档打开路径没有必要，考虑拆成用户首次使用画板时再加载。
4. 为 CodeMirror 和字体建立本地 vendor 资源健康检查。
