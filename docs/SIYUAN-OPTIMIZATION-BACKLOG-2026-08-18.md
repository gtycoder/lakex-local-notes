# 借鉴思源 3.8.0 的流程、性能与可靠性优化方案

- 评估日期：2026-08-18
- 对照源码：`/Users/admin/file/local-lake/siyuan-master`
- 对照版本：`app/package.json` = `3.8.0`
- 目标：借鉴思源经过验证的机制，不复制其依赖 Go kernel/WebSocket 的架构
- 原则：**借机制，不抄架构；先解决真实瓶颈，不为了“像思源”增加复杂度。**

## 一、结论摘要

思源值得借鉴的核心不是某一个 CSS 或组件，而是以下工程习惯：

1. **按对象串行化异步操作**：`app/src/protyle/util/transactionQueue.ts` 用 `WeakMap<IProtyle, Promise<void>>` 为每个编辑器建立队列，避免命令并发交错。
2. **旧请求失效机制**：`app/src/search/request.ts` 同时使用版本号、AbortController、排队任务和 `isCurrent()`，防止旧搜索结果覆盖新查询。
3. **只渲染视口附近数据**：`app/src/protyle/render/av/virtualScroll.ts` 使用上下 buffer、缓存行高、WeakMap 状态和选择状态恢复，避免大列表全量 DOM。
4. **可中断的高度动画**：`app/src/layout/dock/fileTreeAnimation.ts` 使用 WAAPI、动画状态 WeakMap、`prefers-reduced-motion` 和结束清理，避免树展开收起抖动。
5. **布局保存是可恢复流程**：`app/src/layout/util.ts` 的 `saveLayout()` 会在布局仍处于不完整状态时延迟重试，而不是把中间态直接持久化。
6. **功能操作有显式状态机**：历史、搜索、布局、拖拽和编辑器事务都有明确的 running/queued/abort/finish 边界。

Lake Notes 已经具备不少对应基础（保存 debounce、同步队列、资源并发队列、渲染进程恢复、部分懒加载），下一步应优先补“旧请求失效”和“按对象串行保存”这两类可靠性机制。

## 二、按优先级的建议

### P0：保存/编辑操作按文档串行化

#### 思源参考

`transactionQueue.ts`：

- 每个编辑器实例一个 Promise 队列；
- 前一个任务失败不会阻断后续任务；
- 可以等待当前编辑器的 pending transactions。

#### Lake 当前情况

`src/App.tsx` 当前有每个 noteId 的 800ms `saveTimers` debounce，但 `persistTab()` 完成后没有独立的 per-note Promise queue。快速编辑、关闭标签、窗口退出和自动保存可能同时触发同一文档的保存请求。

虽然 revision 检查避免了部分旧响应覆盖新草稿，但它不是完整的写入串行化：

- 旧保存仍可能晚于新保存写入磁盘；
- closeTab / beforeunload / timer 可能同时调用 `persistTab`；
- 失败重试策略没有按文档聚合。

#### 建议方案

新增轻量的渲染层 `KeyedAsyncQueue` 或 `NoteSaveQueue`：

```ts
await noteSaveQueue.run(noteId, () => native.saveNote(...));
await noteSaveQueue.wait(noteId);
```

要求：

- 只按 noteId 串行，不阻塞不同文档；
- 保留现有 800ms debounce；
- 保留 revision guard；
- closeTab / beforeunload 先 `wait(noteId)`；
- 队列任务失败后继续允许后续任务；
- 不改变 Store 事务和 IPC 协议。

#### 收益

- 降低同一文档保存乱序风险；
- 关闭标签和退出流程更可靠；
- 对移动端也有价值，因为移动端网络/存储延迟更大。

#### 风险

中低。只改渲染层调度，不改数据格式和业务语义。必须补：

- 快速连续编辑；
- 保存中再次编辑；
- 保存中关闭标签；
- 两个文档并行编辑；
- 保存失败后继续编辑。

### P0：搜索请求版本化、取消和旧结果保护

#### 思源参考

`app/src/search/request.ts`：

- 每次查询递增 version；
- AbortController 取消当前可取消请求；
- 运行任务通过 `isCurrent()` 判断结果是否仍有效；
- 当前有请求时只保留最新 queued task；
- 元素断开后不再更新 UI。

#### Lake 当前情况

`src/components/SearchPanel.tsx` 只有 300ms debounce，会清除 timer，但已经发出的 `native.searchNotes()` 无法取消，也没有 query version 判断。用户快速输入时，旧查询可能晚返回并覆盖新结果。

#### 建议方案

最小实现不需要改 IPC：

```ts
const requestVersion = useRef(0);
const version = ++requestVersion.current;
const result = await native.searchNotes(q, 50);
if (version !== requestVersion.current) return;
setResults(result);
```

如果后续 IPC 支持 AbortSignal，再增加真正取消；第一阶段只做 version guard 即可。

#### 收益

高。代码很小，直接解决搜索 UI 的竞态问题，对移动端也有明显价值。

#### 风险

低。只影响旧搜索结果是否渲染，不改变搜索 SQL 和结果内容。

### P1：树/大纲大数据量虚拟化

#### 思源参考

`virtualScroll.ts` 的关键机制：

- viewport 上下 buffer；
- 缓存 rowHeight，避免每帧强制重排；
- 大于有效渲染范围才 trim；
- WeakMap 保存每个 body 状态；
- trim 前后恢复选择状态；
- 数据少时全部渲染，避免短列表抖动。

#### Lake 当前情况

Lake 当前 `listTreeNodes()` 已经只读查询优化，但 Sidebar 仍是 React 全量渲染树节点；10k 节点时数据库不是唯一瓶颈，DOM 数量和 React reconciliation 也会成为瓶颈。

#### 建议方案

不要直接引入复杂虚拟列表库，先做分阶段方案：

1. `TreeRow` 使用 `React.memo`；
2. 将 `childrenOf()` 和搜索匹配结果做 memo；
3. 统计真实节点数、渲染耗时和滚动 FPS；
4. 节点超过阈值（例如 2,000 个可见行）才启用窗口化渲染；
5. 采用固定行高优先，避免动态高度虚拟化复杂化。

#### 收益

高，但只在大树数据量下明显；对普通用户不一定有感知。

#### 风险

中。树展开、拖拽、右键菜单、重命名和键盘导航都需要回归。建议等移动端树 UI 需求明确后，抽成跨端 TreeModel，而不是现在只为桌面加复杂虚拟化。

### P1：树展开/收起动画的可中断机制

#### 思源参考

`fileTreeAnimation.ts`：

- WAAPI 高度动画；
- WeakMap 记录正在收起的元素；
- 新操作可以中断旧动画；
- `finished` 后清理 inline style；
- reduced motion 时持续时间为 0。

#### Lake 当前情况

Lake 已有 CSS/WAAPI 动效，但树的快速连续展开/收起需要继续确认是否存在旧 transition 残留、高度抖动或 pointer 状态错乱。

#### 建议方案

先做只读审计和运行时测试，不立即重写：

- 同一节点快速展开→收起→展开；
- 父节点展开动画中关闭；
- 搜索过滤时动画是否残留；
- reduced motion 是否真正跳过动画。

只有出现实际问题，再引入 per-element animation controller。

### P1：布局/尺寸持久化的“提交时保存”

#### 思源参考

`layout/util.ts` 的布局保存会检查布局是否完整，必要时延迟重试。

#### Lake 当前情况

Sidebar/Outline 宽度在拖动过程中频繁更新 React state，`useEffect` 会持续写 localStorage；这不是严重问题，但属于无谓写放大。

#### 建议方案

- pointermove 只更新视觉 state；
- pointerup 时一次性 clamp + localStorage commit；
- 组件卸载或窗口关闭时补一次 commit；
- 如果存在布局恢复中间态，增加简单的 version/complete 标记。

#### 收益

低到中，主要是减少写入和让布局持久化更清晰。

#### 风险

低，但必须确保拖动中崩溃时不会把无效宽度写入。

### P1：异步 UI 任务统一“版本 + 连接状态”协议

#### 思源参考

搜索请求、历史预览、布局保存都有：

- request/version id；
- 元素是否仍 connected；
- 任务完成后的有效性检查。

#### Lake 建议

抽一个非常小的工具，而不是大框架：

```ts
interface RequestVersion {
  next(): number;
  isCurrent(version: number): boolean;
}
```

先用于：

- SearchPanel
- HistoryPanel 预览
- Quick Notes 列表刷新
- 同步完成后 tab reload

停止条件：如果只有一个调用方，不要抽公共工具，直接局部实现即可。

### P1：统一后台任务生命周期

#### 思源参考

请求队列和 abort 机制明确区分：

- queued
- running
- aborted
- idle
- finished

#### Lake 当前情况

Lake 已有：

- `maintenanceQueue`
- `syncInFlight`
- 图片 `ConcurrencyQueue`
- worker pool
- 保存 timer

但每种任务的状态表示和取消方式不同。

#### 建议方案

不建议现在统一成一个超级 TaskManager。只整理一份约定：

- 需要取消的任务必须有 AbortController；
- 只允许最新结果生效的任务必须有 version guard；
- 跨表/跨文件维护任务必须进入 maintenanceQueue；
- 退出时必须明确等待、取消或丢弃策略。

## 三、UI 层借鉴建议

### 1. 交互反馈优先于装饰

思源的 toolbar、dock、tab、menu 有一致的：

- hover/active/disabled 状态
- 键盘快捷键提示
- 点击后即时反馈
- 操作失败后的可理解提示

Lake 当前 UI 已经完成主要复刻，下一步不建议继续改颜色，而建议审计：

- disabled 是否真的阻止操作；
- loading 是否阻止重复点击；
- 菜单关闭后焦点是否恢复；
- Escape/点击外部/窗口关闭是否统一；
- reduced motion 是否覆盖所有新增动效。

### 2. Tab 与窗口布局

思源 `Tab.ts` / `tabDrag.ts` 的价值在于状态和布局操作分离：

- tab model 不直接依赖 DOM 位置；
- 拖动过程有独立状态；
- 结束时统一保存布局；
- 失败/取消不会破坏原顺序。

Lake 已有拖拽排序和 FLIP 动效，建议只补：

- 拖动取消回滚；
- 键盘移动 tab；
- 多 tab 关闭时 active tab 选择规则测试；
- 窗口退出时 tab 状态是否已保存。

### 3. 设置项模型

思源 `config/setting/item.ts` 将设置行拆为：

- label
- value reader
- save callback
- validation
- search metadata

Lake `SettingsPanel` 当前由 React JSX 直接组织。移动端后续会需要相同设置模型时，可考虑定义纯配置描述：

```ts
interface SettingDefinition<T> {
  id: string;
  read(): T;
  validate(value: T): string | null;
  save(value: T): Promise<void>;
}
```

但不要现在把所有设置重写成动态表单；只有当移动端需要复用设置项时再实施。

## 四、流程和可靠性优化

### P0：保存流程验收矩阵

借鉴思源“事务队列 + 状态回调”的思路，建立固定回归矩阵：

- 输入变化后 0ms/100ms/800ms 保存；
- 保存中再次输入；
- 保存中关闭 tab；
- 保存中切换工作区；
- 保存中退出应用；
- 保存失败后继续输入；
- 同一 note 多次保存顺序；
- 不同 note 是否能并行。

### P1：搜索流程验收矩阵

- 快速连续输入；
- 清空查询；
- 关闭搜索后请求返回；
- 重新打开搜索；
- 旧结果不能覆盖新结果；
- 查询异常后 spinner 必须结束。

### P1：资源与历史流程

- 资源写入失败后的孤儿登记；
- 历史快照失败是否阻塞正文保存；
- 恢复历史后资源引用是否仍受保护；
- 远程导入中断后的 staging 清理；
- 回收站恢复/purge 后搜索索引一致性。

## 五、不建议直接照搬思源的部分

1. **不复制 Layout/Model + Go kernel/WebSocket 架构**：Lake Notes 的 Electron/React/SQLite/S3 约束不同。
2. **不复制思源全部 Protyle DOM 和事件总线**：当前 Lake 编辑器内核不同，容易产生双重状态。
3. **不为了类似思源而增加命令面板、插件、图谱等空功能 UI**。
4. **不直接引入通用 TaskManager/Repository 基类**：先有两个以上真实复用方再抽象。
5. **不为了虚拟化而牺牲树拖拽、键盘导航和小数据列表的简单性**。
6. **不把同步协议改成思源协议**：Lake 的本地真相、S3 镜像和墓碑语义已经定稿。

## 六、推荐实施顺序

### 第一阶段：可靠性小改（优先）

1. SearchPanel 增加 query version guard；
2. 文档保存增加 per-note async queue；
3. 补保存/搜索竞态测试；
4. 不改 Store、IPC 和数据格式。

### 第二阶段：低风险性能优化

1. `TreeRow` memo；
2. 搜索/树计算 memo；
3. 宽度拖动只在 commit 时持久化；
4. 真实数据量和性能埋点；
5. 超过阈值再考虑树窗口化。

### 第三阶段：流程模型

1. 统一 async task 约定；
2. 历史预览、Quick Notes 刷新、同步 tab reload 加 version guard；
3. 补窗口退出、取消、错误恢复矩阵。

### 第四阶段：移动端复用

1. 共享 Quick Note/History/Trash/Asset DTO；
2. 移动端真实文件 API 确定后实施 Quick Notes M3；
3. 定义 service contract；
4. Electron 与移动端各自实现 adapter。

## 七、验收与停止条件

每个阶段必须：

- 有目标问题或可观测指标；
- 有定向测试；
- 有完整测试；
- 不改变既定同步语义；
- 不引入仅为抽象而存在的层。

停止条件：

- 没有可复现的性能/可靠性问题；
- 新层没有第二个真实调用方；
- 抽象只剩参数转发；
- 测试 mock 多于真实行为验证；
- 移动端尚未提供对应 API。

## 八、2026-08-18 实施记录

本方案已按“先可靠性、再低风险性能、再异步流程、最后 UI 审计”的顺序落地第一轮实现：

### 已完成

1. **搜索请求版本保护**
   - `src/components/SearchPanel.tsx` 增加 query/open 变化失效机制。
   - 旧请求不能覆盖新结果，也不能提前关闭新请求的 loading。
   - 关闭、清空、卸载时会使旧请求失效。

2. **按 noteId 串行保存**
   - 新增 `src/lib/keyedAsyncQueue.ts`。
   - 同一篇文档串行，不同文档并行。
   - 保存失败不会阻塞后续任务。
   - 关闭 tab / beforeunload 会清理 pending debounce，再进入保存队列。
   - 保留原有 revision guard、800ms debounce、Store/IPC/同步语义。

3. **树索引与低风险渲染优化**
   - 新增 `src/lib/treeIndex.ts`，一次构建 parent → children 索引和搜索可见集合。
   - `Sidebar` 不再在每个 `TreeRow` 中反复扫描全量节点。
   - `TreeRow` 使用 `memo`，并稳定了主要回调引用。

4. **布局提交式持久化**
   - Sidebar/Outline 宽度拖动过程不再持续写 localStorage。
   - pointerup 时提交合法值；组件卸载时补一次 clamp 后的持久化。

5. **异步 UI 有效性保护**
   - History/Orphan 列表刷新与预览增加 version guard。
   - Quick Notes 列表初始加载和 refresh 增加 version guard。
   - Trash 文档/小记列表刷新增加 version guard。
   - 同步完成后的打开 tab reload、回收站恢复 reload、历史恢复 reload 增加统一版本保护。

6. **交互与动效审计修复**
   - HistoryPanel、TrashPanel 支持 Escape 关闭。
   - reduced-motion 明确覆盖同步 toast、同步旋转图标、通用 loading/spin 和不确定进度动画。

7. **本地资源 CORS 预加载修复**
   - 编辑器内存文档可临时附加 token，保存/缓存前会剥离 token，持久化内容保持稳定。
   - 主进程对受信任窗口发出的本地资源请求补回当前启动 token，兼容 Lake 的 `crossOrigin=true` 预加载。
   - 解决开发运行时本地图片 CORS 预加载报错，同时不放宽外部网页访问策略。

### 本轮验证

- Node：`v24.18.0`
- TypeScript：`npx tsc --noEmit` 通过
- Vitest：**19 个测试文件，241 个测试全部通过**
- Vite/Electron build：通过
- `git diff --check`：通过
- 使用开发数据 `~/Library/Application Support/lake-notes-dev` 做 Electron 运行时检查：
  - 全文搜索打开、输入、结果返回、Escape 关闭正常；
  - 小记工作区切换正常；
  - 本地图片 `naturalWidth` 正常加载；
  - 页面 reload 后没有捕获到 CORS、Unhandled 或 JavaScript exception。

### 有意暂缓

- 树虚拟化：当前开发库实际只有 19 个 tree node，未达到 2,000 可见行阈值；先保留索引和 memo，避免为小数据引入拖拽/键盘/菜单风险。
- 退出前 renderer → main flush/ack：当前已有 beforeunload 阻止关闭和主进程同步等待；需要专门复现“确认退出后异步保存未完成”再改协议。
- 通用 TaskManager、动态设置表单、复杂动画控制器：当前没有足够真实调用方或可复现问题。

### 已知非阻断构建提示

构建仍会输出既有提示：

- `index.html` 中 vendor CodeMirror 脚本不是 module；
- JetBrainsMono 字体在构建时保持运行时路径；
- 主 bundle 超过 500 kB。

这些是已有的构建 warning，不是本轮 TypeScript、测试、运行时错误；后续如需要可单独做资源拆包和 vendor 路径治理。
