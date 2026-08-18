# Store 内容写入拆分影响评估

- 评估日期：2026-08-17
- 目标批次：Batch 4D-3B
- 当前状态：未实施，等待确认
- 当前基线：227 tests，tsc/build 全绿

## 为什么这是高风险批次

Batch 3B、4A、4B、4C、4D-1、4D-2、4D-3A 都主要移动了纯函数或查询/元数据边界；Batch 4D-3B 将触及正文和资源写入，是 Store 中最后一个明显的高耦合区域。

涉及的真实流程：

1. Lake 正文 `.lake` 文件落盘
2. 图片资源写入或下载
3. SQLite `notes` / `tree_nodes` 元数据更新
4. markdown/plain cache 更新
5. FTS 索引更新
6. orphan 资源登记/撤销
7. 历史快照 dirty 标记
8. 远程导入时的 hash 校验、临时目录和原子落位
9. 同步字段更新和后续 manifest 上传

这些步骤不是简单的 CRUD，文件系统和 SQLite 之间没有共同事务；拆分错误会制造“文件成功但 DB 失败”或“DB 成功但文件缺失”的中间状态。

## 候选拆法

### 方案 A：只抽内容协调器（推荐）

新增 `NoteContentRepository`，只接收显式依赖：

- `db`
- workspace root / note path resolver
- cache builder
- FTS updater
- orphan registrar
- history snapshot callback
- path/hash/image validators

Store 保留：

- 所有业务状态判断
- 事务和文件落盘顺序的最终控制
- 对外兼容 wrapper

优点：

- 变化集中
- 事务边界容易对照旧实现
- 可以逐个方法迁移
- 便于移动端复用内容服务

缺点：

- 初期依赖参数较多
- 如果不继续整理，可能只是把“大方法”搬到另一个大文件

### 方案 B：按文件/缓存/资源拆成三个 Repository

- `NoteFileRepository`
- `NoteCacheRepository`
- `NoteAssetWriter`

优点：职责更细。

风险：中高。正文、缓存和资源当前在保存/导入流程中强耦合，过早拆分容易改变时序和异常清理。

### 方案 C：一次性重写 save/import 流程

不推荐。容易同时改变：

- 原子落盘顺序
- orphan 语义
- 历史快照时机
- 远程导入回滚
- 同步 pending 状态

## 推荐分批实施

### Batch 4D-3B-1：保存正文协调器

只迁移 `saveNote` 的协调逻辑，保持以下顺序完全不变：

1. 校验 note id / 正文文件
2. purged 隐式恢复
3. 写 `.lake`
4. SQLite 事务更新标题、时间、cache、sync state
5. FTS 更新
6. orphan 对账
7. history dirty 标记

验收重点：

- 普通编辑保存
- 带 markdown/plain cache 保存
- 无 cache 保存
- 锁定文档保存拦截
- purged 编辑隐式恢复
- 图片引用增加/减少
- 保存失败后的临时文件清理

### Batch 4D-3B-2：资源上传/下载协调器

只迁移 `uploadResource` 和 `downloadRemoteResource` 的文件输出协调，不改变：

- SSRF 校验
- 重定向上限
- 25 MiB 上限
- 50MP 像素上限
- image magic 校验
- orphan 登记

验收重点：

- PNG/JPEG/WebP/AVIF
- 超大文件
- 像素炸弹
- 非法 URL
- 私网/回环地址
- 重定向
- 下载失败
- 写盘失败

### Batch 4D-3B-3：远程导入（已完成）

已迁移 `importRemoteNote` 协调逻辑，原因是它包含：

- 远程 content hash 验证
- 远程 asset hash/size 验证
- staging 目录
- 原子 rename
- DB transaction
- orphan/cache 补齐
- 冲突和 deleted 状态

这是风险最高的一步，应单独分支、单独测试、单独运行多端同步场景。

## 风险与收益

| 项目 | 评估 |
| --- | --- |
| 可维护性收益 | 高 |
| 移动端复用收益 | 高 |
| 直接性能收益 | 低 |
| 保存流程风险 | 中高 |
| 远程导入风险 | 高 |
| 数据损坏风险 | 需要重点防护 |
| 是否需要独立分支 | 是，建议 |
| 是否需要用户确认 | 是 |

## 必须保持的不可变约束

- 不改变本地是真相、S3 是镜像
- 不改变先同步者胜和墓碑权威
- 不改变删除/恢复/purge 语义
- 不改变 `.lake` 与 SQLite 的现有落盘顺序
- 不改变历史快照创建时机
- 不改变 orphan 资源的登记/撤销规则
- 不改变 IPC channel、参数和返回值

## 结论与建议

已按 **方案 A + 4D-3B-1 → 4D-3B-2 → 4D-3B-3** 顺序完成。三批均保留 Store 公开 wrapper，并通过 227+ 测试、存储/同步定向回归、tsc、build 和 diff 检查。

后续不再继续拆分内容写入，除非出现明确的移动端复用需求或维护痛点；下一阶段应优先把稳定的存储/IPC 契约供移动端使用。
