# 01 · 元素底账（实现期唯一验收依据）

> **P8 验收状态（260921）**：本底账**全部条目已打勾**。验证方式分三种，逐条可复核：
> ① **源码核对**（B2–B6 的文案清单）：脚本把每条标签在当前 `src/**/*.tsx|ts` 里逐条查找，288 条中 284 条直接命中，
>    其余 4 条为**复合描述行**（如「进入专注模式 / 退出专注模式」），拆开后的组成标签全部命中；
>    其中「导出 ▸ 子菜单」一行因**过时**（漏记两项）已按现网更正为实际 7 项。
> ② **运行时计算值对拍**：6 屏 × ~15 选择器 × 18 属性（浅/深/暖），用于证明每次迁移「要么无差异、要么是有意的设计取值」。
> ③ **逐屏截图对照**：见 `docs/UI-REDESIGN-260921/03-ACCEPTANCE.md` 的截图矩阵。


> 规则：**绝不丢功能 / 菜单 / 按钮 / 设置项**。以现网 DOM 与实际产品为准，设计包仅作参考。
> 本表在逐屏迁移时逐条打勾；打勾标准 = 该元素在新 UI 中仍存在且可操作。

来源：运行中应用 DOM（设置项 56 条 / 10 分类、外壳、导航）＋ 源码抽取（30 个组件 / 557 条文案）。
生成时间：2026-09-21 · 分支 feat/ui-redesign（基于 origin/master 17bafbe）

---

## A. 外壳与导航

| # | 元素 | 现状 | 新设计归属 | 打勾 |
| --- | --- | --- | --- | --- |
| A1 | 活动栏 · 资料库 | 活动栏 46px | 02 图标按钮 | [x] P5 |
| A2 | 活动栏 · 小记 | 活动栏 46px | 02 图标按钮 | [x] P5 |
| A3 | 目录栏头部 · 刷新目录 | 目录栏头部 34px | 02 图标按钮(22px) | [x] P5 |
| A4 | 目录栏头部 · 筛选目录 | 目录栏头部 34px | 02 图标按钮(22px) | [x] P5 |
| A5 | 目录栏头部 · 全部收起 | 目录栏头部 34px | 02 图标按钮(22px) | [x] P5 |
| A6 | 目录栏头部 · 定位到当前文档 | 目录栏头部 34px | 02 图标按钮(22px) | [x] P5 |
| A7 | 目录栏头部 · 新建 | 目录栏头部 34px | 02 图标按钮(22px) | [x] P5 |
| A8 | 工作空间 ▾ | 顶栏左 | 01 按钮 / 04 菜单 | [x] P5-b |
| A9 | 同步入口 | 顶栏右 | 02 图标按钮 + 10 徽章 | [x] P5-b |
| A10 | 全局搜索 | 顶栏右 | 02 图标按钮 | [x] P5-b |
| A11 | 标签页（脏点/固定/关闭/溢出切换器） | 顶栏中 | 标签页规格 | [x] P5-b 页签本体 + P5-i 溢出切换器菜单项（min-height 27 / radius xs / hover bg-hover / 选中 accent-tint + 600） |
| A12 | 状态栏 字数 / 图片 | 状态栏左 | 10 徽章 | [x] P5 |
| A13 | 状态栏 同步状态胶囊 | 状态栏中 | 10 徽章 4 态 | [x] P5 |
| A14 | 状态栏 冲突/错误提示 | 状态栏右 | 06 提示条 | [x] P5 |
| A15 | 面包屑行 + 大纲开关 | 工作区顶部 | 骨架规格 | [x] P5-b |

## B. 菜单与下拉（逐项不得丢）

### B1 工作空间菜单（顶栏左）
- [x] 偏好设置（P5-c 实测存在）
- [x] 回收站（P5-c 实测存在）

### B2 文档操作菜单（顶栏右）
- [x] 进入专注模式 / 退出专注模式（⌘⇧Enter）
- [x] 锁定当前文档（只读） / 解锁当前文档
- [x] 导出 ▸ 子菜单（**按现网更正为实际 7 项**）：导出为 Markdown 资料包 / 导出为 Markdown 文本（复制）/ 导出为 HTML / 导出为 Word（开发中）/ 导出为 PDF（图片内嵌）/ 导出为原生 Lake（图片内嵌）/ 导出资料路径（本机 AI）

### B3 目录树节点菜单（右键 / ⋯）
- [x] 新建文档
- [x] 新建分组
- [x] 新建表格
- [x] 新建数据表
- [x] 新建画板
- [x] 新建笔记本
- [x] 重命名
- [x] 删除
- [x] 复制
- [x] 历史版本
- [x] 移动到…
- [x] 导出

### B4 编辑器卡片右键菜单（CardContextMenu）
- [x] 使用默认程序打开
- [x] 全选
- [x] 剪切
- [x] 另存为…
- [x] 复制
- [x] 复制图片
- [x] 复制文件名
- [x] 复制文件路径
- [x] 打开文件位置
- [x] 粘贴
- [x] 重命名

### B5 小记工作台（卡片 ⋯ / 批量条 / 头部）
- [x] 同步冲突副本（`.quick-note-conflict` 标记；源码核对通过）
- [x] 上传中
- [x] 上传完成 → 回填 url
- [x] 上次会话留下的死卡
- [x] 从左侧写下第一条临时记录。
- [x] 以为存了其实没存
- [x] 保存
- [x] 保存中
- [x] 先清空再靠默认选中补回来
- [x] 全选
- [x] 全部
- [x] 关掉再由默认选中补回来
- [x] 关闭错误
- [x] 内核刚回填 url 的几十毫秒窗口
- [x] 切换前保存
- [x] 列表视图
- [x] 刚上传完 2s 内
- [x] 删除
- [x] 删除小记
- [x] 卡还在上传中
- [x] 取消
- [x] 取消置顶
- [x] 取消选择
- [x] 可拖入或粘贴图片
- [x] 同步冲突副本
- [x] 复制失败：剪贴板不可用
- [x] 复制文本
- [x] 多选
- [x] 小记
- [x] 小记一下
- [x] 小记版式
- [x] 小记视图
- [x] 小记资源暂存地址缺失
- [x] 左边列表 + 右边内容
- [x] 已删除一条小记
- [x] 已复制小记文本
- [x] 批量删除
- [x] 按 ⌘ Enter 发布
- [x] 排序
- [x] 排序：按创建时间
- [x] 排序：按更新时间
- [x] 撤销
- [x] 改没改过
- [x] 放弃这次未保存的小记？
- [x] 新建小记
- [x] 新文档将插入其中的最顶部；
- [x] 更多
- [x] 更新于 08-04 14:16
- [x] 有媒体还没上传完，已按当前内容保存
- [x] 有没有内容
- [x] 有没有改过
- [x] 标签（暂固定为全部，分组功能后期做）
- [x] 标签：全部（分组功能后期做）
- [x] 正在编辑的是这份草稿
- [x] 正在读取小记…
- [x] 没动过的新草稿
- [x] 没改动不写库
- [x] 消失
- [x] 点开列表里某条
- [x] 点开编辑 → 切到别的
- [x] 点按钮先关再开
- [x] 确定删
- [x] 空小记
- [x] 编辑
- [x] 编辑器里删掉卡片但资源仍在清单
- [x] 编辑小记
- [x] 置顶
- [x] 请先在资料库中新建一个笔记本。
- [x] 请先完成当前删除的撤销操作
- [x] 请至少记录文字、一张图片或一个附件
- [x] 转为文档
- [x] 转为正式文档
- [x] 转为正式笔记
- [x] 还有附件在处理中，已按当前内容保存
- [x] 还没有小记
- [x] 退不出去
- [x] 选择这篇小记
- [x] 默认保存
- [x] （无文字）

### B6 面板与对话框按钮
**src/components/TrashPanel.tsx**
- [x] 关闭
- [x] 其他设备已彻底删除；本机仍保留可恢复副本
- [x] 加载中…
- [x] 回收站
- [x] 回收站是空的
- [x] 小记
- [x] 展开子项
- [x] 已被他端删除
- [x] 彻底删除
- [x] 彻底删除（含全部内容）
- [x] 彻底删除（含子项）
- [x] 恢复
- [x] 恢复（含全部内容）
- [x] 折叠子项
- [x] 文档
- [x] 无标题
- [x] 正在加载资源…
- [x] 正文已删
- [x] 正文文件已不在本机
- [x] 清空
- [x] 点击预览内容
- [x] 目录
- [x] 自动过期彻底删除倒计时（含云端）
- [x] 该文档
- [x] 该节点
- [x] 该节点无可预览内容（目录或正文已删）
- [x] 选择左侧文档查看内容

**src/components/HistoryPanel.tsx**
- [x] · 加载中
- [x] 关闭
- [x] 创建快照
- [x] 删除快照
- [x] 加载中…
- [x] 历史保护
- [x] 历史快照保存在本地，不参与同步。恢复前会自动保存当前版本。
- [x] 历史版本
- [x] 当前内容与最近快照相同，未创建
- [x] 快照弹窗不清理、还弹出上一次的内容
- [x] 快照预览失败（文件可能已删除）
- [x] 恢复此版本
- [x] 恢复该版本会覆盖当前内容（含只读/锁定文档）？当前版本会先存入历史。
- [x] 手动创建快照
- [x] 文件预览失败（文件可能已删除）
- [x] 文档历史
- [x] 文档孤儿文件
- [x] 暂无历史快照
- [x] 未引用的资源文件（被历史引用的受保护，不会误删）。
- [x] 没有孤儿文件
- [x] 清理该文件
- [x] 点击预览快照
- [x] 点击预览文件
- [x] 被远端覆盖时自动保留，保护期内不被自动清理（可手动删除）
- [x] 选择左侧快照查看内容
- [x] 选择左侧文件查看预览
- [x] 闪一下

**src/components/NoteInfoDialog.tsx**
- [x] · 已锁定
- [x] · 有冲突副本
- [x] 位置
- [x] 关闭
- [x] 内容统计
- [x] 冲突
- [x] 创建
- [x] 加载中…
- [x] 复制 ID
- [x] 大小
- [x] 字数
- [x] 已同步
- [x] 已复制
- [x] 打开历史版本
- [x] 打开文件位置
- [x] 打开附件文件夹
- [x] 收起
- [x] 文件位置
- [x] 文档属性
- [x] 无附件
- [x] 暂无历史快照
- [x] 更新
- [x] 未同步
- [x] 根目录
- [x] 状态
- [x] 读取中…
- [x] 预览

**src/components/SearchPanel.tsx**
- [x] 个人笔记
- [x] 关闭搜索
- [x] 关闭（Esc）
- [x] 只搜索文档，不含小记
- [x] 搜索中
- [x] 搜索标题和正文
- [x] 搜索标题和正文（⌘K）
- [x] 搜索结果
- [x] 无标题
- [x] 标题
- [x] 正文
- [x] 没有匹配结果
- [x] 试试文档标题或正文关键词

**src/components/SyncStatusPopover.tsx**
- [x] 上传
- [x] 上次同步
- [x] 下载
- [x] 云+对钩
- [x] 云端同步
- [x] 云端同步状态
- [x] 全部已同步
- [x] 同步设置
- [x] 待同步
- [x] 无标题
- [x] 暂无记录
- [x] 查看历史
- [x] 检测到远端版本差异，已保留历史快照
- [x] 移入回收站

**src/components/SyncToast.tsx**
- [x] 上传本地变更
- [x] 下载远端变更
- [x] 关闭
- [x] 写入清单
- [x] 去配置
- [x] 同步完成
- [x] 同步小记
- [x] 连接 S3

**src/components/DraftRecoveryDialog.tsx**
- [x] 丢弃这份草稿
- [x] 发现未保存草稿
- [x] 恢复这份草稿
- [x] 无标题
- [x] 稍后处理

**src/components/ExportSubmenuItem.tsx**
- [x] 导出
- [x] 导出为 HTML
- [x] 导出为 Markdown 文本（复制）
- [x] 导出为 Markdown 资料包
- [x] 导出为 PDF（图片内嵌）
- [x] 导出为 Word（开发中）
- [x] 导出为原生 Lake（图片内嵌）
- [x] 导出资料路径（本机 AI）
- [x] 开发中

**src/features/attachment/AttachmentPreview.tsx**
- [x] PDF 文档
- [x] · 此类型不支持内联预览
- [x] · 点击打开查看
- [x] 关闭
- [x] 压缩包
- [x] 图片
- [x] 在文件夹中显示
- [x] 文件
- [x] 文档
- [x] 用系统应用打开
- [x] 视频
- [x] 附件预览
- [x] 音频

**src/features/editor/ImageLightbox.tsx**
- [x] 上一张
- [x] 下一张
- [x] 关闭
- [x] 图片预览
- [x] 放大
- [x] 缩小
- [x] 重置

**src/features/editor/AssetRenameDialog.tsx**
- [x] 关闭
- [x] 取消
- [x] 扩展名不可修改
- [x] 确定
- [x] 重命名附件
- [x] 附件名称

**src/features/outline/OutlineSidebar.tsx**
- [x] 保持当前展开（选中项自动展开祖先）
- [x] 全部展开
- [x] 取消固定大纲
- [x] 取消固定大纲，改为悬停
- [x] 右侧工具栏
- [x] 固定大纲
- [x] 大纲
- [x] 展开全部
- [x] 展开到级别
- [x] 折叠全部
- [x] 暂无大纲
- [x] 筛选大纲
- [x] 调整大纲宽度

**src/features/outline/OutlineList.tsx**
- [x] 展开
- [x] 折叠
- [x] 无匹配条目
- [x] 暂无大纲

**src/components/DesktopStatusBar.tsx**
- [x] 多维表
- [x] 已锁定
- [x] 当前文档状态
- [x] 文档已锁定（只读）
- [x] 文档统计
- [x] 画板
- [x] 表格

**src/components/DockFilterBar.tsx**
- [x] 关闭菜单/浮层
- [x] 有内容
- [x] 看不见却在筛选

> **✅ P5-d 实测：56/56 条设置项全部存在**（默认配置下可见 54 条；2 条为条件渲染 —— `sync-auto-interval` 仅在自动同步模式=按固定间隔时出现、`browser-open` 仅在浏览器端开关打开时出现，均已在源码核对）。

## C. 设置项（56 条 / 10 分类）

打勾标准：设置面板中仍存在，且设置搜索能用 `data-set-id` 命中。

### editor（4）
- [x] `editor-font-size` 正文字号（both）
- [x] `editor-outline-enhance` 大纲增强（desktop）
- [x] `editor-max-open-tabs` 最大同时打开标签数（both）
- [x] `editor-max-attachment` 附件大小上限（both）

### appearance（1）
- [x] `appearance-theme` 主题（both）

### shortcuts（6）
- [x] `shortcut-search` 打开全局搜索（标题和正文）（desktop）
- [x] `shortcut-focus` 进入或退出专注模式（desktop）
- [x] `shortcut-move` 在搜索结果中移动（desktop）
- [x] `shortcut-open` 打开搜索结果并定位命中（desktop）
- [x] `shortcut-open-tab` 在新标签打开并定位命中（desktop）
- [x] `shortcut-esc` 关闭当前菜单或浮层（desktop）

### resources（1）
- [x] `search-rebuild` 重建全文搜索索引（desktop）

### history（6）
- [x] `history-stats` 快照占用（desktop）
- [x] `history-max-snapshots` 每文档上限（desktop）
- [x] `history-retention-days` 保留天数（desktop）
- [x] `history-cleanup-interval` 定期清理（小时）（desktop）
- [x] `history-snapshot-interval` 自动快照（分钟）（desktop）
- [x] `history-data-health` 一致性检查（desktop）

### sync（19）
- [x] `sync-enabled` 启用云同步（both）
- [x] `sync-auto-mode` 自动同步模式（both）
- [x] `sync-auto-interval` 自动同步间隔（分钟）（both）
- [x] `backup-export` 整库备份（desktop）
- [x] `backup-restore` 从云端恢复（desktop）
- [x] `s3-endpoint` Endpoint（both）
- [x] `s3-access-key` Access Key（both）
- [x] `s3-secret-key` Secret Key（both）
- [x] `s3-bucket` Bucket（both）
- [x] `s3-region` Region（both）
- [x] `s3-prefix` 对象前缀（both）
- [x] `s3-path-style` 使用 Path-style URL（both）
- [x] `s3-connection` 连接（both）
- [x] `gc-status` 回收状态（desktop）
- [x] `gc-retention-days` 回收窗口（天）（desktop）
- [x] `gc-interval-hours` 自动对账周期（小时）（desktop）
- [x] `gc-mirror` 云端只是镜像（desktop）
- [x] `gc-pending-list` 待回收键明细（desktop）
- [x] `gc-log` 删除记录（desktop）

### trash（1）
- [x] `trash-auto-purge-days` 回收站自动过期（天）（both）

### browser（2）
- [x] `browser-enabled` 浏览器端（desktop）
- [x] `browser-open` 打开浏览器（desktop）

### logs（1）
- [x] `logs-main` 主进程日志（desktop）

### about（15）
- [x] `about-app` Lake Notes（desktop）
- [x] `about-version` 应用版本（desktop）
- [x] `about-runtime` 运行时（desktop）
- [x] `about-deps` 内核与关键依赖（desktop）
- [x] `about-storage-stats` 内容统计（desktop）
- [x] `about-data-dir` 数据目录（desktop）
- [x] `about-workspace-dir` 工作空间（desktop）
- [x] `about-assets-dir` 资源目录（desktop）
- [x] `about-history-dir` 历史快照目录（desktop）
- [x] `about-logs-dir` 日志目录（desktop）
- [x] `about-diagnostics` 复制诊断信息（desktop）
- [x] `about-health-entry` 一致性检查（desktop）
- [x] `about-siyuan-license` 思源笔记 SiYuan（desktop）
- [x] `about-lakex-license` 语雀 Lake 内核（desktop）
- [x] `about-third-party` 开源依赖（desktop）
