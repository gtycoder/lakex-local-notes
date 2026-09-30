# ae1cfda 非多维表审计证据

本目录是讨论稿的附件，不是产品代码或正式测试。

- reproduce.mjs：读取当前源码，在隔离 fixture 中重现12个原行为；R13只核对静态防抖配置。
- reproduction-results.json：2026-09-30基线结果；没有真实凭据或用户正文。
- baseline-tests-summary.txt：默认测试摘要。
- workspace-benchmark.log：opt-in旧断言失败的完整输出。

脚本使用仓库已安装的TypeScript/better-sqlite3，不安装依赖；不连接云端、不启动应用、不清正式数据。
生成临时目录并保留，输出路径打印在末尾。断言描述的是原缺陷，不应拿来当“修复后必须全通过”的验收。
