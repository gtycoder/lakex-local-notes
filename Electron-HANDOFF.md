# Lake Notes Electron 交接文档（入口 / 目录）

> **给零上下文的新会话：先读本文（目录），再读 `docs/CODEX-GUIDE.md`（如何用
> Codex 自主驱动真实应用实测——本项目的正确姿势），然后读 `docs/PROGRESS.md` 的
> ★最新交接。**
> 本文是交接文档入口（原单文件已按类型拆分为 README + docs/*）；修改代码前请先
> 读完相关文档。

---

## 文档目录

| 文档 | 内容 | 优先级 |
|---|---|---|
| **docs/CODEX-GUIDE.md** | **Codex 自主开发指南**：Playwright 驱动真实 Electron（含启动模板）/ Computer Use / 应用内浏览器；推荐会话工作流；环境速查 | **动手前必读** |
| **docs/PROGRESS.md** | ★最新交接（最近会话全记录）、**经验总结（方法论/深层认识/工程实践）**、已完成（阶段 A/B/C/虚拟渲染）、当前问题、下一步计划 | **先读** |
| README.md | 项目概览/核心理念/技术栈/状态总览/仓库与分支/参考仓库/文档索引 | 了解项目 |
| docs/DEVELOPMENT.md | 环境要求/开发/构建打包/测试（双 ABI）/依赖版本/提交历史 | 动手前读 |
| docs/ARCHITECTURE.md | 进程结构/关键文件索引/图片数据流/数据与存储/S3 同步机制 | 改代码前读 |
| docs/TROUBLESHOOTING.md | 踩过的坑 A-G（打包/CDN/剪贴板/编辑器与 CSS/环境/S3/虚拟渲染调试） | 遇坑查 |
| VIRTUAL-RENDERING-TEST.md | 虚拟渲染回归清单（逐项手测） | 动虚拟渲染相关代码前后跑 |

## 新会话推荐路径

1. 读本文（目录）
2. 读 **docs/CODEX-GUIDE.md**——学会用 Playwright 驱动真实 Electron 实测（本次全链路修复的姿势）
3. 读 **docs/PROGRESS.md ★最新交接**——最近会话做了什么、还剩什么、有哪些坑
4. 动手前：docs/DEVELOPMENT.md（环境/命令）、docs/ARCHITECTURE.md（改到哪查哪）
5. 遇坑：docs/TROUBLESHOOTING.md

## 快速状态（2026-08-02）

- **主开发分支：`master`**（Gitee 已同步，默认分支已切换为 master）
- 功能：资源归一化、S3 同步、dmg 打包、虚拟渲染（首图 3.5s→88ms）、TOC 三问题、
  代码块粘贴、表格工具栏、长大纲跟随全部已修复
- 测试：**82 个 vitest 用例全绿**（Store DB 22 / S3 校验 4 / ssrf / sync 引擎 / clipboardHtml）
- 剩余：发布完善（图标/签名/公证）、移动端路径回归、安卓端同步、userData 隔离决策
