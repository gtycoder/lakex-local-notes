# 正式包性能验收（opt-in，macOS arm64）

这是**测量装置**，不添加产品加速参数，不连接真实云，也不改正式数据。先读项目 AGENTS 与 `docs/CODEX-GUIDE.md`。

## 已覆盖的工作

- 真实 `.app`：`app.isPackaged=true`、`lake://app`、默认 GPU、sandbox/contextIsolation 开启；不得加 `--disable-gpu` 或 `--no-sandbox`。
- 5000 篇文档 + 20000 个 4KiB 合成附件（约 78MiB 附件，不代表 20GB 传输）。媒体字段来自真实编辑器插入附件的序列化。
- 空应用缓存启动 3 次 / 同数据缓存启动 3 次；不是重启电脑后的磁盘冷启动。
- 富文本（普通 / 约512KB / 约2MB / 24附件）、表格（1000/5000×20）、多维表（200/5000×20）、100图形画板。
- CDP `Input.insertText` → rAF 与落盘回读；程序化长文滚动 → rAF；真实鼠标进入/退出分屏。
- 默认8标签下的标签点击 → rAF；目录展开/收起的同条件CPU profile。
- 真实 packaged 主进程 + S3 SDK + 本机 S3测试服务（仅监听127.0.0.1；每请求延迟1500ms），测整轮同步在途时切标签与保存（本轮是5文档增量，未上传全部2万附件）。
- JSON、截图、CPU profile、日志。成功或失败均回收本脚本启动的进程；默认删掉生成的运行数据目录，夹具保留。

## 一次准备

1. 冻结源码与依赖后构建真实包，避免其他会话或 HMR 改变测量对象。
2. 保留源码 hash、版本、构建日志与 `app.asar` hash。`vendor/lakex-doc-react/dist` 是必要输入，复制时不能被泛用 `--exclude=dist` 意外排除。
3. 性能用包可以跳过 Developer ID 签名，但这**不是正式分发验收**；签名、公证和首次安装启动另验。命令：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
# 在冻结副本中执行，不覆盖用户正在使用的产物
npm run build:web
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --mac --arm64 --publish never -c.mac.identity=null
```

## 造夹具与运行

所有下面的环境变量都只用于本次命令，不写真实设置或仓库凭证：

```bash
export LAKE_PERF_APP="/absolute/path/LocalLakeNotes.app/Contents/MacOS/LocalLakeNotes"
export LAKE_PERF_SEED="/tmp/lake-packaged-perf-seed-<unique>"
export LAKE_PERF_TEMPLATE="/absolute/path/fixture-template.json"
node scripts/packaged-performance/seed.mjs

python3 -B scripts/packaged-performance/make-fixture.py \
  --seed "$LAKE_PERF_SEED" --template "$LAKE_PERF_TEMPLATE" \
  --output /tmp/lake-packaged-perf-fixture-<unique>

export LAKE_PERF_FIXTURE="/tmp/lake-packaged-perf-fixture-<unique>"
export LAKE_PERF_EVIDENCE="/absolute/path/evidence"
node scripts/packaged-performance/run.mjs
```

- seed 使用新目录；已有目录会拒绝，不做自动删库。`seed.mjs` 默认使用CDP9271 / 资源19871；先查端口无人占用。
- run 检查夹具路径 + 5000/20000元数据标记；各运行库从该夹具复制，源夹具不修改。
- run 可用 `LAKE_PERF_CDP_PORT`（默认9271；main inspector = +1）、`LAKE_PERF_ASSET_PORT`（19871）、`LAKE_PERF_S3_PORT`（19872）换独立端口；占用时直接报错。
- 默认清理运行库，`LAKE_PERF_KEEP_DATA=1` 可保留排查；**这里只能保留/清理测试目录**。
- 测试时需要保持窗口前台。脚本主动 bringToFront，检查 document.hidden；不可把后台节流测成产品卡顿。CDP指针命中与系统实际窗口焦点仍有诊断开销。
- “点击→rAF”不是物理屏幕光子延迟；“canvas出现”不是完整网格验收。截图 + 到达断言 + 计数应一起读。
- n=3 的启动结果只报告中位数与范围，**不要把它的p95当统计稳定值**；其他小样本p95同样是尾样本参考。
- ASAR/缓存存在只证明机制可用，不证明是唯一加速原因；warm与cold包含其他初始化差异。

## 本轮证据

2026-10-13 的正式包 hash/原始测量/截图/日志在项目 `.css-audit/packaged-perf-261013/evidence/`（gitignored）。结果和后续事项只在 HANDOFF §0/§3 维护；不维护第二份待办。

已验证 seed → 造夹具 → 完整run成功、真实package烟测成功、冻结桌面范围单测199文件/1684例通过。冻结副本的全库单测包含Android文件缺失/移动样式基线失败，详见HANDOFF，不能宣称全库门禁绿。

## 目录行优化回归

`sidebar-regression.mjs` 用全新隔离数据目录验证公共目录UI（不是私有组件测试）：真实点按/拖拽、重命名/锁/创建/删除恢复、浮出目录、三主题×宽窄窗。

```bash
LAKE_PERF_APP="/absolute/path/LocalLakeNotes.app/Contents/MacOS/LocalLakeNotes" \
LAKE_PERF_EVIDENCE="/absolute/path/sidebar-evidence" \
node scripts/packaged-performance/sidebar-regression.mjs
```

默认使用CDP9281、主进程inspector9282、资源19881；先确认端口无人占用。只创建 `/tmp/lake-sidebar-regression-*` 并回收owned child/数据，不接受真实workspace。隐藏行按钮先hover，建文档后处理自动标题弹窗，重载需等待新页面。结果含 `sidebar-regression.json` 与主题/浮出截图；恢复与部分造数据走IPC，其余菜单与拖拽是真实鼠标。


## 多维表正式包回归（行窗口）

`npm run test:bitable:packaged` 顺序跑两个独立实例，共23项业务检查；保留完整5000×20模型，覆盖屏外键盘/末行组合输入、5000行复制、粘贴撤销重做、拖拽、只读、隐藏标签、字段与双向关联、统计/填色刷新、附件与Markdown等。

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
export LAKE_PACKAGED_EXECUTABLE="/absolute/path/LocalLakeNotes.app/Contents/MacOS/LocalLakeNotes"
export LAKE_PERF_FIXTURE="/tmp/lake-packaged-perf-fixture-<unique>" # 上文造出的5000文档/2万合成附件库
export LAKE_PERF_EVIDENCE="/absolute/path/evidence-parent"
# 可选：LAKE_PERF_CDP_PORT=9301（main inspector=+1），LAKE_PERF_ASSET_PORT=19901
npm run test:bitable:packaged
```

- APP/夹具路径必须显式且绝对；夹具必须落在`/tmp/lake-*`（允许macOS实际路径`/private/tmp`），目标模型必须5000×20；端口被占用即拒绝。
- 实例只写新建临时数据目录，不读真实密钥、不接真实S3；复制粘贴使用页内隔离端口，不改用户系统剪贴板。
- 运行期核对packaged/GPU/sandbox/contextIsolation，禁止以关闭GPU或sandbox的结果冒充真包验收。只收尾自己启动的child，正常退出清理运行副本。
- 输入时间为CDP指令到rAF回执，组合输入为CDP模拟，不等于人工IME候选窗或硬件键到像素呈现。
- 检查点与日志位于`$LAKE_PERF_EVIDENCE/evidence`，失败不能标成功；可单独运行`bitable/business.mjs <检查名子串>`。
- 用户接受目标5000×20主要操作不到秒级；毫秒级尾延迟是继续观察项，不以33/50ms参考预算阻止已通过正确性/内存门禁的接入。低内存/长时/真实图片仍是发布前验收项，见`docs/BITABLE-VIEWPORT.md`。
