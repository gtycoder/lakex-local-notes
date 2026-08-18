# 面向移动端复用的存储/功能拆分评估

- 评估日期：2026-08-18
- 当前分支：`feat/electron-43-upgrade`
- 当前测试基线：227 tests
- 评估结论：**继续整理有价值，但不应再按“把 Store 拆得更小”作为目标；应按移动端复用边界拆分。**

## 一、总体意见

当前桌面端已经完成了多轮低风险和中风险拆分：

- Store 只读查询、搜索、历史、回收站、资源引用、目录查询、元数据、正文保存、资源协调和远程导入已经有独立模块。
- `electron/store.ts` 已从约 2,400+ 行降到约 1,785 行。
- `QuickNotesStore` 仍约 700 行，且把 SQLite、小记文件、图片 staging、回收站和小记业务状态机放在同一个类里。
- `native.ts` / preload 已经是当前渲染层与 Electron 的边界，但它还是一个桌面实现接口，不是明确的跨端领域服务契约。

因此：

> **Store 不建议继续为了减少行数而拆。下一轮应该优先整理“移动端要复用的能力边界”。**

## 二、各功能拆分价值评估

| 功能 | 当前状态 | 移动端复用价值 | 继续内部拆分风险 | 建议 |
| --- | --- | ---: | ---: | --- |
| 小记 | `QuickNotesStore` 约 700 行，SQLite/文件/图片/回收站/状态机混合 | 很高 | 中 | 下一重点 |
| 图片 | `imageUtils`、`ResourceRepository` 已拆；仍依赖 Electron `fs/net` | 很高 | 低到中 | 抽纯策略，保留平台适配 |
| 历史 | 只读层已拆，写入仍在 Store | 中 | 中高 | 暂不继续拆内部写事务，先定义服务契约 |
| 回收站 | 只读层已拆，删除/恢复/purge 在 Store | 很高 | 中高 | 先稳定服务 API，不立即拆写状态机 |
| 普通笔记 | 内容/元数据/远程导入已拆 | 很高 | 高 | 暂停继续拆，避免过度分层 |
| S3 同步 | Lake/Quick Notes 双同步状态机 | 中高 | 高 | 不与移动端 UI 共用内部实现 |

## 三、推荐的目标架构

### 1. 共享领域契约，而不是共享 Electron 实现

移动端不应该直接复用：

- better-sqlite3
- Electron `net`
- Electron IPC
- Electron 文件路径
- 桌面专用资源服务器 URL

建议共享的是稳定的领域 API 和数据类型：

```text
src/lib/types.ts                 领域数据类型
src/lib/services/                跨端服务契约（后续新增）
  NoteService.ts
  QuickNoteService.ts
  HistoryService.ts
  TrashService.ts
  AssetService.ts

Electron 实现：
electron/                         SQLite/文件/S3 实现
移动端实现：                       移动端数据库/文件/网络实现
```

`native.ts` 可以继续作为 Electron adapter，但不应成为移动端必须依赖的实现细节。

### 2. 共享纯函数和策略，平台 I/O 分开

适合跨端共享：

- 图片魔数识别
- 图片尺寸策略
- 文件名/路径段校验规则
- 内容 hash 接口定义
- 小记内容 JSON 校验/规范化
- 历史保留策略
- 回收站展示 DTO

不适合直接共享：

- `fs.readFileSync/writeFileSync`
- `better-sqlite3` 查询
- Electron `net.request`
- `http://127.0.0.1:<port>` 资源 URL
- S3 manifest 的具体上传实现

## 四、重点建议：Quick Notes 作为下一阶段第一目标

### 当前问题

`electron/quickNotes.ts` 约 700 行，职责包括：

- SQLite schema/migration
- 小记内容读写
- 图片 staging
- 图片 assets
- draft 丢弃
- 创建/更新
- 删除/恢复/purge
- 冲突归档
- conversion journal
- 小记同步适配所需的查询

这已经是移动端最值得整理的模块，因为移动端很可能同时需要：

- 创建小记
- 编辑小记
- 图片选择/粘贴
- 草稿恢复
- 小记列表
- 回收站
- 转为正式笔记

### 推荐拆法

#### Quick Notes Batch A：纯模型/校验层（低风险）

抽取：

- `quickNoteModel.ts`
- `quickNoteValidation.ts`
- `quickNoteSerialization.ts`

职责：

- `QuickNoteContent` 校验
- 文本长度
- 图片元数据校验
- preview 生成
- JSON 序列化/反序列化
- hash 输入规范化

不接触数据库和文件系统。

#### Quick Notes Batch B：只读查询层（低风险）

抽取：

- 小记列表
- 单条读取
- 小记回收站列表
- 删除记录查询
- conversion 状态查询

保留 `QuickNotesStore` wrapper，确保现有 IPC 不变。

#### Quick Notes Batch C：文件/图片存储层（中风险）

抽取：

- `.qnote` 文件
- assets 目录
- staging 目录
- 原子写
- 图片复制/移动
- draft 清理

建议使用显式 namespace 配置：

```ts
createFileNamespace({
  root,
  itemDirectory: "items",
  assetDirectory: "assets",
  stagingDirectory: "staging",
  buildAssetUrl,
})
```

但不要把 Lake 文档和 Quick Notes 强行塞进同一个“大一统 Repository”；两者的内容格式、同步语义和恢复语义不同。

#### Quick Notes Batch D：业务写入协调层（中风险）

最后再迁移：

- create/update
- delete/restore/purge
- conflict archive
- conversion journal

这是 Quick Notes 的状态机，必须保留一个清晰的协调器，不要把每个 SQL 拆成大量细碎类。

## 五、图片能力的公共化方案

当前 `imageUtils.ts` 已经是好的基础，但 `ResourceRepository` 仍是 Electron 专用实现。

推荐下一步只做一个小的公共边界：

```text
ImagePolicy / ImageMetadata
  ├─ sniffImageFormat
  ├─ readImageDimensions
  ├─ maxBytes
  └─ maxPixels

ElectronImageStore
  ├─ fs 写入
  ├─ Electron net 下载
  └─ asset server URL

MobileImageStore
  ├─ 移动端文件 API
  ├─ 移动端网络 API
  └─ 移动端资源 URL
```

收益：移动端可以复用安全规则，但不复用错误的平台实现。

## 六、历史与回收站的建议

### 历史

当前 `HistoryRepository` 已经足够小，继续拆内部类的收益不高。

推荐：

1. 将历史列表、预览、统计的返回类型提升到共享 `src/lib/types.ts`。
2. 定义 `HistoryService` 契约。
3. Electron 继续使用当前 Store/HistoryRepository 实现。
4. 移动端后续提供自己的 adapter。

暂不拆：

- 快照写入
- 恢复
- 清理
- 文件引用回收

这些仍然和桌面本地文件、SQLite、资源引用强耦合。

### 回收站

回收站是同步语义的一部分，不只是 UI 列表。

必须保持：

- 删除 = 移入隐藏回收站
- 墓碑权威
- 恢复是显式例外
- purge 墓碑保留
- 先同步者胜

推荐：

1. 先定义共享 `TrashItem` / `TrashService` 契约。
2. 移动端复用“展示和动作语义”。
3. Electron 与移动端各自实现数据层。
4. 暂不抽一个跨平台 TrashRepository 直接共用 SQLite SQL。

## 七、公共方法抽取建议

### 值得抽取

- `isSafePathSegment`
- `atomicWrite`
- `sha256/hash`
- `nowIso`
- 内容 JSON 规范化
- 图片格式和尺寸策略
- 资源 URL builder 的接口

### 不建议抽取成通用大类

- `UniversalRepository`
- `BaseStore<T>`
- `GenericSyncRepository`
- 同时处理 Lake 和 Quick Notes 的 `FileStore`
- 通过大量 callback 把所有 Store 私有逻辑拼在一起的“超级服务”

判断标准：

> 如果抽取后的公共模块需要知道 Lake、Quick Notes、回收站、同步和 Electron 五种语义，它就已经过度抽象。

## M1 实施结果（2026-08-18）

已完成 Quick Notes M1：

- `src/lib/quickNoteModel.ts`：纯模型、校验、序列化、preview、图片 MIME 策略。
- `src/lib/types.ts`：已有 Quick Note 基础 DTO 继续作为共享类型来源。
- `electron/quickNoteModel.ts`：Electron 兼容 shim。
- `electron/quickNoteTypes.ts`：Electron 侧同步/IPC 专用补充类型。
- `electron/quickNoteModel.test.ts`：新增模型边界测试。

模型层不依赖 SQLite、文件系统或 Electron；Electron Store 负责将模型错误映射为现有 `AppError`，因此 IPC 错误分类和业务行为保持不变。

验证：

- M1 定向测试：21 项通过。
- 完整测试：232 项通过。

## 移动端真实代码核对（2026-08-18）

本轮核对了本地候选移动端项目：

- `/Users/admin/file/local-lake/lake-notes-tauri-poc`：包含 Tauri Android 脚本、Rust Store 和移动端资源上传/下载能力。
- 该项目当前没有 Quick Notes 数据模型、表结构或调用链；因此暂时没有可以验证 Quick Notes M3 文件层接口的真实移动端调用方。
- Electron 的 `src/lib/quickNoteModel.ts` 目前是仓库内共享纯模型层；Tauri POC 是独立项目，尚未建立 workspace/package 共享边界。

结论：不要现在把 Electron `fs`/asset-server URL 抽成“跨平台文件层”。等移动端真正开始实现 Quick Notes，先确定 Tauri/Rust 文件 API 和资源 URL 方案，再实施 M3。

## M2 实施结果（2026-08-18）

已完成 Quick Notes M2：

- 新增 `electron/quickNotesQueries.ts`。
- 抽取列表、单条读取、内容/row 映射、回收站列表、恢复标记、删除记录和同步墓碑查询。
- `QuickNotesStore` 保留原有公开方法作为 wrapper，IPC channel 与返回值不变。
- M2 仍然是 Electron 查询 adapter；共享移动端的是 DTO/领域语义，不直接共享 SQLite 查询。

验证：

- 小记/同步定向回归通过。
- 完整测试：232 项通过。
- tsc/build/diff 全绿。
- tsc/build/diff 全绿。

## 八、推荐执行顺序

### Phase M0：公共契约（低风险）

- 整理共享 DTO 类型
- 定义 QuickNote/History/Trash/Asset service 接口
- 不改变 Electron 实现
- 不改变 IPC

### Phase M1：Quick Notes 纯层（低风险）

- 模型校验
- 序列化
- preview/hash 逻辑
- 单测

### Phase M2：Quick Notes 查询层（低风险）

- 列表/单条/回收站/转换状态查询
- Store wrapper
- IPC 不变

### Phase M3：Quick Notes 文件层（中风险）

- qnote 文件
- 图片目录
- staging
- 原子写
- 文件清理

### Phase M4：图片跨端策略（低到中风险）

- 共享 ImagePolicy
- Electron/Mobile 两个 I/O adapter

### Phase M5：移动端实现

- 移动端实现 service contract
- 复用 M0-M4 共享纯层
- 不复用 Electron IPC/SQLite 细节

## 九、停止条件

满足以下任一条件时，不再继续拆：

1. 新模块只是在转发 Store 方法，没有独立职责。
2. 为了注入依赖新增的 callback 数量超过实际业务逻辑数量。
3. 移动端没有真实调用方，抽象无法通过实际使用验证。
4. 测试需要大量 mock 内部实现而不是验证领域行为。
5. Store 行数减少，但事务边界和错误定位变得更难。

## 最终建议

**M1/M2 已完成。下一目标应根据移动端真实页面需求决定是 M3 文件层，还是先定义移动端 service contract；不建议为了继续减少 `QuickNotesStore` 行数而直接拆状态机。**

理由：

- Quick Notes 是移动端高频能力。
- 现有 `QuickNotesStore` 仍是最明显的职责聚合点。
- 拆分收益可以直接映射到移动端需求。
- 风险可以通过“纯层 → 查询层 → 文件层 → 状态机”的顺序控制。

历史/回收站/图片不建议继续内部拆成更多 Repository；应先做共享契约和平台 adapter，等移动端真实需求出现再实现。
