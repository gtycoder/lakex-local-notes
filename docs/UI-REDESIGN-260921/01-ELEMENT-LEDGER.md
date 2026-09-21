# 01 · 元素底账（实现期唯一验收依据）

> 规则：**绝不丢功能 / 菜单 / 按钮 / 设置项**。以现网 DOM 与实际产品为准，设计包仅作参考。
> 本表在逐屏迁移时逐条打勾；打勾标准 = 该元素在新 UI 中仍存在且可操作。

来源：运行中应用 DOM（设置项 56 条 / 10 分类、外壳、导航）＋ 源码抽取（30 个组件 / 557 条文案）。
生成时间：2026-09-21 · 分支 feat/ui-redesign（基于 origin/master 17bafbe）

---

## A. 外壳与导航

| # | 元素 | 现状 | 新设计归属 | 打勾 |
| --- | --- | --- | --- | --- |
| A1 | 活动栏 · 资料库 | 活动栏 46px | 02 图标按钮 | [ ] |
| A2 | 活动栏 · 小记 | 活动栏 46px | 02 图标按钮 | [ ] |
| A3 | 目录栏头部 · 刷新目录 | 目录栏头部 34px | 02 图标按钮(22px) | [ ] |
| A4 | 目录栏头部 · 筛选目录 | 目录栏头部 34px | 02 图标按钮(22px) | [ ] |
| A5 | 目录栏头部 · 全部收起 | 目录栏头部 34px | 02 图标按钮(22px) | [ ] |
| A6 | 目录栏头部 · 定位到当前文档 | 目录栏头部 34px | 02 图标按钮(22px) | [ ] |
| A7 | 目录栏头部 · 新建 | 目录栏头部 34px | 02 图标按钮(22px) | [ ] |
| A8 | 工作空间 ▾ | 顶栏左 | 01 按钮 / 04 菜单 | [ ] |
| A9 | 同步入口 | 顶栏右 | 02 图标按钮 + 10 徽章 | [ ] |
| A10 | 全局搜索 | 顶栏右 | 02 图标按钮 | [ ] |
| A11 | 标签页（脏点/固定/关闭/溢出切换器） | 顶栏中 | 标签页规格 | [ ] |
| A12 | 状态栏 字数 / 图片 | 状态栏左 | 10 徽章 | [ ] |
| A13 | 状态栏 同步状态胶囊 | 状态栏中 | 10 徽章 4 态 | [ ] |
| A14 | 状态栏 冲突/错误提示 | 状态栏右 | 06 提示条 | [ ] |
| A15 | 面包屑行 + 大纲开关 | 工作区顶部 | 骨架规格 | [ ] |

## B. 菜单与下拉（逐项不得丢）

### B1 工作空间菜单（顶栏左）
- [ ] 偏好设置
- [ ] 回收站

### B2 文档操作菜单（顶栏右）
- [ ] 进入专注模式 / 退出专注模式（⌘⇧Enter）
- [ ] 锁定当前文档（只读） / 解锁当前文档
- [ ] 导出 ▸ 子菜单：HTML / PDF / 导出包 / 复制 Markdown / 复制路径

### B3 目录树节点菜单（右键 / ⋯）
- [ ] 新建文档
- [ ] 新建分组
- [ ] 新建表格
- [ ] 新建数据表
- [ ] 新建画板
- [ ] 新建笔记本
- [ ] 重命名
- [ ] 删除
- [ ] 复制
- [ ] 历史版本
- [ ] 移动到…
- [ ] 导出

### B4 编辑器卡片右键菜单（CardContextMenu）
- [ ] 使用默认程序打开
- [ ] 全选
- [ ] 剪切
- [ ] 另存为…
- [ ] 复制
- [ ] 复制图片
- [ ] 复制文件名
- [ ] 复制文件路径
- [ ] 打开文件位置
- [ ] 粘贴
- [ ] 重命名

### B5 小记工作台（卡片 ⋯ / 批量条 / 头部）
- [ ] >同步冲突副本</span>}<div className=
- [ ] 上传中
- [ ] 上传完成 → 回填 url
- [ ] 上次会话留下的死卡
- [ ] 从左侧写下第一条临时记录。
- [ ] 以为存了其实没存
- [ ] 保存
- [ ] 保存中
- [ ] 先清空再靠默认选中补回来
- [ ] 全选
- [ ] 全部
- [ ] 关掉再由默认选中补回来
- [ ] 关闭错误
- [ ] 内核刚回填 url 的几十毫秒窗口
- [ ] 切换前保存
- [ ] 列表视图
- [ ] 刚上传完 2s 内
- [ ] 删除
- [ ] 删除小记
- [ ] 卡还在上传中
- [ ] 取消
- [ ] 取消置顶
- [ ] 取消选择
- [ ] 可拖入或粘贴图片
- [ ] 同步冲突副本
- [ ] 复制失败：剪贴板不可用
- [ ] 复制文本
- [ ] 多选
- [ ] 小记
- [ ] 小记一下
- [ ] 小记版式
- [ ] 小记视图
- [ ] 小记资源暂存地址缺失
- [ ] 左边列表 + 右边内容
- [ ] 已删除一条小记
- [ ] 已复制小记文本
- [ ] 批量删除
- [ ] 按 ⌘ Enter 发布
- [ ] 排序
- [ ] 排序：按创建时间
- [ ] 排序：按更新时间
- [ ] 撤销
- [ ] 改没改过
- [ ] 放弃这次未保存的小记？
- [ ] 新建小记
- [ ] 新文档将插入其中的最顶部；
- [ ] 更多
- [ ] 更新于 08-04 14:16
- [ ] 有媒体还没上传完，已按当前内容保存
- [ ] 有没有内容
- [ ] 有没有改过
- [ ] 标签（暂固定为全部，分组功能后期做）
- [ ] 标签：全部（分组功能后期做）
- [ ] 正在编辑的是这份草稿
- [ ] 正在读取小记…
- [ ] 没动过的新草稿
- [ ] 没改动不写库
- [ ] 消失
- [ ] 点开列表里某条
- [ ] 点开编辑 → 切到别的
- [ ] 点按钮先关再开
- [ ] 确定删
- [ ] 空小记
- [ ] 编辑
- [ ] 编辑器里删掉卡片但资源仍在清单
- [ ] 编辑小记
- [ ] 置顶
- [ ] 请先在资料库中新建一个笔记本。
- [ ] 请先完成当前删除的撤销操作
- [ ] 请至少记录文字、一张图片或一个附件
- [ ] 转为文档
- [ ] 转为正式文档
- [ ] 转为正式笔记
- [ ] 还有附件在处理中，已按当前内容保存
- [ ] 还没有小记
- [ ] 退不出去
- [ ] 选择这篇小记
- [ ] 默认保存
- [ ] （无文字）

### B6 面板与对话框按钮
**src/components/TrashPanel.tsx**
- [ ] 关闭
- [ ] 其他设备已彻底删除；本机仍保留可恢复副本
- [ ] 加载中…
- [ ] 回收站
- [ ] 回收站是空的
- [ ] 小记
- [ ] 展开子项
- [ ] 已被他端删除
- [ ] 彻底删除
- [ ] 彻底删除（含全部内容）
- [ ] 彻底删除（含子项）
- [ ] 恢复
- [ ] 恢复（含全部内容）
- [ ] 折叠子项
- [ ] 文档
- [ ] 无标题
- [ ] 正在加载资源…
- [ ] 正文已删
- [ ] 正文文件已不在本机
- [ ] 清空
- [ ] 点击预览内容
- [ ] 目录
- [ ] 自动过期彻底删除倒计时（含云端）
- [ ] 该文档
- [ ] 该节点
- [ ] 该节点无可预览内容（目录或正文已删）
- [ ] 选择左侧文档查看内容

**src/components/HistoryPanel.tsx**
- [ ] · 加载中
- [ ] 关闭
- [ ] 创建快照
- [ ] 删除快照
- [ ] 加载中…
- [ ] 历史保护
- [ ] 历史快照保存在本地，不参与同步。恢复前会自动保存当前版本。
- [ ] 历史版本
- [ ] 当前内容与最近快照相同，未创建
- [ ] 快照弹窗不清理、还弹出上一次的内容
- [ ] 快照预览失败（文件可能已删除）
- [ ] 恢复此版本
- [ ] 恢复该版本会覆盖当前内容（含只读/锁定文档）？当前版本会先存入历史。
- [ ] 手动创建快照
- [ ] 文件预览失败（文件可能已删除）
- [ ] 文档历史
- [ ] 文档孤儿文件
- [ ] 暂无历史快照
- [ ] 未引用的资源文件（被历史引用的受保护，不会误删）。
- [ ] 没有孤儿文件
- [ ] 清理该文件
- [ ] 点击预览快照
- [ ] 点击预览文件
- [ ] 被远端覆盖时自动保留，保护期内不被自动清理（可手动删除）
- [ ] 选择左侧快照查看内容
- [ ] 选择左侧文件查看预览
- [ ] 闪一下

**src/components/NoteInfoDialog.tsx**
- [ ] · 已锁定
- [ ] · 有冲突副本
- [ ] 位置
- [ ] 关闭
- [ ] 内容统计
- [ ] 冲突
- [ ] 创建
- [ ] 加载中…
- [ ] 复制 ID
- [ ] 大小
- [ ] 字数
- [ ] 已同步
- [ ] 已复制
- [ ] 打开历史版本
- [ ] 打开文件位置
- [ ] 打开附件文件夹
- [ ] 收起
- [ ] 文件位置
- [ ] 文档属性
- [ ] 无附件
- [ ] 暂无历史快照
- [ ] 更新
- [ ] 未同步
- [ ] 根目录
- [ ] 状态
- [ ] 读取中…
- [ ] 预览

**src/components/SearchPanel.tsx**
- [ ] 个人笔记
- [ ] 关闭搜索
- [ ] 关闭（Esc）
- [ ] 只搜索文档，不含小记
- [ ] 搜索中
- [ ] 搜索标题和正文
- [ ] 搜索标题和正文（⌘K）
- [ ] 搜索结果
- [ ] 无标题
- [ ] 标题
- [ ] 正文
- [ ] 没有匹配结果
- [ ] 试试文档标题或正文关键词

**src/components/SyncStatusPopover.tsx**
- [ ] 上传
- [ ] 上次同步
- [ ] 下载
- [ ] 云+对钩
- [ ] 云端同步
- [ ] 云端同步状态
- [ ] 全部已同步
- [ ] 同步设置
- [ ] 待同步
- [ ] 无标题
- [ ] 暂无记录
- [ ] 查看历史
- [ ] 检测到远端版本差异，已保留历史快照
- [ ] 移入回收站

**src/components/SyncToast.tsx**
- [ ] 上传本地变更
- [ ] 下载远端变更
- [ ] 关闭
- [ ] 写入清单
- [ ] 去配置
- [ ] 同步完成
- [ ] 同步小记
- [ ] 连接 S3

**src/components/DraftRecoveryDialog.tsx**
- [ ] 丢弃这份草稿
- [ ] 发现未保存草稿
- [ ] 恢复这份草稿
- [ ] 无标题
- [ ] 稍后处理

**src/components/ExportSubmenuItem.tsx**
- [ ] 导出
- [ ] 导出为 HTML
- [ ] 导出为 Markdown 文本（复制）
- [ ] 导出为 Markdown 资料包
- [ ] 导出为 PDF（图片内嵌）
- [ ] 导出为 Word（开发中）
- [ ] 导出为原生 Lake（图片内嵌）
- [ ] 导出资料路径（本机 AI）
- [ ] 开发中

**src/features/attachment/AttachmentPreview.tsx**
- [ ] PDF 文档
- [ ] · 此类型不支持内联预览
- [ ] · 点击打开查看
- [ ] 关闭
- [ ] 压缩包
- [ ] 图片
- [ ] 在文件夹中显示
- [ ] 文件
- [ ] 文档
- [ ] 用系统应用打开
- [ ] 视频
- [ ] 附件预览
- [ ] 音频

**src/features/editor/ImageLightbox.tsx**
- [ ] 上一张
- [ ] 下一张
- [ ] 关闭
- [ ] 图片预览
- [ ] 放大
- [ ] 缩小
- [ ] 重置

**src/features/editor/AssetRenameDialog.tsx**
- [ ] 关闭
- [ ] 取消
- [ ] 扩展名不可修改
- [ ] 确定
- [ ] 重命名附件
- [ ] 附件名称

**src/features/outline/OutlineSidebar.tsx**
- [ ] 保持当前展开（选中项自动展开祖先）
- [ ] 全部展开
- [ ] 取消固定大纲
- [ ] 取消固定大纲，改为悬停
- [ ] 右侧工具栏
- [ ] 固定大纲
- [ ] 大纲
- [ ] 展开全部
- [ ] 展开到级别
- [ ] 折叠全部
- [ ] 暂无大纲
- [ ] 筛选大纲
- [ ] 调整大纲宽度

**src/features/outline/OutlineList.tsx**
- [ ] 展开
- [ ] 折叠
- [ ] 无匹配条目
- [ ] 暂无大纲

**src/components/DesktopStatusBar.tsx**
- [ ] 多维表
- [ ] 已锁定
- [ ] 当前文档状态
- [ ] 文档已锁定（只读）
- [ ] 文档统计
- [ ] 画板
- [ ] 表格

**src/components/DockFilterBar.tsx**
- [ ] 关闭菜单/浮层
- [ ] 有内容
- [ ] 看不见却在筛选

## C. 设置项（56 条 / 10 分类）

打勾标准：设置面板中仍存在，且设置搜索能用 `data-set-id` 命中。

### editor（4）
- [ ] `editor-font-size` 正文字号（both）
- [ ] `editor-outline-enhance` 大纲增强（desktop）
- [ ] `editor-max-open-tabs` 最大同时打开标签数（both）
- [ ] `editor-max-attachment` 附件大小上限（both）

### appearance（1）
- [ ] `appearance-theme` 主题（both）

### shortcuts（6）
- [ ] `shortcut-search` 打开全局搜索（标题和正文）（desktop）
- [ ] `shortcut-focus` 进入或退出专注模式（desktop）
- [ ] `shortcut-move` 在搜索结果中移动（desktop）
- [ ] `shortcut-open` 打开搜索结果并定位命中（desktop）
- [ ] `shortcut-open-tab` 在新标签打开并定位命中（desktop）
- [ ] `shortcut-esc` 关闭当前菜单或浮层（desktop）

### resources（1）
- [ ] `search-rebuild` 重建全文搜索索引（desktop）

### history（6）
- [ ] `history-stats` 快照占用（desktop）
- [ ] `history-max-snapshots` 每文档上限（desktop）
- [ ] `history-retention-days` 保留天数（desktop）
- [ ] `history-cleanup-interval` 定期清理（小时）（desktop）
- [ ] `history-snapshot-interval` 自动快照（分钟）（desktop）
- [ ] `history-data-health` 一致性检查（desktop）

### sync（19）
- [ ] `sync-enabled` 启用云同步（both）
- [ ] `sync-auto-mode` 自动同步模式（both）
- [ ] `sync-auto-interval` 自动同步间隔（分钟）（both）
- [ ] `backup-export` 整库备份（desktop）
- [ ] `backup-restore` 从云端恢复（desktop）
- [ ] `s3-endpoint` Endpoint（both）
- [ ] `s3-access-key` Access Key（both）
- [ ] `s3-secret-key` Secret Key（both）
- [ ] `s3-bucket` Bucket（both）
- [ ] `s3-region` Region（both）
- [ ] `s3-prefix` 对象前缀（both）
- [ ] `s3-path-style` 使用 Path-style URL（both）
- [ ] `s3-connection` 连接（both）
- [ ] `gc-status` 回收状态（desktop）
- [ ] `gc-retention-days` 回收窗口（天）（desktop）
- [ ] `gc-interval-hours` 自动对账周期（小时）（desktop）
- [ ] `gc-mirror` 云端只是镜像（desktop）
- [ ] `gc-pending-list` 待回收键明细（desktop）
- [ ] `gc-log` 删除记录（desktop）

### trash（1）
- [ ] `trash-auto-purge-days` 回收站自动过期（天）（both）

### browser（2）
- [ ] `browser-enabled` 浏览器端（desktop）
- [ ] `browser-open` 打开浏览器（desktop）

### logs（1）
- [ ] `logs-main` 主进程日志（desktop）

### about（15）
- [ ] `about-app` Lake Notes（desktop）
- [ ] `about-version` 应用版本（desktop）
- [ ] `about-runtime` 运行时（desktop）
- [ ] `about-deps` 内核与关键依赖（desktop）
- [ ] `about-storage-stats` 内容统计（desktop）
- [ ] `about-data-dir` 数据目录（desktop）
- [ ] `about-workspace-dir` 工作空间（desktop）
- [ ] `about-assets-dir` 资源目录（desktop）
- [ ] `about-history-dir` 历史快照目录（desktop）
- [ ] `about-logs-dir` 日志目录（desktop）
- [ ] `about-diagnostics` 复制诊断信息（desktop）
- [ ] `about-health-entry` 一致性检查（desktop）
- [ ] `about-siyuan-license` 思源笔记 SiYuan（desktop）
- [ ] `about-lakex-license` 语雀 Lake 内核（desktop）
- [ ] `about-third-party` 开源依赖（desktop）
