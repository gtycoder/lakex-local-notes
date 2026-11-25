# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留**【最近 3 个批次 + 当前基线 + 风险 + 真实待办】**；更早的 dated 批次只存在于 git 历史（`git log -p --follow docs/HANDOFF.md`），**不要再往本文件堆批次流水**（261112 Q17 压缩：183KB → 本版）。
> **当前状态以 §1（基线）/ §2（风险）/ §3（待办）为准**；§0 抬头状态只作批次历史。261112 第二轮裁决（Q01–Q27，最终）见 docs/audit-261112/00-MASTER-PLAN.md 附录 E（保留件，分册已删）。
> 移动端（Android）的构建 / 安装 / AVD / CDP / 门禁 / 点按口径 = [docs/MOBILE-OPS.md](MOBILE-OPS.md)；桌面会话不要改它，移动端会话不要改桌面文件。

## 0. 最新交接（最近 3 个批次；更早的见 git）

- **261125 · 终审裁决批（9 裁决全落地；确立「无历史版本」口径）**：用户裁决「只有我一个用户、当没有历史版本做功能、不保留数据兼容代码」⇒ ①**12 处历史迁移/兼容彻底删**（enc:v1 分支、published_at 水线回填、tag_absent 迁移+tags.deleted_at 墓碑列、rendererLogLevel 旧签名（核实 Electron 44 后删）、移动 schema 残列清理/created_at 回填、localStorage 兜底×3、mobileDeviceStore 旧 staging map、兼容挂法/旧名 re-export、firstEncounter 旧键形容忍、quick_note_sync_base 表收敛、旧信封迁移+salvagedAssetsOf 抢救投影（验证先行：现行写入恒 v2 后删，未知信封=按空有测试钉））；**现行数据读取面全部保留**（inkDoc 读 1|2|3|4、restoreEscapedCards、portable 拒 1 闸/mobileToDesktop、es2024Fallback、schema 建表补列、FTS/usheet 自愈等，删了伤用户自己数据的都不动）；②R-01 大纲选中 3px 色条删净→标准选中高亮；③R-04 多维表 1px 边框**原语化** `--bt-panel-border`（收编 47 处、内容区表格线豁免不动，DESIGN Shapes 登记例外）；④T-06 桌面补 primary+danger 红底白字（两端同模型；附 kernel-theme 文字色补钉防红底红字）；⑤S-02 侧栏面板定稿**平面版**（用户看对照图裁决；卡片派副本删净、几何收单源）；⑥release/ 604MB 构建残留删；⑦桌面复制全量接管=用户裁决保留（AGENTS §4 契约写实）；⑧**mobile-snap 门禁重建**（lake_gate 重灌夹具+重烤 10 态基线两轮 0 差异；gate-fixture 适配 nodeType 改名与默认笔记本回落；「lake_gate 只跑门禁、其它测试另起实例」规矩入 scripts/mobile-audit/README 与夹具头注释）。
  - **门禁（261125 裁决批实测）**：全量 vitest **1126 文件 / 7242 例 0 failed**；tsc 双 0；gradle compileDebugKotlin 0；ui-metrics 0（!important 5 / 跨文件重复 28≤33 只降）；check:core 187 文件 0；check:mobileui 过；check:bundle+arch PASS（desktop 582,904/592,000、mobile 327,275/345,000）；diff-check 0。
  - **待装机/视觉**：移动含图剪切（cut 修复）、原子写/便携包抽查、stylesnap 受影响态（hover-row/目录选中/设置页/大纲选中）、guide 3 张截图重拍。
- **261125 · 开源前终审 + 无裁决实施批（7 流并行）**：终审 = 五流只读审计（`docs/audit-261125/`：00-MASTER + 5 明细卷；88 条方案 + 8 裁决点 A~H + 59 条「不建议做」）；实施 = 裁决无关部分全落地。**bug 级**：D-01 cut 删除口径分叉修复（共享桥 `deleteSelectionKernelFirst` 内核命令优先/DOM 兜底，AGENTS §4 契约写实，移动含图剪切待装包复验）。抽提收口：C-01 回收站子树 CTE（`electron/sql/treeFragments.ts`，UNION 防环统一+purge UPDATE 重复 SET 清理）/ C-02 拒写判据 `isGoneRow` / C-03 日记归属 `diaryAncestry` 单源 / D-02 上传自愈 hook 化 / D-07~09 卡片编解码·资产 URL·导入队列收口 / D-12 零引用 13 符号+转发壳清理 / M-02 回收站两路边集共享场景表对拍（`core/trashSubtreeScenarios`）。移动批：M-01 sql.js 出产物（**移动首屏 342,703→328,127B**）/ M-03 Kotlin 原子写 `AtomicFiles`（5 写点+过滤器三历史命名兼容）/ M-10 S3 Secret 策略上收 `core/s3SecretPolicy`（桌面「留空=沿用」改先裁决后校验）/ M-16① 路径检查 `isInside` 收口 6 处。样式批：S-01/03/04/05/06、T-02/03/04、R-02 —— **!important 9→5**、跨文件重复组 45→33、`--shell-*` 别名清零。文档批：G-01~11（密钥口径 6 处按 261204 裁决纠偏、便携包入口纠偏、卸载保留数据口径、**guide/20-tips.md 使用技巧新章 TIP-01~11**、README 下载与安装）。清理批 X-01~08：删 111 文件 + 1.5G 废弃 worktree + 垃圾（.css-audit 80M→5.6M 保 perf 基线；release/ 604MB 留裁决点 G）；audit-261112 只留 00-MASTER-PLAN（附录 E 裁决），G1-G18 越界清单搬 `SYNC-PROTOCOL §9.6`、21 号多端方法搬 `scripts/multi-end-sync/README`；全仓 Markdown **0 死链**。
  - **裁决点未动（00-MASTER §3）**：A tag_absent 迁移删除时机 / B 最低升级版本声明（8 处迁移删除总闸）/ C EditorTab 全量接管去留 / E 大纲 3px 色条 / F 多维表 1px 边框 / G release/ 去留 / H primary+danger 组合 / S-02 侧栏几何双写两派取值（新并入）。~~D 设置导航选中色~~ 已关闭（S-03 核实生效值即 bg-selected，与 DESIGN 一致，无须选）。
  - **实施中纠偏审计卷 8 处**（TIP-07 素材随包、S-03 前提、T-03 漏 .ne-code、T-04 漏 outline:189、X-02 已修项不立假待办、C-01 WHERE 形态、M-01 动态 ?url 回归改静态 import、D-08 档位值入参保 Retina）。
  - **门禁（261125 实测）**：全量 vitest **1124 文件 / 7228 例 0 failed**（新护栏 ~140 例）；tsc 双 0；ui-metrics 0（!important 5 / 重复组 33）；check:core 187 文件 0；check:mobileui 过；check:bundle+arch PASS（desktop 582,941/592,000、mobile 328,127/345,000、entry 44,757/46,000）；diff-check 0。
  - **待装包/视觉验证**：移动含图剪切、原子写/便携包抽查、stylesnap 三态（hover-row/目录选中/设置页）、guide 3 张截图重拍。
- **261205 · 密钥自管理 + 标签接入 + 同步面板 B' + 移动端四项（v1.6.4）**：①密钥全自管理（`560d0b19` 自管理换底 + `8c4b93a8` 删 enc:v1 读分支/Keystore 迁移 —— 用户裁决「不为历史数据写代码」，升级后各端密钥重填一次）；②标签接入云按钮与同步展示（`4cd39e7a`：tags_pending 计数、成功清零、报告 uploaded/downloadedTags）；③同步弹层 B' 双列网格（`43bcf8f8`：A/B/B' 三方案截图对比后用户定稿，禁换行红线极端值压测）；④移动端四项（本批）：同步气泡成功顶替 + A 方案悬停/长按明细/双关（toastBus.detail）、打标签面板搜索收起+不弹键盘+高度拉高、新建文档直进编辑（kind 触点钉 7→8）、设置页细分补标签。样式棘轮按惯例带说明上调（components 391→415、quick-notes 277→289、floating 320→331）。
  - **review 查漏**：逐簇复核 A/B 两批 22 提交，**抓到 1 处真漏** —— A4 的 dfp 保留只修了 notes 行，tree_nodes 的 2 处 UPDATE + 1 处 INSERT 仍无条件覆盖 null（桌面侧新回归 `electron/dfpPreserve.test.ts` 当场打红后补齐，`874dca53`）；另查 A5 兄弟 upsert、folder apply 同类 COALESCE、quick bodyFailed 抑制残留等面，除上述外无漏（结论记录见提交）。
  - **P3 全清（Batch C，22 项中 21 项落地 + 1 项待复现登记）**：索引校验补洞（`e4b99178`）/ 快路径三修（`83e24ddf`）/ 发布读回+unchanged 清理+深清新鲜度下限（`1263a377`）/ 排序+纯文档父判定+移动深清平价（`de9cc660`）/ ⑤ 组三件（`77818646`）/ 环告警独立码+批窗口补提交+判据前提注释（`d9cba06f`）/ 正文「未变才应用」补真（`5f6f23f4`）/ keepLocalTrash 两修（`ed2dd2b2`）/ 日记复活特征钉+A4 桌面补漏（`874dca53`）/ deleteMany 吞错（`59c568c6`）。
  - **语义变更 2 处已钉**：深清 retentionDays=0 从「立即全删」改为「锁 TTL 外才删」（防删他端刚上传未切 pointer 的对象）；目录 keepLocalTrash 对齐文档侧「绝不隐式恢复」（B1 裁决语义一致）。
  - **待复现/未修（登记）**：⑤P3-3 快照合成失败残留旧基线（三重叠加极小概率）；B9 残留两条（合成失败旧基线 / Batch4-A 不换 sync-v3）。
  - **v1.6.3**：发布说明按用户视角重写（复查补漏置顶）。
- **261124 · 审计 Batch B 修复批（v1.6.2）**：
  - **修复（B2–B9 全清，护栏先行、逐条/逐簇提交）**：B4/B6/B7 桌面恢复收尾三修（`9ba523d3`）/ B2 小记空 tagIds 显式发布（`d2733d26`）/ B5 fieldChanged 投影归一（`18f47dab`）/ B3 download-to-trash 两处（`d0b9c10f`）/ B8 全 8 项（`b483026f` `b1fea0f2` `a9f0cdfe` `789185ec` `3f5f4b8e`）/ B9-F9 便携保真（`5d2f3136`）。新护栏 ~22 例，全部先红后绿；**3 处夹具假绿当场抓改**（空集合形状 / quick 正文路径 / sql.js 无 FTS5 索引空转），教训已入注释与提交。
  - **B9 残留（登记）**：「合成失败残留旧基线」「Batch4-A 只换两库不换 sync-v3」两条为待复现场景未修；B1 的 folder download-to-trash 偏差为用户裁决语义（非 bug）。
  - **v1.6.2**：发布说明 = 15 处 P2 修复按用户视角重写。
- **261124 · S3/数据流程五流审计 + Batch A/P0 修复批（v1.6.1）**：
  - **审计**（用户点单「团队并发 + 目标模式」）：五条并发审计流（合并决策/应用落库/发布协议/生命周期与写守卫/迁移基线）只读详计，报告 `docs/audit-261124/`（00-MASTER + 5 分册，833 行；已删，git 可查，未修清单已摘进 §3）；发现 9×P1、~12×P2、~21×P3（6 待复现），主卷对 7 条最重发现二次抽验 0 虚报。**B1 用户裁决「删除目录必级联子树」⇒ 升 P0**。
  - **修复（10/10，护栏先行、逐条带回归、逐条独立提交）**：P0-B1 首相遇目录改写层（`31ff56d7`）/ A1 pull-all 不物删未同步小记（`78368006`）/ A2 恢复回滚误删活库（`9a1c2376`）/ A3 瞬时读失败不收敛删除（`c432bb85`）/ A5 保存不误清 restore_pending（`3a6f3184`）/ A6 元数据 LWW 与锁正交（`b48e6a3c`）/ A7/A8 失败轮不回滚本地 + 下载失败重试闭环（`024156c1`）/ A4 dfp 跨端链（`ab5e8a5a`）/ A9 便携包 tree id 不变量（`27cbfd99`）。语义订正两处已钉入测试：「基线在场 ≠ 删除意图」「绝不物删（清扫 discardQuickNote 退役）」。
  - **修复后的残留边界（登记）**：A8 的可疑抑制依赖 bodyRecoveryPending 跨轮（信封持久化，移动端平台队列 no-op 已由信封并集覆盖）；B 批（firstEncounter folders download-to-trash 偏差、④F1 级联恢复 restore_pending、③P2-3 fieldChanged 双形态 diff 等）与 P3 清理、40 条护栏建议未动 —— 待办见 §3。
  - **v1.6.1**：发布说明 = 10 条修复 + 找回口径（受影响数据只是位置/状态，内容都在：搜索标题找回、拖回原位）。
- **261124 · P0「同步丢子文档」复现与双端修复 + v1.6.0 发版**：
  - **P0 现象**（正式 APK 稳定复现）：迁入（便携包）后一发生 S3 同步，**父级是文档**的子文档就从笔记本消失（03-收集 21→18、09-交易 31→30；录屏 ↓1 上传 0）。**空桶真 S3 双设备复现**（`src/mobile/v3/childDocs.s3.integration.test.ts`，用用户指定前缀 `lakex-notes-dev3`，测完自动清空）：同设备空桶首传当轮 `child-doc` 的 `parent_id` 就被改写；第二台首拉父子双双落 `notebook-uncategorized`。
  - **根因**（探针定位）：① `resolveRemoteParent`（共享编排 `core/s3v3/state/deviceStore.ts`）只查目录不认「文档当父」⇒ 每轮 saveState 的 apply 把子文档 parent 改写到兜底本（`metaDiffers` 拿改写后 parent 做 diff ⇒ **每轮必写**、手动移回也再被改、下轮还会把脏 parent 发布上云）；② 移动端 `importRemoteNote` 在 beginWriteBatch（executeSet）窗口落库，同批新行 SELECT 不可见 ⇒ 父子同批首拉双双落兜底本。**修复**：解析链 = 目录 → 文档（hasNote）→ **本轮世界作用域**（现有行 ∪ 待写行）→ 兜底本；saveState 先建 parentScope 再落库；真缺失父仍走 C5 兜底（语义不变）。修复前复现测试 2/2 红、修复后 2/2 绿；同步核心护栏 83 例全过。
  - **用户数据口径**：中招子文档**未被删除**、只是被挪走 —— 搜索标题即可找到，拖回原位后不会再丢（修复随 v1.6.0 发布；正式 APK 需升级）。
  - **v1.6.0 发版**（1.6.x 号，用户点单）：版本 bump（Android versionCode 派生 11600）+ 发布说明 = 回收站小记预览（两端）+ 小记列表三修 + 3 个真问题修复 + **本 P0**；stylesnap 基线重烤（42 态，归因：261120 二级新建菜单 +19、设置文案/回收站面板 DOM、其余为采集时序族 —— 三实例对拍 final==r4、after 孤例；settings-about 在 FLAKY_ASYNC 名单内）；tag `v1.6.0` 双推（Gitee+GitHub，tag 触发 Release workflow）。
  - **测试基建坑（登记）**：SqlJs 内存库在 vitest 里共用 BodyStore 根 ⇒ MobileDeviceStore 基线文件（`sync-v3/baseline.json.gz.b64`）串库（A 的基线被 B 读走）——多设备测试必须 `setBaselineFileForDbForTest` 注册独立基线路径（复现测试已内建）。
  - **顺带修复（同日用户点单）**：移动「恢复后小记消失」（restore_pending 被当可见性过滤）+ 移动预览层长标题把「恢复」挤出屏（两层 flex min-width:auto）+ ui-metrics 未定义令牌红（--lake-font-size-base → body）。
  - **门禁**：tsc 双 0；全量 vitest **7088 passed / 1 failed = 已知 flaky perf.integration（单跑 PASS）**；ui-metrics 0；check:core 185/0；check:mobileui 过；check:bundle+arch PASS；stylesnap 32 严格态 0 差异（重烤后自检）；diff-check 0。
- **261124 · 回收站小记预览（两端）+ 小记列表三修 + 两处门禁红清零（6 代码提交，未发版）**：
  - **回收站小记预览（用户点单「要和文档一样的预览方式」）**：桌面 `TrashPanel` 小记页签并入文档同一个 SplitPane（小记行包 `.trash-tree-node` + `trash-row-text`，task-89/105 行规则原样复用、不写第二套），右列复用 `NoteDocPreview(policyKey="trash")`；数据面新增只读口 `readTrashQuickNote`（墓碑 + 软删保留的 `.qnote`，零状态变化、缺文件明确失败）+ 新通道 `read_quick_note_trash`（register/preload/WEB_METHODS/native 四面，**196→197**，parity 已更新）。移动 `TrashList` 小记行可点（kind note/quick）→ 同一个 `TrashPreviewPage`（`itemKind="quick"`：读本机 .qnote、不做资源补拉、恢复走 restoreQuickNote、读不到给占位不挂空 viewer）。
  - **顺带修两个真问题**：① ui-metrics 红 = `--lake-font-size-base` 未定义 ×2（image-lightbox / mobile features.css，5393cefe 引入、HEAD 即红）→ `--lake-font-size-body`（与失效时继承值同档，观感不变）；② 移动预览层两层 flex `min-width:auto` 连锁：长标题把预览页撑到 2027px、「恢复」x=1955 出屏（562 视口实测）→ `.mobile-topbar-title` 与 `.mobile-settings-preview .mobile-document` 各补 `min-width:0`（mobile.css 1496→1498）。
  - **移动「恢复后小记消失」（真机复现）**：`restore_pending_at` 被 7 处当可见性过滤（未开云同步 ⇒ 标记永不清 ⇒ 恢复的小记从时间线/搜索消失；DB 实测 deleted_at=null + 标记已写）→ 可见性一律只看 `deleted_at`（restore_pending 只服务重传，同步路径未动），恢复行由 reconcile 下次搜索重建索引；真机复验冷启首页立即显示。
  - **小记列表三修（261124 用户四轮点单，均隔离实例 CDP 复现 → 修后复测）**：① **版式切换丢正文/保存覆盖旧版（数据丢失）** —— 切版式 = composer 换位重挂、种子 = draft.body 初值 ⇒ 正打的字喂给旧正文、再保存把磁盘覆盖成旧版（实测 A、B 双丢）→ `switchView` = `flushEditorMirrors()` → `saveBeforeSwitch()`（空放行/无改动不写库/**有改动自动保存**，失败不拦）→ 成功收起编辑 → 再切；复测 db = " TYPED-A TYPED-BORIGINAL-BASE" 全保住。② **「点新建小记没反应」** = 清空后被「默认选中第一条」(260919) 立刻抢回 + 冷启 ensureDetail 晚到竞态 → `startNewDraft` 回传是否真切换才置 autoSelectHold（离开列表视图/空间撤销）+ `editIntentRef` 意图代际作废晚到 startEditing；复测点击后 focus=0、右栏=新建空草稿（含冷启动首跑）。③ **列表内切换/离开页保存闸统一「无条件过闸」**（点另一条 / 类型·标签·时间筛选 / 搜索 / confirmLeave / startNewDraft；dirty 预判只看文本镜像会漏正文级改动；saveBeforeSwitch 内部本就空放行、无改动不写库）。
  - **门禁**：tsc 双 0；全量 vitest **7089 passed / 0 failed**；ui-metrics 0（未定义令牌清零）；check:core 185/0；check:mobileui 过；check:bundle+arch PASS（desktop 582.4/592KB、mobile 342.1/345KB、entry 44.6/46KB）；diff-check 0。**真机**：lake_mobile 5554 装包点收（回收站预览截图 `/tmp/mb-final-preview.png`、恢复可见 `/tmp/mb-home-restored.png`；⚠️ 该机多虚拟屏、0 屏是白的，screencap 要 `-d <app 屏>`，屏号重启会变）；桌面隔离实例端到端（`/tmp/lake-trash-preview-shots/`）。**mobile-snap 门禁受阻（先于本批）**：lake_gate 数据已非固定夹具 ⇒ 未重烤、等裁决（§3）。

- **261124 · 数据事故复盘批 + 三需求（v1.5.10）**：
  - **事故（正式数据，用户报「4 篇文档被删」）**：迁移丢行（真机间歇性、重试即好）× 配置指纹不一致（region 默认值两端不同）× 「以本地为准」把基线认识的文档当「云端多出」发布成已删 ⇒ 他端整批进回收站；次日恢复又因原位置指针丢失静默回落「01-生活」。全程只读取证（真包拆解 + 真 UI 导入复现 + 真 planSync 场景单测），**内容零丢失**（正文/附件全在，4 篇在 01-生活，用户自行拖回）。
  - **五修复**（`e25c85a9`/`f8333981`/`c92cda44`）：① 首次相遇破坏性改写**豁免基线已知条目**（basePresent）；② 导入**写后逐表计数复核**（去重主键口径，缺行整包失败留回滚副本，摘要报实测值）；③ sameSyncTargetKey **目标身份忽略 region**（兼容旧四段式键）；④ 恢复**如实报落点**（restoreTrashItem 返回 parentId/parentTitle/fellBack → 回收站横幅）；⑤ trashOverride 原父取值顺序修复（wire deletedFromParentId → parent，不再被位置合并的 null 覆盖）。plan 级事故回归 ④+① 钉死。
  - **三需求**（`4acec2a2`/`5393cefe`）：图片预览**长按「保存到手机」**（共享 Lightbox 只挂长按动作槽 + 移动层注册保存；localKey 原生直读进相册；长按走 lib/longPressTimer 唯一实现、触发吞 click）；**同步气泡**（点云即弹「正在同步」、进度同 id 覆盖进气泡、顶栏 P0-6 进度条拆除）；**region 默认 cn-north-1**（S3_DEFAULTS + 迁移码兜底）。
  - 契约回填：SYNC-PROTOCOL §21（豁免/原父取值/去 region）+ PORTABLE-TRANSFER §3（写后复核）。style 围栏 pin 随批（image-lightbox.css 57→80、mobile/features.css 153→175，均为新增规则非覆盖）。
  - ⚠️ 未尽事项：手机那次丢行的**底层竞态**（读取/写入哪一环）未定位到点——防线是响亮失败 + 重试；如再现请留 log。img-save 子代理曾异常退出（零残留，lead 手工重做）。
  - 门禁：全量 vitest **7073 passed**（真退出码）+ tsc 双 0 + check:arch 过。

- **261123 · 三次批：密钥去钥匙串 + 目录丝滑展开 + 首次相遇语义收口 + 清欠账（未发版）**：
  - **密钥存储改「本机加密」（用户裁决：不弹钥匙串授权框）**（`4bc7127d`）：AES-256-GCM + 每安装随机钥匙 `<userData>/machine.key`（0600、原子落盘、**不进备份/便携包**——实测证明）；读路径兼容 enc:v1:（safeStorage）惰性迁移 enc:v2；口径 = 防误读、非安全边界（README/SECURITY/ARCHITECTURE 等 7 处文档同改）。参考答案 = 思源硬编码 AES（kernel/util/crypt.go）；我们比它多一层「每安装不同钥匙」。
  - **目录展开丝滑化 + 闪烁根因**（混装 `4bc7127d` + 补收 `7c2a21fc`）：闪烁真凶 = **拖拽预武装**（按下即 setDraggingId ⇒ 行闪灰 .38），改 `dragMoved` 门控（越过 5px 阈值才染灰）；Finder 式 **250ms 高度动画**（TreeChildren：只动被点容器、打断续播、0px 防回闪、reduced-motion 兜底、稳态零过渡 ⇒ 42 态快照无需重烤）；261122 被杀的逐层入场动画未复活。DESIGN Motion 已登记「树展开高度动画例外」。
  - **首次相遇语义收口（清 first-sync-gate 欠账 + 挖出 5 个真缺陷）**（`fd6ff76e`/`5e7b5d8b`/`e26f04c5`）：① mode 泄漏到后续轮（用户每次编辑被 cloud-wins 吃掉）⇒ 门控 roundOpts；② 空发布抖动（remote-purged-trash 置 indexChanged / folder 上行 / 元数据漂移）⇒ 发布排除守卫 + cloud-wins 元数据采纳远端；③ 无基线覆写不留档 ⇒ 保守留历史；④ quick 无基线分支 `bb?.contentHash??null` 恒判双变 ⇒ 无谓下载；⑤ 空设备被合并轮误路由 ⇒ 保留全量重拉（原生 getToFile 资产下载）。283 处老测试显式选择合并方式 + 3 夹具修正。**全量 vitest 7064 例 0 红（真退出码）**。
  - ⚠️ **收口纪律失误登记（第 2 次）**：`4bc7127d` 的 `git add -u` 又混装了 tree 批 5 文件（内容无损、账目混合，`7c2a21fc` 补收漏网测试）；另 lead 两次被 `| tee`/`| tail` 管道吞退出码误报「全量绿」（与 v1.5.7 CI 同病）——**教训：显式文件清单提交；验证命令禁用管道接尾**。
  - 门禁：全量 vitest **7064 passed / 0 failed**；tsc 双 0；ui-metrics 0；git diff --check 0。

- **261123 · 二次批：「云端首次相遇」特性 + 第三方粘贴专案（未发版）**：
  - **首次相遇（9 提交 2bde53e3…2da748ac）**：配置探测三态（保存且 endpoint/region/bucket/prefix 变更即重探；迁移码导入视同变更）+ 首次同步询问（事实行 N/M/K + 五选项：智能合并/只增不删（仅一次）/以本地为准/以云端为准/取消；被覆盖方一律进回收站**可恢复**）；ask-once 与换目标重问 = targetKey 盖章派生态（零持久化）；「手动弹、后台挂」由结构保证（firstEncounterAsk 只被手动路径写入）；契约 `SYNC-PROTOCOL` §21/§21.4 + `PORTABLE-TRANSFER` §3.2；真桶 E2E **7/7**（四选项/ask-once/换目标/探测三态）；通道 `s3_probe_target` 三方登记（195→196）。**途中抓修 P1**：`saveQuickNotes` 清扫把 quick-soft-delete 执行成**物理删**（踩「绝不物删」红线）⇒ quickDeletes 软删分支封死物删路径（`45ddf98b`，真桶实证小记进回收站可恢复；`45ddf98b` 同时混入了粘贴专案的 chrome.css 修复——收口时 `git add -u` 纪律失误，内容无损，登记备查）。
  - **粘贴专案（2947dd4b）**：第三方 21K 粘贴「打崩」经五项独立实证**不成立**（无 render-process-gone/unresponsive/未捕获异常日志、Crashpad 空、事故正文结构完整收尾；21K→6.4K 为转换压缩比，「只落局部」是虚拟渲染误读；16:26:56 的 boot 重放 = 用户关窗后 Dock 重开，非崩溃恢复）。四种粘贴形状（内核/Word mso/转义卡片/ne-clipboard）61–75ms 安全落盘；护栏 5 例 + 脱敏 fixture。**布局塌陷 = 类名撞车**：chrome.css「已收起」分区规则 `.sidebar-collapsed` 与壳层收起态类同名 ⇒ 整个 app-shell 被 `max-height:33.333%` 压成 1/3 高（用户「收起悬浮触发/固定正常」精确对应）——选择器收窄修复 + 防回退护栏，三态几何复原（collapsed 273→820）。
  - 门禁（17:30 收口）：全量 vitest **0 failed**；tsc 双 0；ui-metrics 0；check:bundle+arch PASS（desktop 581,218/592,000 余 10.8KB）；git diff --check 0。

- **261123 · 六线并发批（Windows 顶栏 / usheet 行高 / 移动 dock 三修 / 迁移矩阵+bootstrap 基线 / 规模口径 / 设置文案；未发版，v1.5.6 之后）**：
  - **Windows 融合标题栏**（`ae0c0399`）：win32 去掉系统标题栏+默认菜单栏两层（顶栏即标题栏：原生窗口按钮 overlay、拖拽/双击最大化、菜单只藏视觉保快捷键）；窗口选项抽 `electron/mainWindowOptions.ts` 纯函数（themes glue 测试钉配色）；附件预览右侧让位连带修。**真机 Windows 待验收**（本机出的是 win-arm64 包；用户机器 arch 待确认）。
  - **usheet 自动行高持久化**（`6d43c71b`）：根因 = 内核 RowManager 对 ia=1 行渲染高度取 `rowData.ah` 缓存、打开从不重算（ba9c2434「删 ah」删掉了渲染高度载体）⇒ 修 = ah 随正文持久化 + 打开期视图层自愈（`usheetAutoHeightHeal`，不标脏）+ `usheetAutoHeightOnlyDiff`（ah-only 不算内容改动，「打开=只读」保持）；移动同款接线。
  - **移动 dock 三修**：① 加密卡插表情吞卡（`f9011fcd`）：内核 insertAtSelection「非折叠选区被替换」官方语义 + 卡内 textarea 焦点被内核宿主抢走 ⇒ fieldInsert 输入面优先 / insertGuard 卡片保护区 / IME 谁聚焦抑制谁，小记写作卡同接；② 工具栏撤销/重做首屏不可见（8×49 定宽 > 335 滚动区回归）⇒ 49 上限 + 36 地板；③ 媒体/表格插入吞卡（`dd0c7847`）insertFiles/table 同接保护区。**已知边界**：小记「图片」为内核内置工具项无入口可拦（LAKEX-CONTRACT §5.63）。
  - **迁移矩阵 + 同步**（`bec9bd47`/`906119f7`/`22863157`/`600350cb`/`0e192161`）：**合并底稿基线（bootstrap）**——零基线导入合成「导出时刻快照」当三方合并 base，首同步血缘对齐走正常合并（增量/删除传播/导入后新建上传不丢；真丢失安全中止保留；不动 wire；中招设备重导即修复）。真桶+设备 UI 级 E2E 四步路径 PASS（截图 `/tmp/lake-e2e-shots/`）。审计修复：坏基线**五路统一**「合成+警告」（旧桌面两路落拉全轮 = 小记物删/文档假删除面已封）、换位崩溃恢复 pending、契约写实（顺序边界 = 导出端先上云→导入端再同步）。**两 P0 闭环**：换位失败 catch 递归删原工作区、秒级隔离名撞名（it.fails 复现钉已翻正常驻护栏）。`stageFromPath` Kotlin 验缝。
  - **规模口径（用户裁决）**：测试规模 = **5k 文档 / 1 万附件**；全仓「2 万文档 / 20 万附件」表述清除（`9525272b`）。规模/对抗批（`0b35dfc1`）7 文件 49 例：往返一致 / 行映射 5 万行 37ms / ZIP64 66k / 真桶 135 对象；对抗 30 例全拒（zip-slip/CRC/恶意清单）；P3 现状钉住 4 项。
  - **设置文案精简**（`c62e11b5`）：两端约 70 处改「一句话讲清控制什么/能做什么」，删过程性解释（安全边界只砍过程不砍后果）；settingsSearch 未动名称无需变更。**S3 表单重开不水合**修复（`40dc636a`）：页面级水合信号 + 留空沿用已存值。
  - 门禁（15:30 收口实测）：全量 vitest **1117 文件 / 0 failed**；tsc 双 0；ui-metrics 0；check:core 184/0；check:mobileui 过；check:bundle+arch PASS（desktop 580,130/592,000、mobile 341,446/345,000、entry 44,104/46,000）；git diff --check 0。共 14 提交（ae0c0399…40dc636a）。

- **261122 · 大统一迁移包 v2（各端互导；规格 = docs/PORTABLE-TRANSFER.md 重写版）**：
  - **用户裁决**：一份 `.zip.lln` 各端互导（未来 iPhone 复用移动布局）；上限**维持 4GiB**；**历史快照不进导入导出**（连 note_history 索引行都清）；**AI 会话不随包**；草稿/画板素材随包；密钥不随包（配好 S3 即增量——包内带同步基线）；不写 v1 兼容（formatVersion **2**）。
  - **格式层**：`core/portable/portableFormat.ts` = 清单唯一校验器（layout↔platform 配对、无 hasHistory）；移动 `MobileSnapshotManifest` 第二方言删除；as* 助手上移 `core/portableRows.ts`（R4 禁 electron→src/mobile）。
  - **桌面导出**：白名单 +`draft-journal/`/`quick-notes/staging/`/`materials/`；导出清快照库历史行。**桌面导入三路**：便携包 desktop 布局（staging 换位 + baseline.gz 转换）/ 便携包 mobile 布局（反向映射 `portable/mobileToDesktopMapping.ts` + 真 schema 建库 + 种子不带入 + baseline 反转）/ 整库备份目录（`restoreWorkspaceMirror`）；「隔离→换位→回滚」唯一实现 `replaceWorkspaceWith`。
  - **移动端**：Kotlin formatVersion 2 / MAX_ENTRIES 500k / SNAPSHOT_DIRS 去 history / 导出 staged 清 note_history / 清单带 baseline ref（JS readBaselineFile 透传）/ PAYLOAD_DIRS +staging·draft-journal·materials。**桌面设置入口**：「从整库备份恢复（完整目录）」+「从便携包导入（覆盖本机）」（迁移包组）；settingsSearch/settingsGroups 钉法同步。zip 读取器三合一 `portable/zipRead.ts`（zipTestReader 已删）。
  - **门禁**：全量 vitest **1089 文件 / 6913 例 0 failed**；ui-metrics 0；check:core 183/0；check:mobileui 过；check:arch/check:bundle PASS（desktop 582,297/592,000、mobile 340,800/345,000）；tsc 0；compileDebugKotlin 0。文档回填：PORTABLE-TRANSFER v2 / guide/18 重写 / README 换机三条路 / UNINSTALL-DATA / STORAGE-LAYERS sync-v3 位置校正。
  - **探针新坑（§7#21-22 同类）**：`"portable-import"` 字符串被 `SIDE_EFFECT_IMPORT_RE` 误抓（收紧行首语句位 + 自证用例）；`manifestV2` 函数名撞 versionLiterals「manifest v<数字>」正则（改名 buildManifest）。
  - **已知边界**：移动画板素材在 localStorage 不随快照；>4GiB 大库跨端无包（走整库目录/云拉）。
  - **261122 设置重构（用户点单：三大类）**：「备份与恢复」收敛为 **备份 / 恢复 / 迁入迁出** —— 备份 = 整库备份 + 自动备份 + 上次结果/快照占用统计；恢复 = 整库恢复/数据库快照/云端恢复三档；**迁入迁出 = 便携包的唯一出入口**（迁出：导出 / 迁入：导入，两端同构）。移动端导出块从「关于 → 卸载与换机」迁入「备份与恢复 → 迁入迁出」（原处只留跳转指引）；guide/12 同步。附带修一个**时间炸弹用例**（aiConversationPersist v1 迁移：fixture 固定日期 + 30 天 TTL，11-22 到期假红 ⇒ 显式传 now）。
  - **261122 review 补强（同日第二轮）**：① 仅本机行随包漏洞堵死——两端导出清 `ai_writing_*`/`ai_conversations`/`sync_conflicts`/`s3_gc_*`/`orphan_assets`（历史此前已清）；② **拒包级 bug**：Kotlin counts 只写 4 键而 v2 校验要六键 ⇒ 手机快照会被拒，已补齐 assets/bytes（校验保持严格）；③ 坏基线不再阻断迁移（按无基线 + 明示）；④ 手机快照库改可写打开（自动合并包内 wal/journal）；⑤ **quick_note_assets 图片元数据随包重建**（从 .qnote 正文资源清单，width/height 不丢，原「已知边界」关闭）；⑥ 残余清理 + 设置文案分家（整库备份=本机归档含历史、便携包=跨端迁移不含历史；两个导出保留、说明写清，用户 261122 裁决）。护栏 +5 例。

- **261123 · 复制入口全覆盖（⌘C + 块菜单）**：
  - `attachBlockCopyBridge(container, getBody?)` 新增「单块表格」分支：块菜单「复制 / 复制表格」不再交回内核（内核只写第一格文字），改为从**内核正文**取整表（`tableClipboardModel`）直写剪贴板；`mountBlockHoverHandle` 传入 `editor.getDocument("text/lake")`。
  - **实测**：在 dev 里对文档表格派发块菜单「复制」点击 ⇒ 剪贴板 `text/html` **115 个 `<tr>`**（与 ⌘C 路径同一份正文数据，14873 字节）。
  - 至此复制入口：⌘C（keydown 捕获）、DOM copy、块菜单「复制/复制表格」三条都走同一份「正文 → 矩阵 → 标准 `<table>` + TSV」；粘贴端仍是纠正式覆盖 + 锚点固定 + 自动扩行。
  - 护栏：`blockCopyBridge.test.ts` 新增「单块表格：DOM 只有 1 行、正文 3 行 ⇒ 剪贴板 3 行」（桩 ClipboardItem 读回 Blob），并更新接线断言（挂载点必须传正文读取器）。

- **261123 · 表格复制/粘贴彻底版（推翻此前两次结论）**：
  - **复制端真根因（两条）**：① 内核 ⌘C 走 **keydown**，DOM `copy` 事件不派发 ⇒ 之前的 copy 处理器从未执行，剪贴板里只有第一格文字；② 更关键：文档表格是**虚拟渲染**，DOM 里只有视口附近的行（116 行里只有 28 行有内容）⇒ 即使接管，从 DOM 序列化也缺行。
  - **复制端修法**：新增 `src/features/editor/tableClipboardModel.ts` —— 从**内核正文**（`editor.getDocument("text/lake")` 里的 `<table class="lake-table">`）取整表矩阵（按「选中表在宿主 DOM 的序号」对齐正文里的第 N 张表），生成标准 `<table>` + TSV；`attachTableCopy(host, getBody?)` 在 **keydown 捕获**阶段接管（只有整表/多格选择才拦，普通文字/图片不受影响），已接入 `EditorTab`（文档）与 `attachSelectionClipboard`（LakeEditor/小记）。
  - **粘贴端修法**：Univer 的 ⌘V 同样是 keydown（自己读剪贴板、Excel 风格解析）⇒ 采用**纠正式覆盖**：不拦内核，异步读剪贴板，确认是外部表格后用矩阵写回；锚点在**按键当下同步捕获**（异步再取会变成「在已粘好的表下方再粘一遍」，实测 115→230 行）；超出行列自动 `insertRowsAfter/insertColumnsAfter`。`onPaste` 里不再处理表格（否则默认粘贴事件会再写一遍）。
  - **实测**：真实 ⌘C ⇒ 剪贴板 HTML **115 个 `<tr>` × 5 列**（正文数据，不丢行）；粘贴矩阵 115×5、写入锚点稳定在 A1（日志 `atRow=0`）。⚠️ 之前看到的「230 行」是**复用测试表里的旧数据**（keydown 时 `maxRows` 已是 230 可证），不是重复写入。
  - **护栏**：新增 `tableClipboardModel.test.ts`（6 例：115 行不丢行 / 多表按序号 / 空行保留 / 载荷→粘贴解析器闭环 / DOM 回退 / 序号对齐）。

- **261123 · 表格粘贴**真实链路**修正（推翻 261121 的「已修」结论）+ 小记图片重复占高**：
  - **误判原因**：261121 用**合成 paste 事件**验证（带 clipboardData）才走到 window paste 处理器；用户真实 ⌘V **不派发 paste 事件** —— Univer 的粘贴是 **keydown 快捷键**，handler 自己 `navigator.clipboard.read()` 并用自己的 Excel 风格解析器解析外部 HTML ⇒ 文档表格卡只剩左上角一格。
  - **实测**：剪贴板放入文档表格卡真实 HTML（158,693 字符，28×5）+ 命令行 ⌘V ⇒ 只落 `{0,0:"命令分组"}`；探针 `keydown=1 / paste=0`（网格焦点是 `div[contenteditable=true][data-u-comp=editor]`）。
  - **两次错误尝试（已回退，别再走）**：① keydown `preventDefault+stopImmediatePropagation` 自己读剪贴板 ⇒ 内部复制/图片/纯文本**全废**；② 只 stopImmediatePropagation 依赖默认粘贴 ⇒ 仍无 paste 事件；③ 合成 keydown 重放 ⇒ 内核不接受。
  - **最终方案 = 纠正式覆盖**：keydown **不拦**（内核照旧粘贴，原有路径零影响），异步读剪贴板；只有「非内部复制（无 data-copy-id）+ 解析出表格」时，用我们的矩阵在 80/320/700ms 三次写回。内部复制/图片/纯文本一律不碰。
  - **实测（真实 ⌘V）**：落 **121 格（1 旧 + 120 新 = 24×5）**，值与源表逐列一致。护栏 +2（keydown 内不得 preventDefault/stopImmediatePropagation、必须跳过内部复制并三次写回）。
  - **小记图片上下都占空间**（用户数据 `61cd8ba5…`/`6993651d…` 实测）：`ne-card` 高 727px，其中 `ne-card-root` 365 + **`div.lake-media-resize-box` 363（正常流）** —— 缩放把手盒只在 `.lake-editor-tab` 下被设为 absolute，小记写作卡不在该作用域 ⇒ 盒子把图片高度再占一遍。修法 = 定位规则去掉宿主限定。实测卡片 727→365，图片后文字紧贴；护栏 `mediaCardResize.test.ts` +1。

### 261121 · 表格粘贴修复（文档表格卡 → 我们自己表格）+ 表格默认居中/自动行高 + 小记 ⌘S

- **用户点单（4 项）**：① 切 master 并更新到最新；② 修「文档表格（Lake/语雀表格卡）复制后粘进我们自己的表格只剩一行一列」；③ 表格开发自动行高 + 默认居中对齐；④ 小记接入正常保存快捷键（⌘S）。
- **起点**：工作树原停在已合入的 `modernize/web-platform-261115`（v1.2.0，落后 origin/master 192 提交）；已切 `master` 并 fast-forward 到 `4b816b63`（v1.5.4 + 文档）。
- **② 根因（实测）**：我们自己的复制**没有问题** —— 3×3 选区复制出来的 `text/plain` 是完整 TSV、`text/html` 是 Univer Excel 风格表格（带 `data-copy-id`，内部粘贴走 copyContentCache 保样式）。坏在**外部**粘贴：Univer 1.0.3 的 `HtmlToUSMService`（Excel 风格解析）遇到文档表格卡的 `<table class="ne-table">` + 单元格内嵌 `<div>` 只取出左上角一格。
- **② 改法**：新增纯函数 `src/features/usheet/usheetClipboardTable.ts`（HTML 表格 → 矩阵：`br`→空格、NBSP/空白归一、colspan/rowspan 按 Excel 语义铺空、尾部空行空列裁掉；另有 TSV 兜底），宿主 `UniverSheetEditor` 的 window 捕获粘贴里接管「外部表格 / 多行 TSV」→ facade `setValues` 从活动单元格整块写入；**Univer 自己的复制（`data-copy-id`）与单元格编辑态（contenteditable/输入框）一律放行给内核**。
- **③ 改法（core 单一来源）**：`defaultStyle` 补 `ht = USHEET_DEFAULT_HORIZONTAL_ALIGN(2=CENTER)` 与 `tb = USHEET_DEFAULT_WRAP_STRATEGY(3=WRAP)`；每张工作表 `rowData[*].ia = 1`（自动行高，上限 `USHEET_AUTO_ROW_HEIGHT_MAX_ROWS=500` 行；**已有显式 `h` 的行不动**）。全部走 `normalizeUsheetWorkbook`（与默认字号同一条「规范化 = 写盘形式」路径）⇒ **打开不额外发命令、不标脏**，两端（桌面/移动宿主）同落点。
- **④ 改法**：`QuickNoteComposer.publishOnShortcut` 增加 ⌘/Ctrl+S → `onSave()`（**正常保存**，不是「保存并同步」），⌘⇧S/⌘⌥S 不触发。
- **验证（隔离实例：`LAKE_USER_DATA=/tmp/lake-usheet-fix2`、`LAKE_RENDERER=scheme`、CDP 9223、端口 19891/19892）**：新建表格 → 粘贴 Lake 表格卡 HTML ⇒ 落 `0,0..1,2` 六格（改前只剩一格），正文 `defaultStyle {fs:11,ht:2,tb:3}`、`rowData` 35 行 `{ia:1}`；长文本粘贴后行高实测被顶到 ≈214px 且文本居中（截图 `.css-audit/usheet-261121/`，gitignore）。
- **门禁**：`tsc --noEmit` 0；`vitest run src/features/usheet src/core/usheetDoc.test.ts` **66/66**；`QuickNoteComposer.render.test` **7/7**（含新增 3 例 ⌘S）；`ui-metrics` 0（颜色/字号/!important/重复组全持平）；`check:core` 182 文件 0 违规；`git diff --check` 干净。
- **护栏**：`usheetClipboardTable.test.ts`（8 例：Lake 表格/Excel/colspan-rowspan/尾部空行/内部复制不接管/TSV/优先级）、`usheetDefaults.test.ts` +5 例（常量、新建默认、显式 h 不覆盖、500 行上限、空表 normalize 幂等）、`QuickNoteComposer.render.test.tsx` +3 例。
- **契约回填**：`src/features/usheet/usheetKernelContract.ts` 新增 `HtmlToUSMService`（外部表格粘贴失效表现）与 `SetWorksheetRowIsAutoHeightMutation`（`rowData.ia`）两条升网点。
- **未验**：移动端（`MobileUsheetViewer` 同走 core normalize，默认居中/自动行高应同效）未装包点收；真机从语雀网页复制（而非我们自己的文档表格卡）未实测 —— 两者 HTML 结构同源，理论等价。
- **261121 追加（用户新报 2 条，同一会话）**：
  - **① 动图/图片在小记预览里被展示成超长链接**：根因 = 从文档（或只接收文本的地方）粘进来的图片卡被**实体化**成文本 `&lt;card … value="data:%7B…"&gt;`，预览器按普通文字渲染 ⇒ 一整屏「超长链接」。修法 = `quickNotePreviewParser.restoreEscapedCards()`（只还原「`&lt;card` + 带 name= 的开标签」并补空闭合标签，其余实体/文本不动）→ 真卡按 media 节点渲染；列表项里则至少不再显示标记文本。护栏 `quickNotePreview.test.ts` +3 例（段落/列表/非卡片文本不误判）。
  - **② 小记图片缩放的「间距」**：预览原先按**资源原尺寸**给比例盒，用户拖小图片后卡里仍是原图比例的框 ⇒ 图变小、四周留大片空白。修法 = 解析器把卡片**显示尺寸**（`width/height`，即缩放后的值）带进 media 节点，`QuickNotePreview.Media` 优先用它、缺省才回落资源元数据。护栏 +2 例（缩放值生效 / 0·负数·字符串不落字段）。
- **261122 · 目录「重开还是全展开」的真正两个根因（用户复验发现，已修）**：
  - **根因 A**：`Sidebar` 的「自动展开新出现的容器」effect 用 `useRef(new Set())` 起手 ⇒ 启动首帧树为空、拿到树后把**所有笔记本/分组**都当成"新节点"全量展开（随后被记忆持久化覆盖）。修法 = `prevNodeIds` 改 `Set|null`，**第一次拿到真实树只建立基线、不展开**；之后同步/新建的容器照旧自动展开。
  - **根因 B**：冷启动的「目录跟随 active 文档」effect 会 `expandAncestorChain` 并持久化 ⇒ 只要恢复出标签，active 文档的祖先就自动展开。修法 = `startupFollowRef`：冷启动那一次**有记忆就跳过跟随**（严格按记忆渲染；要定位用工具条「定位」按钮），之后切标签/切模式照常跟随。
  - **实测（dev 实例）**：全部收起（rows 92→5、open 0、stored `[]`）→ 完全退出 → 重启 ⇒ **rows 5 / open 0 / stored `[]`**（标签仍恢复 1 个，目录保持收起）。护栏：`treeExpandState.test.ts` ④ +3 条源码钉法。
- **261122 · 目录展开动效（用户提供录屏 GIF 定位）**：逐帧分析 190 帧 ⇒ 子级容器每次展开都播 `shell-tree-reveal`（opacity 0→1 + translateY(-3px)，250ms），嵌套展开逐层各播一次 = 「一跳一跳」。修法 = 删除 `.tree-children` 的入场动效与 keyframes（`app/misc.css`），保留 border；reduced-motion 白名单同步去掉 `.tree-children`。dev 实例实测 `getComputedStyle('.tree-children').animationName === 'none'`。护栏：`src/styles` 16 文件 63 例全过（层围栏/声明数棘轮自动下降）。
- **261122 · 验收环境**：`npm run dev` 新实例已起（vite 1421 / Electron CDP 9222，dev 数据目录，HMR 生效）；模拟器 `lake_mobile`（emulator-5554）已装最新 debug APK（`scripts/android-build.sh --sync --install`，BUILD SUCCESSFUL）。测试数据：dev 里 `验收-表格粘贴`（表格卡粘贴/居中/自动行高验证），模拟器里 `验收笔记本`（空），都可删。
- **261122 · 移动端目录/标签恢复 + 剪贴板位图（第三批用户点单）**：
  - **① 桌面目录展开「一跳一跳」**：隔离实例实测（新建笔记本 + 24 篇文档 → 展开）：行数 3→27、**`layout-shift` 条目 0**、被展开行 `top 131→131`、滚动位置不变；chevron 的 `.open` 只是**瞬时** `rotate(90deg)`（无 transition/animation）。⇒ 不是布局跳动，怀疑是 `.tree-row{content-visibility:auto}` 的**绘制闪烁**（逐行跳入视口），需用户一段慢放录屏或笔记本身份复现再定；改法只有一个：去掉行上的 `content-visibility`（代价 = 10k 行不再跳过渲染）。
  - **② 复制到 DSH / Codex 用不了**（微信正常 ⇒ 文本/HTML 没问题）：它们读的是系统剪贴板**位图**（访达复制之所以可用，是因为同时给了图）。修法 = 复制图片选区时在原有 `text/html`（含原图 data URL，微信仍拿动图）+ `text/plain` 之外，再用 `navigator.clipboard.write` 补一条 **`image/png`**（非 PNG 用 canvas 转一帧；解码 1.2s 超时收口；失败静默保留文本）。护栏 `selectionClipboard.image.test.ts`（3 例）。
  - **③ 移动端打开笔记本每次都清空上次标签**：根因 = 初次进入的恢复决策在 `tree` **还没加载**（首帧 `[]`）时执行，存档标签被按「已知 id」全过滤掉 ⇒ 走 `restore([], null)` 清空。修法 = `useNotebookTreeData` 增加 `treeReady`（首次 `getWorkspaceSnapshot` 完成才真），`useWorkspaceAssemble` 在未就绪时**不做任何决策**、就绪后 effect 再跑一次。护栏 `workspaceAssembleRestore.render.test.tsx`（3 例：未就绪不恢复/就绪后恢复/真删光才清空）。
  - **④ 移动端小记预览图片显示成链接 + 图文错乱**：与桌面同源（`QuickNotePreview` 共用）—— 共享修复（`restoreEscapedCards` + 卡片显示尺寸）已在 261121 两批落地，**移动端包还没重建/安装**（本机 `adb devices` 为空）。待装包复验。
  - **⑤ 移动端有子文档的文档打不开**：`NotebookWorkspace.onActivate` 原顺序是「有子节点先展开/折叠」在前 ⇒ 带子文档的文档永远进不去；且三角与行共用同一个 onClick。修法 = 文档行**永远先打开**（分组/笔记本行仍开合）+ 三角独立命中区（`stopPropagation` + `onToggleExpand`→`toggleGroup`，键盘 Enter/Space 同效），与桌面同语义。护栏 `NotebookTreeList.render.test.ts` +2 例、`notebookTreeActivation.test.ts`（源码钉法 2 例）。
  - **门禁**：`tsc` 0；`selectionClipboard(.image) + mobile/notebook + quickNotes + components/app + usheet` **117 文件 / 763 例全过**；`ui-metrics` 0；`git diff --check` 干净。
- **261121 追加（第二批用户点单）**：
  - **① 桌面目录展开态跨会话丢失**（用户：退出前收起所有笔记本，重开又全展开）。根因 = `Sidebar` 的 `expanded` 是会话内 `useState(autoExpanded(nodes))`，261119 的定稿是「不持久化」。**261121 口径反转**：新增设备本地记忆 `features/sidebar/treeExpansion.ts`（localStorage `lakex-local-notes-v3.sidebar-expanded`，不进 S3）——记「当前展开的节点 id」，**空数组 = 用户主动全部收起**（与「从没记过」区分），删掉的节点按当前树裁剪；**树同步之后才写**（启动空树写 `[]` 会把「没记录」写成「全收起」）。护栏：新增 `treeExpansion.test.ts`（5 例：null=无记录 / 空数组保留 / 去重 / 坏 JSON / 存储不可用 / 裁剪）+ 改写 `treeExpandState.test.ts` ④（从「不持久化」改成「设备本地记忆 + 接线」）。
  - **② 桌面小记预览没有高度上限**（用户：不能无限长）。根因 = 经典路径（桌面 / 标签详情）的 `is-collapsed` **只有渐变遮罩、没有裁高**；`COLLAPSED_MAX_PX` 只在移动端 `slotFrame` 生效。修法 = 经典路径折叠时给宿主 inline `max-height: 220`（展开即放开），溢出判定改用**最后一个子节点的实际下沿**（`max-height` 只裁剪显示、不改子节点布局，`scrollHeight` 会被裁成等高），图片/视频加载后补一次复测。
  - **③ 移动端表格文字紧凑 / 只露半行**：判据同桌面 —— 单元格 `tb=WRAP` + 行没有自动行高 ⇒ 换行内容被 24px 行高裁掉。桌面/移动共用 `normalizeUsheetWorkbook`，本批的 `rowData[*].ia = 1` 对移动端同样生效（`MobileUsheetViewer` 打开时走同一 normalize）。**未装包验**（本机当时没有在跑的 AVD），下次移动端交付必须先 `--sync --install` 再看这张表。
  - **② 的「拖动缩小要停顿约 5s 才生效」尚待复现**：本批只修了间距口径；5s 现象未在隔离实例复现（未查到对应定时器：唯一 5000ms 是删除撤销窗口）。已登记到 §3 待办，需要用户说明是**编辑态拖动**还是**卡片预览**、以及是否只在动图/GIF 上出现。
### 261120 之后 · 启动页统一：白底 + 只留透明绿折纸（用户点单）

- **需求**：先「启动这个绿色纸质背后的圆形底不是去掉了吗？另外启动使用白色背景如何」→ 再「桌面端好像也有，应该只留一个绿色折纸就行了」。
- **根因**：圆形底不是应用内动画的（那份 261112 已换成透明折纸），而是**原生启动图**：Android 的 v31 splash 用 `@mipmap/ic_launcher`（自适应图标背景层 `#F0FBF5` 薄荷色）当系统启动图标、pre-31 用 `drawable*/splash.png`（同样带薄荷圆盘）；桌面 boot 窗口的 `electron/boot-anim.apng` + `boot-poster.png` 也带圆盘。
- **移动端（定稿）**：v31 `windowSplashScreenAnimatedIcon` → `@drawable/launch_splash_none`（透明）、pre-31 改为纯色底不显示 logo；`launch_background` `#EDEDF1` → **#FFFFFF**；`capacitor.config.ts` backgroundColor、`mobile.html` 的 theme-color / 首帧底 → **#ffffff**；Paper Finch 动画层新增 `--lake-bg-launch`（浅色白 / 深色黑、纯黑档深灰），与原生 splash 同色不闪。**删除** `drawable*/splash.png`（10 个，436KB）——以后不会再被误引用。
- **桌面端（定稿）**：`electron/boot-poster.png` 换成 `public/brand/14a-paper-finch-mark.png`（透明折纸，同一份资产）；boot.html 去掉 APNG + poster 双图，只留一张 + 250ms 淡入（reduced-motion 静态）；**删除** `electron/boot-anim.apng`（328KB）并同步 `BOOT_SPLASH_ASSETS` / `package.json build.files` / `bootAssets.test`（新增「poster 必须与透明折纸逐字节相同」的圆盘回归护栏）。桌面启动底仍走主题窗色（#f3f4f6 / #1e2126，用户未要求改白）。
- **桌面端底色跟进（用户追加「都统一白色」）**：boot.html 浅色档 #f3f4f6 → **#ffffff**（深色档仍 #1e2126）；主进程两个窗口 backgroundColor 浅色 #E9EDF3 → **#FFFFFF**；index.html theme-color → #ffffff；新增桌面令牌 --lake-bg-launch（浅白 / 深 #191a1d），.loading-screen（BrandLaunchMark 启动幕布）铺它 ⇒ 启动窗/首帧/启动幕布三处同白。
- **验证**：移动真机冷启动逐帧抓图 —— 原生 splash 纯白无图、应用内白底 + 透明折纸 + 「正在打开本地知识库」；桌面用离屏 Electron 渲染 boot.html 截图确认只有折纸（无圆盘）。

### 261120 之后 · 移动知识库书架卡尺寸（用户点单，两轮）

- **需求**：先「笔记本做小一点」→ 4 列版被判**太小** → 「还是一行 3 个，适当扩大图标，收缩一点空白区域」。
- **定稿（手机）**：`.nb-shelf` 一行 3 个；封面 aspect-ratio 3/3.8 → **3/3.1**（压掉竖向空白）；图标徽章 42 → **40**（内线 22 → 21）；卡片名上距 8 → 7、行高 1.3；整卡 ≈120×218 → **≈120×187**。平板书架的 auto-fill 规则不受影响。落点 mobile.css 的 .nb-shelf*；规格回写 docs/MOBILE-DESIGN.md 5a。
- **移动快照基线重烤（10 态）**：mobile-snap 基线同样烤于 **11-17（9c46cde1）**，此后 20 个移动端提交（261119 顶栏常驻/按钮边界/快捷菜单/链接浮窗、261120 空态·已收起…）从未重烤 ⇒ 各态元素数恒 +4、指纹全变；本批按「两轮一致 + 逐态固定差」判定后**一次性重烤 10 态**（--from lib-final2 --write-baseline），复检 **10 态 0 差异**。与多维表同一条教训：先按 git log 归因，再重烤。

### 261120 之后 · 笔记本「已收起」（用户点单批）

- **需求（原话口径已对齐）**：把不常用的笔记本收进「已收起」分区；**纯设备本地、各端独立、不进 S3**；桌面 = 置顶的反向（置底），展开后行为与目录一致、区域最多 **1/3 目录栏高度**（最大高度、动态）；移动端 = 知识库主列表下方一条分割 + 折叠分组，**默认收起**；两端都记忆展开态；收起项从主列表消失、不参与排序（取消收起回到列表末尾，不做「记原位」）；笔记本菜单入口与重命名/删除并列（**笔记本本来没有置顶**）；**不做拖拽进分区**；日记本/回收站/「未分类」从逻辑上排除；其它入口（切换笔记本/搜索/新建父级）全量不过滤。
- **实现（单一来源）**：core/notebookCollapse.ts = canCollapseNotebook（三类特殊本逻辑排除）+ pruneCollapsedNotebookIds + splitCollapsedNotebooks + normalize；桌面 store features/sidebar/collapsedNotebooks.ts（lakex-local-notes-v3.sidebar-collapsed-notebooks / -open）、移动 store mobile/data/collapsedNotebooks.ts（lakex-local-notes-mobile.collapsed-notebooks / collapsedOpen），两端各自 localStorage、不写库。
- **桌面**：Sidebar 把 roots 用 splitCollapsedNotebooks 切两份；底部 SidebarCollapsedSection（同一份 TreeRow ⇒ 子树/右键/拖拽全同款），max-height 33.333% + 区内滚动；右键菜单「收起/取消收起」（canCollapseNotebook 决定是否给入口）；搜索/标签筛选期间不做收纳（与置顶区同口径）；全部收起时主列表给提示。
- **移动**：HomePage 知识库书架/列表共用切分；底部 home-collapsed 分割 + 折叠分组（默认收起），展开内联渲染 NotebookGrid；长按菜单加「收起/取消收起」（逻辑排除的本不出现该项）；全部收起时主列表提示「笔记本都在下方「已收起」里」（不再显示「暂无知识库」）。
- **追加（同日，用户点单）**：分区可**上下拖拽调高度** —— 共享 SplitHandle 加 y 轴（axis/maxRatio；不写第二套 pointer 手势），kit 加 --horizontal 变体；分区展开时顶部一条分隔条（命中区上下各 4px），范围 56px～目录栏 70%，双击复位成自适应；手动高度存 lakex-local-notes-v3.sidebar-collapsed-height（设备本地）。实机复验：拖 90px 后分区 77→152px 且落盘，双击回 77px 且清空存储。
- **报障修复（同日）**：分区里**点笔记本行不展开** —— 根因：目录行点击的展开/收起在 handleRowClick 里走的是主列表的 toggleNode，而分区只换了三角的 onToggle ⇒ 点行写进了主列表的展开集、分区渲染读的却是自己那份。修法：handleRowClick 增加可注入的 toggleExpand（默认仍 toggleNode），分区的 onRowClick 注入分区自己的 toggle；三角与点行现在都生效，选择/右键/拖拽/多选语义与主列表一致。护栏补「点行展开 + 再点收起 + 三角仍可用」。
- **追加口径**（用户同日补充）：已收起分区里的**子级默认也保持收起** —— 分区用独立展开态（session 内、不落盘、不回写主列表），收起那一刻清掉该子树在分区里的展开记录；分区内可手动逐级展开。实机复验：收起「个人笔记」后分区只显示本行，点三角才展开子文档（内部滚动）。
- **验证**：桌面 dev 实测（5 本 → 收起「测试本」后主列表 4 本、底部「已收起 1」默认折叠；展开后 3 行 = 本 + 2 篇子文档、分区高 91px < 792/3；展开态落盘；恢复：取消收起后分区消失）；移动端实测（长按「个人笔记」→ 菜单含「收起」→ 主列表清空 + 提示 + 「已收起 1」；展开后卡片出现、展开态落盘）。护栏：core/notebookCollapse.test（含 split）、两端 store 测试（localStorage-only）、sidebarCollapsed.render.test（7 例：收起/取消/默认折叠/特殊本排除/历史残留清理/全部收起提示）、mobile collapsedNotebooks.render.test（5 例）。
### 261120 之后 · 多维表内容字号 15px（用户点单）

- **需求**：先问「多维表的默认字号是多少」→ 答 14px → 用户「改成15吧」（与刚定的目录 15px 对齐）。
- **改法**：多维表**内容**统一 15px（--lake-font-size-bodyMd）：表头、行号、单元格输入、单元格回退态、选项 chip、附件名、关联文字、表格/卡片/日历三视图记录标题；**UI 侧不动**（工具栏、按钮、字段面板、表单控件仍 14px）⇒ 「内容比 UI 大半档」的层级保持。行高 --bt-row-h 36px 不变（15px 字在 36px 行内居中，虚拟窗口估算不受影响）。
- **实测（桌面 dev）**：.bt-th-inner 15/500、.bt-cell-input 15/400、.bt-row-num 15、.bt-td 高 36（不变）；展开面板本来就是 bodyMd(15)，现在「表里 14 / 展开 15」的跳变消失。
- **移动端基线重烤**：多维表 3 态（表单/内容表格/内容卡片）。**基线原烤于 11-17（9c46cde1），之后 261119/261120 有多批移动端+多维表改动从未重烤**（四项/行详情、选项色板、顶栏常驻、链接浮窗…）⇒ 元素数每态恒 −11 来自那些批次、与字号无关；本次按「两轮一致 + 逐态固定差」判定后重烤（--from warm12 --write-baseline），复检 **3 态 0 差异**。下次若再出现元素数漂移，先按 git log 查基线之后落了哪些批次，别直接重烤。
### 261120 之后 · 桌面目录字号试档 14.5px（用户点单）

- **背景**：用户截图指出「目录文字样式和正文还是不一样」。实测确认差异 = **字号**：目录 14px（261119 只统一了颜色+字重），正文跟随设置里的「正文字号」（默认 16px，内核挂 mount 根、行高约 1.57）。
- **第一版按「和正文一样」实现**：App 用 layout effect 把 settings.fontSize 下发成 --lake-doc-font-size，目录 min() 夹 18px ⇒ 实测目录与正文完全同源（16px/400/text-1，行高都 25.144）。**用户当场否决：16px 太大。**
- **定稿（用户指定）**：目录字号 = **14.5px 试档** —— font-size: calc((--lake-font-size-body + --lake-font-size-bodyMd) / 2)（相邻两档令牌求均：不写字号字面量、不新增档位令牌），配 line-height: --lake-line-height-tight 把行盒压在 21.6px。**目录不跟随「正文字号」设置**（跟随=16 已否决）。
- **实测**：目录 14.5px/400/#1b1f27/行高 19.575；普通行 27、笔记本行 29（**行高与 contain-intrinsic 23/25 零变化**）；正文 16px（设置默认）。
- **护栏与基线**：treeRowGeometry 护栏改断言（字号单一来源 = calc 两档求均 + 不许写回固定 14）；cssLayers chrome.css 539→540（+1 = line-height 那条）；stylesnap hover-row 两态重烤并复检 0 差异；DESIGN Rows 记录试档与历史（260923/261015/261119）。
- **可逆**：若再判偏大/偏小，改回 var(--lake-font-size-body) 一行 + 护栏同步即可。
### 261120 之后 · 打开笔记本空态（用户点单）

- **需求**：「移动端打开笔记本，如果没有标签页，就空着，不要自己开一个文档。」
- **改法**：useWorkspaceAssemble 删掉「初次进入开树中第一篇」的兜底（firstNoteInTree 不再参与产品路径；useNotebookTreeData 不再计算 firstNote）。显式打开（首页/搜索/新建带 initialNoteId）与「恢复上次标签」两条路径保持不变；无标签时只清掉存档里失效的占位，正文区落到 NotePaneHost 既有空态「暂无打开的文档，点底部『文档树』打开」。
- **影响**：打开笔记本 = 只看目录/空态（与桌面 261114「启动只恢复上次标签，没有就空态」同一口径）；从首页卡片点文档、搜索命中、新建文档仍一步直达。
- **验证**：设备实测 —— 清掉 tabs 存档后从首页打开「个人笔记」：workspace 无编辑器、标签页 0、正文区显示空态文案（截图在会话记录）；护栏新增 notebookOpenEmpty.test（3 例），useNotebookTreeData.test 同步改断言。
### 261120 之后 · 移动端入口瘦身批（v1.5.3 之后，未发版）

- **起点**：mobile entry 只剩约 110B 余量（51,330/51,440），任何移动端新功能都会先撞预算。
- **量化**：用临时 sourcemap 探针配置（vite.mobile.probe.config.ts，仅本地一次、已删）量出入口 chunk 的 111 个模块；最大可摘项 = **@tanstack/virtual-core + react-virtual ≈ 8.2KB gzip（入口 16%）**，而它只在小记时间线超过 24 条时用得到。
- **改法 ①**：小记虚拟行窗口抽成**懒组件** src/mobile/home/QuickNotesVirtualList.tsx（React.lazy + Suspense；chunk 未就绪时先画前 12 条同构卡片；短列表根本不会下载）；HomePage 去掉 tanstack 静态 import，滚动定位改成「把目标下标传给懒组件」。
- **改法 ②**：启动期后台维护（历史清理 / 回收站自动过期）与崩溃诊断（crashLog + 原生崩溃记录）改「用时动态 import」（useAutoSync / main.tsx / MobileApp 三处）。
- **结果**：入口 **51,330 → 42,603B gz（−8,727B，−17%）**；移动首屏 **348,295 → 339,582B**；preload 仍 12 条。预算随之收紧：入口 51,440 → **46,000**、移动首屏 350,000 → **345,000**（两处脚本注释都写了实测值与余量）。
- **验证**：设备 A：正式包短列表（原渲染路径）截图正常；设备 B：临时把阈值调成 1 的探针包里确认虚拟行窗口在真机 WebView 正常（绝对定位 + translateY 0/168/320、容器高 541px），验证后已还原阈值 24 并重装正式包。测试护栏 quickNotesVirtualList.test 按新结构改写（3 例：懒边界 / 虚拟化参数 / 搜索定位时序）。
- **取舍**：不给懒 chunk 做 idle 预取 —— 短列表根本不需要它；长列表首屏会有一帧「前 12 条」兜底（实测可接受）。
### 261120 · 目录行三件套 / 右键上下方新建 / 移动端文档引用（用户点单批，未发版）

- **目录行三件套 = 悬停才强调的圆润 chip**（用户点单，参照思源图1/图2，随后复述「强调不是常驻的，光标过去才强调」）：`.tree-chevron` 16→18 且圆角 6→8（读作圆角方块），`.tree-row-action` 22×22 加 8 圆角；**底色只在按钮自身 hover 时出现**（`--lake-bg-press`），行 hover 只负责让 ⋮/＋ 显形、不点亮底色（第一版做成常驻块被用户当场纠正 ⇒ 已回退为指向态）。两块 chip 之间 `gap: 2px`。cssLayers `chrome.css` 533→539 已登记；stylesnap `hover-row:1315:{light,warm}` 两态已重烤（A/B 证伪「元素 +1」= 夹具/实例漂移，旧 CSS 同值 2524）。
- **目录右键顶部 = 两个二级菜单「在上方新建 / 在下方新建」**（用户点单两轮定稿：① 推翻 261106「右键不再提供新建」；② 「上方新建然后拉二级菜单、接入我们自己的新建」；③ 「不要第三个新建」）：两个入口的**子项 = 我们自己的新建清单**（CREATE_CHILD_ITEMS 六项：文档/表格/多维表/画板/手写板/分组），选完走统一新建弹窗；**没有第三个独立「新建」**，分组/笔记本行也没有任何新建入口（无"文档兄弟"语义）。
  落位 = 同父级锚点 `afterSortOrder`（上方 = 锚点 sortOrder−1、下方 = 锚点 sortOrder，store 在同一事务里挪开同级）：`createNoteIn` / `createUsheetIn` / `createBitableIn` / `createBoardIn` / `createInkIn` / `createGroup` 全链接通（store / noteMetadataRepository / registerNotes IPC（共享 `sortAnchor` 校验）/ preload / native / useNoteLifecycle / useTreeActions / Sidebar）；**无锚点仍走原调用形状**，既有契约不动；笔记本是根层、不接锚点。
  桌面 CDP 实测：菜单头 = 在上方新建 / 在下方新建 / 分割线 / 重命名（无第三个新建）；「上方新建 → 新建表格」落成 usheet 且紧贴锚点上方；「下方新建 → 新建分组」落成 group 且紧贴锚点下方；护栏 `sidebarSiblingCreate.render.test`（3 例，含六 kind 锚点透传）+ sidebarContextMenu / sidebarNotebookDialog / sidebarMultiSelect 按新裁决改写。
- **移动端「文档引用」三问题**（用户点单）：① 旧实现直接复用桌面锚定 Popover（`.ln-*` 外观 + 打开即 focus 搜索框 ⇒ 默认键盘）；② 插入后先弹桌面编辑浮层并 **focus 输入框**；③ 点击后编辑区滚动。改法 = 新增 `features/editor/noteRefMobileUi` 注册表（移动端注入，**桌面零变化**）+ `mobile/editor/NoteRefSheets.tsx`（`MobileSheet` 可拖动 + `mb-row`/`mb-input`/`mb-set-item` 原语；createPortal 到 body 规避 transform 祖先，已登记 uiPrimitives 白名单）；插入后**直接开「选择文档」Sheet 列出全部文档**、不聚焦任何输入。设备实测（emulator-5554）：旧实现点「文档引用」后 `activeElement=INPUT.ln-input__field`、scrollTop 1312→1362；新实现 `activeElement=mb-sheet`、scrollTop 1514→1514（**零位移**）、无键盘、12 篇文档一次列出；编辑 Sheet 文本/链接预填与底栏按钮正常。
- **移动端「插入链接」= 底部可拖动浮窗**（261120 用户点单，接 mobile-link 的设备报障流）：原先链接编辑是 dock 面板里的**内联行**（复用内核 `.ne-link-editor`），而面板与键盘是「二选一」几何 ⇒ 键盘弹起后输入区被挤/被裁（设备实测面板塌成 0.38px、整行被 overflow 裁掉）。mobile-link 先用 `data-link-kb` 把面板抬到键盘上方救急（设备已验：键盘 530 时文本/链接/确定可见、可打字）；用户随后要求「直接复用可上下拖拽的浮窗、做得好看点」⇒ 改为 `MobileSheet` 浮窗 `mobile/editor/LinkEditorSheet.tsx`：文本 + 链接两个 `mb-set-item--field` 字段、`SheetFooter` 取消/确定、**回车即确定**（键盘盖住底栏时的最短出口）、失效提示走 `.mb-set-item__error`；**判定/选区还原/失败重试仍全走共享 `linkEditor.ts`**（桌面浮栏同一份）。原 `data-link-kb` 几何与 `.med-f-link` 内联行 CSS 一并删除（`editor-dock.css` 净减 8 条声明，ratchet 只降不上调）。设备验：插入→链接 打开「插入链接」浮窗 → 键盘弹起输入可见 → 回车落链为真实 `<ne-link>`；两次被内核拒绝时不关窗。
- **移动端浮层 portal 收口**：`mobile/ui/MobilePortal.tsx` 成为移动端浮层的唯一 portal 原语（内核 React 树/正文 transform 祖先下 fixed 会失效）；`uiPrimitives` 白名单只放行这一个文件。
- **首屏预算收口（用户批准 "A+C"）**：根因 = 更新中心用 `?raw` 把 `docs/RELEASE-NOTES.md`（57KB raw / 24.5KB gzip）静态打进桌面入口图 —— 所以"改发版说明"等于"改首屏体积"（越线提交 534afa1a 加 44 行 ⇒ 桌面首屏 +1,209B 直接顶爆 602,000）。
  **A（瘦身）**：新增 `src/lib/releaseNotesText.ts`（动态 import + Promise 缓存），桌面 `UpdateCenter` 与移动 `UpdateCenterSection` 都改成按需加载 ⇒ 桌面首屏 **604,048 → 579,064B（−24,984B）**，桌面预算按"实测 +≈13KB"收紧 **602,000 → 592,000**；移动首屏 348,308/350,000。
  **C（防再涨）**：新增 `.github/workflows/budget-gate.yml`（**push master 触发**：两个 build + check:bundle + check:arch）—— 原门禁只挂 `pr.yml`（仅 pull_request），而本仓库直接推 master ⇒ 首屏预算从 261119 起悄悄涨了 +2.1KB 没人发现。设备/视觉门禁仍按 AGENTS §3#21② 留在发版前人工。
- **门禁**：tsc 0 / typecheck:electron 0；全量 vitest 见 §1；ui-metrics 0；check:core 181/0；check:mobileui 通过；check:bundle PASS（desktop 首屏 **579,064/592,000**、mobile entry **51,343/51,440（余 97B ⚠️）**、mobile CSS 140,239/141,312、preload 12/12）；cssLayers / mobileLayers / stylesnap 基线均按批登记。

### 261119 · v1.5.1 收口批（目录展开/行样式、封面隐藏、禁移动拖拽缩放、链接输入/面板跳变、清理批）（已发版）

- **目录逐级展开**（点单）：收起清子树展开态、再展开只开一级（`toggleExpandedNode` 复用 core.tree.subtreeIds；无持久化并钉死）；**置顶区同款 bug 登记未修**（跨槽位置顶语义，需单独设计）。行样式：行间空隙 1px 思源式独立行块（3px+ 被护栏挡）+ 行文字试调**正文同款**（text-1 + 400 字重，推翻 260923 降档；选中仍 semibold；旋钮清单在 treeRowGeometry/DESIGN Rows）。
- **书签封面两级皆败静默隐藏**（裁决）：级联裁决（同值写被吞=无下一级）⇒ 隐藏缩略框、无封面排版、零跳版；feature.css 3 规则 + **移动镜像 3 条**（集成补齐，parity pin）；录屏 spinner 证实为 PixPin 点击特效（非应用）。
- **移动禁用图片/视频拖拽缩放**（裁决）：`mediaCardResizeEnabled()` 平台闸门双守（挂载点+模块自卫），把手/盒/键盘←→/扫描器整链不装；**视频布局投影保留**（持久化宽度/对齐唯一渲染通道，中途冲突已裁定）；内核原生 resizer 隐藏保留；桌面零变化。
- **链接输入修复**：dock 面板 onMouseDown 无豁免 preventDefault 吃掉聚焦/唤键盘（桌面 260924 同因判例移动端漏同款）⇒ 补 input/textarea/.ne-link-editor 豁免。
- **＋面板开合跳变修复**（回归：261111 f7d39f45）：`--mb-app-h`『100% 等价』短路在键盘躲面板背后收起时序失效 + ≥1 帧钳位窗口 ⇒ 面板态当帧显式钉字面量、短路只许纯键盘态；设备矩阵修前 FAIL×4/修后 ALL PASS；LAKEX-CONTRACT **§5.62** 回填。
- **清理批**：TAP_REVIEWED 23→1（唯一例外 pad-tab-add 带判例）、cardMenu 死属性、nodeIcon 冗余、toastCopy 单源、batchNotes 判列改 `trashed_at`、速记草稿防抖等内核就绪+空 body 不写（revert-proof）。
- **门禁**：tsc 0；全量 vitest **1071 文件 / 6804 例 0 failed**；ui-metrics/check:core/check:mobileui/check:arch/check:bundle/diff-check 全过。**已发版 v1.5.1**（tag `b5ecf605` 注解双推，Release workflow 触发）。

### 261119 · 修复批二（知识库计数 / 顶栏常驻 / 按钮边界 / 卡片闪烁）（已随 v1.5.1 发布）

- **知识库笔记本文档计数**（用户点单）：根因 = docCounts 只按 parentId 数根目录直属文档（分组内文档计到分组 id）⇒ 卡片 0 篇。`notebookDocCounts.notebookSubtreeDocCounts` O(n) 子树聚合（isGoneNote 口径剔 trashed/回收站/purge，note 也可作父），书架/列表同口径；桌面无同名计数面（AI 选资料本就子树口径）已核。
- **阅读态顶栏常驻**（用户点单「去掉下滑全屏，只对悬浮胶囊生效」）：`useWorkspaceChrome` 拆 `topbarHidden`（唯一来源=子页全屏）/ `capsuleChromeHidden`（旧滚动判据逐字转给胶囊）；scrollChrome 成胶囊专用判据；让位几何自洽（底部 80px 胶囊让位不动）。
- **按钮边界两类收口**（用户点单 + 261119 按钮边界审计，已删 git 可查）：①底栏账唯一——便携包/更新弹窗裸 footer 迁 `.mb-sheet__foot`（0 内距沉底贴手势条 = 「按钮过分靠下」真因）、body/foot 双叠 safe 收一份、drawer/ai foot 并账、MobileSheet footer 槽强制包 foot；便携包确认主次倒挂修正。②44 命中——`.mb-btn--sm/.mb-iconbtn--compact` 类内 ::after 纵向扩区（30+ 面一次收口）+ 三散点 .mb-tap。**三道护栏进 check:mobileui**：sheetFooterContract / bottomChromeContract（bottom 安全区镜像，允许清单只减不增）/ tapAreaContract（视觉<44↔扩区对账）。
- **文档卡片闪烁**（用户点单）：真身 = 内核书签卡封面 `onError` **同值重写无限环**（同值 src 赋值浏览器仍重拉 ⇒ 失败↔重试 ~0.4-0.8s/圈，实测 15s 27 同值写/28 error；录屏「全页闪」为 H.264 GOP 伪影——**取证修正**：周期尖峰是关键帧再量化，非应用活动）。修法 = `bookmarkCoverFallbackGuard`（元素级 src 访问器「未变才写」，应用层运行时补丁不动内核产物，挂 createLakeDocument）+ videoCardOps/mediaCardResize 扫描器同补未变才写；修复后静置 2 写即稳。LAKEX-CONTRACT §5.61 回填。
- **门禁**：tsc 0；全量 vitest **1067 文件 / 6769 例 0 failed**；ui-metrics / check:core / check:mobileui（含三道新护栏）/ check:arch / check:bundle / git diff --check 全过。

### 261119 · v1.5.0 后三修复批（目录表情样式 / 内核表情中文筛选 / 表格默认字号 11）（未发版）

- **目录选表情面板样式恢复**（用户点单「挤 + 样式丢失」）：根因两步事故 = 99829213 把页签类名 `node-icon-picker__tab` 改成 `__type-tab` 但 CSS 三条规则留在原名（孤儿）→ 09f41ba1 把孤儿当死类删除并迁 kit ln-tabs（挤成一团）。恢复 `.node-icon-picker__tab` 一族（九格等分 ≈43px、27px 行高档位、hover/选中/焦点三态，全令牌）；补**样式类不离散双向护栏**（CSS↔TSX 对账，反向钉死改名失联型事故）；nodeIcon.css 基线 78→97（恢复被误删既有视觉，逐条写因）。
- **内核文内表情中文筛选**（用户点单「什么都筛不出来」）：根因 = 面板 getSearchItems 的 Fuse.js 评分（位置惩罚 distance + 字段长度归一 + score≤0.1）把**尾部中文关键词全杀光**（数据 ePW 1467 条含中文，「火」在 🔥 关键词尾部却 0 命中；英文也只有词条首词能过）。最小补丁 = Fuse options 加 `ignoreLocation:!0, ignoreFieldNorm:!0`（lakex.js 1 行 + dist 重建；火→9 条/苹果→🍎/house→🏠/空→全量）。登记 LOCAL-CHANGES.md **#34**（重转内核重放锚点 = `keys:['keywords']` options 字面量）+ LAKEX-CONTRACT **§5.60**（面板搜索机制/未文档化注入面 unicodeEmoji option 备用）+ emojiPanelSearch.test 4 例（含 bundle 级真 Fuse+真数据验收）。
- **表格默认字号 = 11（Excel 11pt）**（用户点单）：落点 = `core/usheetDoc` 单一来源 `USHEET_DEFAULT_FONT_SIZE=11`，normalize 写 workbook+worksheet `defaultStyle.fs`（Univer 1.0.3 实测：**真渲染底 = 工作表级 defaultStyle**，workbook 级仅序列化面；内核 DEFAULT_STYLES.fs=11 只是同值巧合 ⇒ 漂移哨兵钉升级）；两端宿主同一 normalize 天然同源；存量显式字号零变化、打开不标脏；移动字号步进未设式样回退 14→11 对齐渲染底。
- **门禁**：tsc 0；全量 vitest **1060 文件 / 6729 例 0 failed**（inkPerf/s3v3 perf 计时护栏满载假红、单跑绿——既有口径）；ui-metrics / check:core / check:mobileui / check:arch / check:bundle / git diff --check 全过。**三项实机复验待用户**：目录面板观感对拍、文内搜「火」、表格默认 11 渲染。

### 261119 · 配色合规批（全类型审计 + 选项色收窄 + 表格越界修复）（未发版）

- **全类型文档配色审计**（261119 配色审计，已删 git 可查；只读、脚本核对集合关系）：判据 = 移动端可选值逐 hex 精确 ∈ 该面桌面取色卡。结论：**文档（Lakex 字色/背景 14 值精确 ∈ 内核 70 色阶）、小记（同 dock 复用）、手写板、画板、多维表（选项/进度/填色同源）全部合规**；越界 16 个去重 hex **全部在表格（Univer）面**（字体 7 / 填充 13 / 边框 1）。ΔE 近似只在设计期（对语雀采样换算），运行时写入色阶精确值。
- **表格越界修复（审计 P0 案 1）**：usheetChromeModel 字体/填充 + usheetBorders 边框色 16 越界 hex → **Univer 45 预设精确值**（colorPresets 逐值映射，如 #c8ccd2→#CDD0D8；映射表见流回报/测试注释）；旧文档已落盘旧值仍正常显示（normalizeSheetColor 认任意 hex），只是新写入不再产生桌面选不出的颜色。**P1 护栏** `usheetColorCompliance.test.ts`：SHEET_*+边框 ⊆ Univer 45（逐字节）、MOBILE_BOARD_*/QUICK_TEXT/INK/COLOR_BOARD_GROUPS ⊆ 内核 70（防回归，零改动）。案 2（core/colorPalette 单一来源 + COLOR_PICKER_COMPONENT 重注册）登记不做；**patch 额度 4 处已满，禁新增**。
- **多维表选项色收窄 70→2×10**（用户点单）：`core/colorPalette.ts` 新增 `OPTION_COLOR_BOARD_GROUPS/VALUES`（单一来源，桌面 FieldEditorModal 与移动 .mbt-feditor__colors 同取；共享件 ColorPalette.tsx 只加可选 groups 参数，缺省仍 70 全量——背景/文字/进度色板一律不动）。**档位 = [3] 浅中档 + [4] 鲜艳中档**（261119 用户红框原图选定；上浅下深、列=同色相 0–9 对应；交付流原做 [2]+[5]，lead 按原图校正为 [3]+[4]）。「默认颜色」清空项保留首位；mobileBitable.css 色板槽改 10 列自适应网格（零净增声明）。
- **门禁**：tsc 0；全量 vitest **1058 文件 / 6704 例 0 failed**；ui-metrics / check:core / check:mobileui / check:arch（mobile 347,950/350,000、desktop 601,531/602,000）/ check:bundle（entry 50,955/51,440）/ git diff --check 全过（重建产物后测）。

### 261119 · 两点改判（快捷菜单顺序/替换语义 + 视频宽高弹窗照抄图片样板）（未发版）

- **快捷菜单**（用户裁决）：① 顺序与文案 = **拍照小记 / 剪切板小记 / 新建小记**（shortcuts.xml 块序即显示序；三短语 short/long 对齐；旧「新建小记」块内部逐字未动只挪第三位，ShortcutsConfigTest 补块序断言）；② **都做成替换**：camera 改走 captureSeed 草稿通道（text 空 + 图片种子），与 clipboard 同为整份替换未提交旧草稿；删 setCaptureInsert/insertFiles 并入通道（首页新建面板 initialInsert 通道保留、有其他消费者）；取消/失败不落种子、旧草稿不动；取数流接 isCurrent 代际（captureFlowGenRef，触发/关闭 +1）堵「迟到相机结果污染新会话」。行为微差（已注释）：camera 取消后写作卡才挂载弹键盘（原为卡先挂相机盖上），数据语义不变。
- **视频宽高弹窗第三轮终裁**：样板 = 图片 imgsize「宽高」弹窗本体（此前两轮 ln-menu/内核 CardMenu 形态均被判不对）⇒ 新增 `MediaSizePop.tsx` **共享组件单一来源**（cardpop 表面 + inputrow 字段行 + ln-segment 预设档），imgsize（宽+高两列）与 videosize（宽单列「宽 [值] %」+ 25/50/75/100）同渲染、类栈逐字相等测试钉死**永不再漂**；无应用按钮/无可见脚注（「100% = 铺满正文栏」提示挂输入框 title → .ln-tip）；Enter/IME 提交语义组件内唯一收口（imgsize 实测只有 Enter 提交 ⇒ 同款）。撤 KButton、删 __videorow/__video-note（cssLayers 164→158）；`__videoWidth` 10–100 与 ←/→/Home/End 零变化。cardMenu.tsx（图片二级菜单共用件）保留不动——其 focusable/ariaPressed 已无调用方、注释过期，登记下批清理。
- **门禁（两批合验，重建产物后）**：tsc 0；全量 vitest **1055 文件 / 6694 例 0 failed**；ui-metrics 0；check:arch 双端 PASS（mobile 347,955/350,000、desktop 601,525/602,000）；check:bundle mobile-entry 50,959/51,440；git diff --check 干净；android testDebugUnitTest 绿（ShortcutsConfigTest 3/3）。

### 261119 · 长按图标快捷菜单：拍照小记 / 剪切板小记（点单交付，未发版）

- **三快捷方式**（res/xml/shortcuts.xml，同 QuickNoteAlias + ic_launcher）：旧「小记」block 逐字未动（无 query 深链全文件仅一条、文案钉死 ⇒ 零变化）；新增「拍照小记」`?src=camera`、「剪切板小记」`?src=clipboard`。深链解析 `quickNoteShortcutMode()` → plain|camera|clipboard|null（未知 src 不劫持旧语义）；manifest intent-filter 未动（query 不影响 scheme+host 匹配，已 resolve-activity 实证）。
- **capture 时序**（三模式共用假单独模块语义：不主动同步/退出退 App/raiseKeyboard 全不变）：camera = 写作卡就绪（whenReady=懒加载壳同一 loader）→ 懒调 `takeCameraPhoto()`（261119 原语义不动）→ 图经 composer initialInsert/insertFiles 通道入卡（与首页「拍摄」同语义，**并入**恢复草稿）；取消 ⇒ 空卡保留、不再自动弹。clipboard = **读完剪贴板才挂写作卡**（避免双倍内核实例化）→ 自有 `ClipboardTextPlugin.kt`（primaryClip 只取文本）预填正文（captureSeed 草稿通道，与系统分享同机制 = **替换**未提交旧草稿）；空/非文本 ⇒ toast + 空卡（500ms 复读兜 Android 10+ 焦点时序）。取数流每触发只跑一次。
- **预算零调升且达标**：mobile-entry 余量仅 81B ⇒ 先懒化 4 处存量（PinShortcut 探测拆 `native/pinShortcut.ts`、dbHealth/assetPerf/缺资产占位安装器改动态 import、captureModeFlow 禁入入口图模块——实测共享提升会把 modulepreload 顶爆）⇒ entry 51,356→**50,949B**（余 491B）/preload 12/12。
- **门禁**：tsc 0；全量 vitest **1055 文件 / 6684 例 0 failed**；android `testDebugUnitTest` 全绿（ShortcutsConfigTest 3 例钉三 shortcut/URI/旧文案/filter 无 path）+ `assembleDebug` ✓；git diff --check 干净。
- **顺带裁决**：check-arch 桌面首屏 601,551B > 600,000B —— 归因 = 共享组件 QuickNotePreview 的槽位/展开过渡（特征串 `7.5em` 命中真入口，其余本批代码均不在桌面首屏图）；**用户批准登记上调 600,000→602,000**（理由入 check-arch.mjs 注释；组件拆分让 slot 代码出桌面图 = 登记在案的瘦身方向，再涨须重新论证）。注：261119 修复批复盘发现其终轮 check:arch 曾用陈旧 dist/ 误报 PASS，本批起**门禁一律先重建产物**。
- **设备验证**：三条深链 resolve-activity 已实证（含 query）；相机/剪贴板全链路与长按图标菜单 UI 待装包实测（步骤见待办）。

### 261119 · 移动端修复批（4 组点单 + 跳变八项 + 拍照直出相机）+ README 双语/徽章 + 视频弹窗内核化（v1.4.0 后，未发版）

用户点单四组 + 只读审计八项 + 两个文档点单，9 条并行流（写范围互斥）+ lead 集成；全部门禁绿、APK 已装 lake_mobile。

- **速记 capture 返回链**（点单1）：根因 = 系统收输入法**不派发 backButton**、焦点残留 ⇒ 第 2 下被「收键盘优先」分支误吞（旧现场要 3 下）。capture 退出判据改 `softKeyboardVisible()`（ui/dismissKeyboard 新增，与 useKeyboard 同双通道）；`consumeBack` 全局语义未动（用户明令只改快捷入口）。实测：打字中返回 #1 收键盘、**#2 直接退出**（假单独模块直达桌面）。护栏 `captureBackExit.render.test` 6 例。已知边缘：IME 收起动画 ~200-300ms 内连按仍可能多吞一下；`useKeyboard.measure` 与新判据同源两处待收口。
- **拍照直出系统相机**（点单2）：根因 = Capacitor file chooser 两条确定性断点（Manifest 缺 `<queries>` IMAGE_CAPTURE、file_paths.xml 缺 external-files/Pictures 根）⇒ capture 静默退化相册（logcat 指纹 `Media capture intent could not be launched`）。A 层修根因（救活全部 `<input capture>` 路径）+ B 层自写 `CameraCapturePlugin`（ACTION_IMAGE_CAPTURE + FileProvider 落盘；取消返回 null 不回退、失败显式提示、**绝不静默开相册**）；dock 拍照 / 首页「拍摄」/ AI 拍照全收口 `takeCameraPhoto()`（动态 import 不占入口预算）。设备实测点拍照 → 焦点 `com.android.camera2/CaptureActivity`。walk 侧新增 `cameraCaptureStub.mjs`（nativePromise 拦截、canary 自证三层）+ `quicknote-insert-camera` 屏；AGENTS §7#24 重启交还已接。
- **多维表四项 + 行详情**（点单3 + task-5）：①选项色点改可点按钮 → 面板同款 `.mbt-feditor__colors` 色板（候选 = COLOR_BOARD_VALUES 桌面同源 70 色，用户裁决维持；「默认颜色」清空）；②表格↔表单几何同源收口（壳层只留安全区、`--mb-page-pad` 各内容块自管、`.mbt-is-form` 清零）⇒ 头部三态实测 [0,68,412] 恒定、表格内边距/计数恢复；③表单失焦后拖滑杆不再回弹键盘（`bitablePointerFocus` 本地收紧——共享 dismissKeyboardOnPointerDown 对任何 input 早退致文本框不真失焦；记录编辑面板同型一并修，字段面板实测无触发面）；④只读行详情页 `.mbt-page-bar` 补 topChrome overlay 契约（不再压状态栏）+ 打开跳变改同批通知。F-D 多选头部 `.mbt-headslot` 同槽换装（消除 50px 跳）；F-G `.mb-menusheet__submenu` 安全区消费 + SURFACE_MARKERS 登记。
- **标签移除 × → 长按动作菜单**（点单4，用户裁决）：详情条目（文档行/小记卡同语义）长按 350ms / 右键弹 MobileSheetMenu（打开 / 移除标签 / 取消）；长按唯一实现 useLongPress（`useTagRowMenuPress` 只做接线：按钮上不起手、吞后续 click）；二次确认与落库链路不变。**设备点收未做**（契约面无标签 API，自动种夹具不可行）。
- **跳变八项**（261119 跳变审计，已删 git 可查；只读、含「丝滑准则」）：F-A 文档内查找条改覆盖式（正文几何零位移，实测 top 60→60）；F-B/C/H `QuickNotePreview` **slotFrame 恒定槽位**（占位/富预览/内核兜底同槽同高 + 展开/收起位移过渡走令牌 + reduced-motion；多图卡 220px 恒定槽、文本卡 5 行摘要槽——用户裁决维持）+ 首屏 8 条预热（quickNotePrewarmIds 单一判据）；F-E 重依赖首开同构骨架 `NotePaneSkeleton`（bitable/usheet/ink 三型，不再「空态→骨架→查看器」三段换构）；F-F 预览层入场走 `--mobile-duration-panel`。kind 触点登记 +1（NotePaneSkeleton 3 处 = 骨架形态分派）。
- **README 双语/徽章 + 现状对齐**（点单）：语言徽章（中/英互链）+ 两行信息徽章（release/license/downloads 活徽章 + **闭源内核橙色 honesty 标** + platforms/node/editor/sync/guide/update）+ 正文 15 处纠错补新（空间顺序 = 知识库/小记/标签/AI/日记、⌘1–5 映射、多维表 5 视图、端口 19877/19876·19880/19881、便携包手机导出、Android 卸载保留、IconPark 致谢…）；`README.en.md` 整份英文（19 节 1:1、事实零漂移、术语表统一）。guide 用户手册空间顺序对齐 8 文件 26 处（改前核实 HOME_TABS/快捷键代码）+ `settingsSearch`/`defaultSpace` 旧序残留清零。
- **视频宽度弹窗内核化**（点单二轮终裁）：一轮 ln-menu 形态被用户改判「与图片工具栏一致」⇒ 改 **CardMenu 内核家族**逐像素同族（5px 圆角/无 hairline/30px 行/14px 字/30px 对勾槽）；`cardMenu.tsx` 组件级单一来源（renderImage 四菜单与视频弹窗共用）；「应用」= 内核 antd Button（KButton）。**用户裁决 = 例外于 ln-* 单一来源**（卡工具条内核家族表面），已注释留档。图片「宽高」弹窗（imgsize）仍旧形态未动。
- **预算登记（用户批准）**：`check-bundle-budget.mjs` mobile-entry-js **51,200 → 51,440**（本批真实功能增量；已做拍照动态 import 瘦身 -255B；实测 51,359，余 81B；**再涨须重新论证**）。
- **门禁（终轮全量）**：`tsc` 0；全库 vitest **1053 文件 / 6663 例（14 skipped）0 failed**；`ui-metrics` 0（!important 9/9、跨文件重复 45/45、shadowed 0）；`check:core` 181 文件 0 违规；`check:mobileui` / `check:arch`（desktop 599,783/600,000）/ `check:bundle`（mobile entry 51,359/51,440）/ `git diff --check` 全过。
- **设备验收（模拟器 lake_mobile，已装包）**：速记返回链 / 表单焦点不回弹 / 拍照直出相机 / 视图切换头部恒定 / 查找条零位移 **5 项 PASS**；多维表 7 屏探针 7/7（字段色点、编辑记录面板截图核对）。**待点收**：标签长按菜单、视频弹窗桌面实机观感、真机（小米）拍照复核（MIUI OEM 步骤见 task-2 报告）。新验收探针 `scripts/mobile-audit/form-focus-accept.mjs` / `doc-find-camera-accept.mjs`（自建自清、可复跑）。

### 261117 · 六流并发批（P0/P1/P2 全推进）+ v1.4.0 发版

用户授权自主收口：P0 两项 + P1 四项 + P2 两项由 6 个并发流（写入范围互斥、lead 集成）交付，随后全量 review、双推、打 tag 发版。

- **P0-1 gone 只读横幅**（`e112ff78`）：打开中被删/进回收站即时横幅（`isGoneNote` 单一判据 + `noteGoneState` 原料 trashedAt/isPurged 投影）；渲染映射一处收口强制只读（boardEditorMount 护栏不破）。
- **P1-5 表单草稿**（`f21eef37`）：设备本地暂存（localStorage，键 `bitable-form-draft.<noteId>.<viewId>`）、提交后清空、题目指纹（id:type 有序）变则弃。
- **P2-8/9 视觉收尾**（`5a385749`）：chat 档思源化（与 light 同值收敛，决策点留 MOBILE-DESIGN）、OLED 平涂补漏、对比度越界三处修正（light text-4 / dark text-3/4 块面）、动效归一到令牌、reduced-motion 名单补同步条+灯箱（+HomePage FLIP 令牌）。
- **P1-7 Univer 键盘**（`2e1843d4`）：公式栏预留 44→48 对齐 vendor `!univer-h-12`（贴底格裁 4px、进出编辑跳 4px 的根因）；`keyboardCoverage` 判据 + vendor 实高动态对账护栏。
- **P1-4 多维表第二梯队**（`ba2c05e5`）：列头快捷菜单（排序/筛选/清除）、字段拖拽重排（`view.fieldOrder`）、长按批量选择删除（quickNoteSelection 同语义 + selection 原语）；拖拽手势单一实现 `useBitableOrderDrag`。
- **P1-6/P0-2 设备专员**（`7596a923`）：CDP 自动重连（Input.* 不重试防双击、桌面端口不劫持）、多维表 7 屏探针（7/7 绿）、缺正文/缺小记恢复演练 11 项全绿（`docs/RESILIENCE.md §3.7`）、欠账清单 `docs/DEVICE-DEBT.md`（261125 搬存；真机 6 项显式登记；**2 万/20 万规模验收 = 用户裁决不做**）。
- **集成修复**（`9c46cde1`）：**便携包导出 wal_checkpoint(TRUNCATE)**（演练实锤真缺陷：陈旧主库把已删行误判缺正文、拒绝导出的死胡同）；两份快照基线重烤（思源换值 + 字段行改版，**两轮 0 差异**：mobile-snap 10 态 + bitable-snap 3 态）。
- **产品边界已收口**（用户裁决「都需要做」，tag 后两笔随下版发布）：① 小记 text_cache **保存即建**（`persistQuickNoteContent` 挂点）+ **与 FTS 解耦无条件写**（恢复兜底不该依附搜索；`quickNoteSaveIndex.test` 3 例 + missingBodies 用例换新语义「刚保存即有可重建纯文本」）；② 更新中心版本标签**不再打假版本号**（appInfo 未就绪如实「已是最新版本」，`updateCenterStatus.test` 钉死无 0.0.0）。
- **门禁**：tsc 0；全量 vitest **1038 文件 / 6583 例 0 failed**；ui-metrics / check:mobileui / check:arch / check:bundle / diff-check 全过；7 屏探针 7/7；已装 lake_mobile 待用户点收（gone 横幅 / 多维表三件套 / 表单草稿 / usheet 公式栏）。
- **发版**：`d556888d release: v1.4.0`（RELEASE-NOTES 已补段）；注解 tag **v1.4.0** 双推（Gitee+GitHub），release.yml 流水线 **completed/success**——macOS（arm64/x64 dmg+zip）/ Windows Setup.exe / Android release apk（32.1MB）构建全绿，Publish 完成，Release 资产 8 个（含 latest.json 更新中心清单）；master 在 tag 后另有 text_cache/版本标签两笔修复随下版发布。

### 261117 · 图片/视频缩放重构（用户点单：对齐思源手感；动图复核后二轮修视频闪烁）

- **一轮（体验重构）**：旧「边缘拖拽」三病根治 —— ①映射系数错（图宽/卡宽逐帧重算 ⇒ 不跟手/越缩越快/突变；测试 mock 缺卡片 rect 走 fallback，从未测到真实映射）；②把手贴卡片盒而非图片盒（图片卡正文满宽）；③内核四角 resizer 被右缘把手覆盖 + 画框预览松手跳变。新架构 = `mediaResizeGeometry.ts` 纯几何（**起点快照 + 总位移×对齐系数**，思源 multiple 1/2）+ `mediaCardResize.ts` 引擎（拖动零布局读取）：**把手只在会动的边**（左对齐 = 右缘长条 + 右上/右下角点；右对齐 = 左侧 3 个；居中 = 两侧 6 个），把手盒贴 img 实测盒、1:1 跟手；内核 `.ne-ui-image-resizer*` 由 CSS 隐藏接管（保留 selection box 描边）。
- **二轮（用户动图复核：图片已稳、视频仍剧烈闪烁/突变）**：抽帧取证（GIF 255 帧连帧 f_008/009）实锤根因 = **拖动中布局回写互相打架**（`mountVideoCardLayoutSync` 扫描把持久化旧宽度投影回拖动中的卡 ⇒ 整卡跳回原尺寸；transform/真布局两版共享此根因）。「闪烁」是尺寸跳变不是视频重绘（暂停视频改尺寸与图片同级稳定）。修复：**拖动锁**（`lockVideoLayout`：拖动中禁 applyVideoLayout 回写 + 自扫描跳过）；**中断=提交**（pointercancel/失焦按当前值提交不回退，Esc 才取消）；**提交失败不弹回**；`__videoWidth` 归一化 1 位小数（松手零跳）。
- **三轮（用户复核：transform 预览不行 —— 缩小时框/把手不跟、放大无法预览、松手剧变；点单「上下位置间隔实时变化」）**：transform 路线**已回退**（合成预览冻结布局 ⇒ 间隔不动/放大被裁/松手落真实布局剧变；jsdom 测试看不出这类渲染问题，教训 = 视觉行为必须真实渲染器验证）；视频预览回到**直写 `--lake-video-max-width` 真布局**（间隔/把手盒实时走位，拖动锁保证不再跳变）。**用户裁决：图片/视频两套预览逻辑分开维护，不强求公共方法**（图片 = img.style.width + 手动盒跟踪「非常稳定」；视频 = 布局变量 + inset-0 自动跟随）。
- **验证**：mediaResizeGeometry 3 例 + mediaCardResize 14 例 + videoCardOps/Fit 9 例全绿（含「分 100 次 1px 拖不跑飞」「拖动锁」「transform 预览零重排」「Esc 取消/中断提交」）；tsc 0；全量 vitest 0 failed；ui-metrics/cssLayers/mobileLayers/check:core/check:arch/check:bundle 全过（层围栏 feature.css 347 / edit-surface-kernel.css 140 已登记）。**待用户复核**：桌面拖视频（不闪/不回弹）；移动端已改共享模块需装包验收。
- **落点**：`src/features/editor/mediaResizeGeometry.ts`（新）/ `mediaCardResize.ts`（重写）/ `videoCardOps.ts`（拖动锁 + transform 预览 + 宽度 1 位小数）；CSS `src/styles/feature.css` + `src/mobile/editor/edit-surface-kernel.css`；契约 [LAKEX-CONTRACT](LAKEX-CONTRACT.md) §5.56/§5.58 已回填。

### 261117 · 多维表 UI 审计 + 9 项修复（用户点单：都推进）

- **审计**：261117 多维表 UI 审计（已删 git 可查；多维表表面族；含已排除的假信号——表头"深灰"系缩略图错觉，computed #eee 正常）。
- **修复（9 项）**：① kit.css 补实现 **`.mb-tap` 命中盒工具**（44 Rule 约定机制此前注释引用但规则缺失，树行动作裸奔；实现后既有 mb-tap 目标同时达标）；② 选择器 toggle 命中盒 + 已选区行 role/键盘；③ 多维表头部按钮命中盒；④ 记录详情只读文案按收集表语境分支（普通记录不再冒充收集表）；⑤ **详情页「编辑」入口**（用户裁决：进入编辑并打开编辑面板；编辑锁/正文不可读不渲染，onRequestEdit 自 toggleEdit 贯通）；⑥ 创建动词统一「新建记录/新建字段/新建选项/新建视图」；⑦ 字段铅笔 aria 统一「修改字段」；⑧ 网格值溢出 +N 徽标；⑨ cell aria-label 带值。
- **验证**：全量 `src/mobile` 343 文件/1763 例全绿；tsc 0；mobileLayers 基线 kit 651→659、mobileBitable 1094→1097 登记；已装 emulator-5554。

### 261117 · 推广「项移动选择器」+「拖拽调高 Sheet」（用户点单）

- **推广内容**：① 选择器抽单一来源 `bitable/BitableSelectControl`（记录面板 + **表单视图**共用「项移动」交互，表单填写态不显示「新建选项」）；② MobileSheet 的 `resizable` **默认开启**（~50 个 Sheet 调用点一处生效，头部拖拽调高成为全站统一手势），手写 PickerSheet 同款挂 `useSheetResize`；③ 多维表内容面板默认 72dvh（`mb-sheet--tall`：字段管理/修改字段/视图配置/视图列表）。
- **验证**：FormView/表单提交断言换折叠式契约；全量 `src/mobile` 343 文件/1763 例全绿；tsc 0；已装 emulator-5554。

### 261117 · Sheet 头部拖拽自主调整高度（用户点单）

- **需求**：编辑记录弹窗太矮、浪费上边区域，长数据行展不开，要能自主上下调整。
- **实现**：新 hook `ui/useSheetResize` —— Sheet 头部（grabber/标题行）拖拽调高度：上拉变高、下拉变矮、**松手停驻**（自由停驻）；拖到最小高度（35% 视口）继续下拉过阈值松手 = 关闭；范围 [35%, 92%] 视口。**手势边界**：`useSwipeDownDismiss` 新增 `ignoreSelector` 忽略头部起点（内容区下滑关闭/列表滚动语义不变）。MobileSheet 加 `resizable` 属性（原语单点实现）；记录面板启用 + `mb-sheet--tall`（默认 50dvh → 72dvh）。
- **验证**：纯判据 2 例 + render 2 例（上拉/下拉停驻、最小高度关闭、头部拖拽不触发下滑关闭）；全量 `src/mobile` 345 文件/1764 例全绿；tsc 0；已装 emulator-5554。

### 261117 · 记录面板单选/多选折叠式选择器（用户点单，已确认两点理解）

- **改造**：默认收起只显示已选值摘要（不再平铺全部选项）；点摘要行展开候选 —— **选中 = 勾选 + 主色选中三件套**（选项色底只给未选中做色相标识，修复「选中看不出来」）；单选点选即完成并收起、多选连选后点摘要收起；**「新建选项」= 跳字段编辑器**（回车流转批量录选项），记录面板内联录入删除（viewer 的 addMobileOption 链路退役，选项创建统一归字段编辑器）。
- **落点**：`MobileBitableRecordSheet.SelectControl` 重写 + viewer `onEditField` 接线（复用 editingFieldId）；mobileBitable.css +23（mobileLayers 基线登记「新增交互形态」）。
- **二稿（用户追加）**：**「项移动」模型** —— 选中的项移到上方已选区、候选区只留未选中（同一选项不重复出现）；点候选 = 移上来（单选取代/多选追加）、点已选项 = 移回下方；左对齐、宽度拉满；选择过程保持展开（移动看得见）。
- **验证**：静态断言换新契约 + `mobileBitableRecordSelect.render.test` 3 例（去重/项移动/单选取代/多选追加移除/新建跳编辑器）；全量 `src/mobile` 344 文件/1762 例全绿；tsc 0；已装 emulator-5554 待用户复核（Nbcss → 编辑记录 → 点「状态/标签」字段行）。

### 261117 · 完成编辑出口 + 树行图标分型（用户点单）

- **① 完成编辑出口**（选项编辑到最后收不了键盘）：不加新按钮，用 Android 惯例 —— **返回键优先收键盘**（`consumeBack` 全局前置：焦点在输入上时第一次返回只收键盘、不触发返回，全站生效）+ **点 Sheet 标题区/手柄收键盘**（MobileSheet 原语挂 `dismissKeyboardOnPointerDown`，全站 Sheet 生效）；收起键盘后底部「确认」露出即完成编辑。
- **② 树行默认图标按 kind 分型**（此前 3 个不同类型同图标）：对齐桌面 `treeIcons.tsx` 语义（分组开合 folder/folder-open、表格 table、多维表 database、画板 pen-tool、手写板 pen-line、文档 file）；数据层 `notebookTreeRepository` 补 `doc_kind → noteKind` 投影（树模型此前丢弃文档类型）。
- **验证**：全量 `src/mobile` 343 文件/1756 例全绿；tsc 0；已装 emulator-5554。**待用户复核**（含下条待确认的记录面板交互改造）。

### 261117 · 多维表选项编辑回车流转（用户点单）

- **需求**：多选/单选加选项时回车 = 完成当前选项并跳到下一个（没有下一个就新增并聚焦）——此前没有可靠的「完成当前选项」方式。
- **落点**：`MobileBitableFieldEditorSheet` 选项输入接 Enter（IME 组字不触发；聚焦走 state + effect，refs 挂载后聚焦，无 rAF 竞态）；记录面板 SelectControl 的加选项 Enter 已是「提交并选中」，语义不同保持不变。
- **验证**：render 测试 7/7（跳下一个/末尾新增并聚焦/IME 组字不流转/选项名不丢）；bitable+hooks 36 文件/183 例全绿；tsc 0；已装 emulator-5554 待用户复核。

### 261117 · 键盘覆盖输入框修复（多维表输入面 + 全面排查）

- **现场**（用户截图）：多维表「编辑记录」面板输字段内容被键盘盖住；输选项、名称同样被盖。
- **根因（两类）**：① `useKeyboardStableSheet` 的露出滚动只滚 `.mb-sheet__body` —— **表单内容不足一屏/已滚到底时没有滚动余量，scrollTop 调不动 ⇒ 输入框永远留在键盘后**（261106 task-94 的设计意图「钉住弹窗 + 输入框保持可见」的后半句在小表单上天生失效）；② 内层滚动容器（字段编辑器选项行等）只滚最外层够不着。排查另发现：AiCorpusSheet 手写 Sheet 带输入无键盘补偿；多维表**表单视图**（随视口收缩的独立面）无键盘露出机制。
- **修复**：`useKeyboardStableSheet` 增强 —— 滚动链逐级滚（共享工具 `revealActiveInputWithin`）+ **滚动余量不足时抬 Sheet 兜底**（`liftToReveal`：只动 top、不改高度、restore 统一还原）；新增轻量 `useKeyboardRevealFocus`（无钉几何，给随视口收缩的面），多维表表单视图已接；AiCorpusSheet 直接挂 hook。
- **全面排查（28 个输入面归类，钉进 `keyboardSheetAudit.test.ts`）**：MobileSheet 系 14 个（编辑记录/字段编辑器/字段管理/视图与表操作/移动/标签/命名/搜索/S3 导入/AI 资料…）统一由原语覆盖；手写 Sheet 带输入必须直接挂 hook（**通用扫描规则**防再漏）；随视口收缩的非 Sheet 面必须挂 useKeyboardRevealFocus（表单视图）；编辑器/写作卡走 editSurface 既有 owner；设置抽屉行内输入随视口收缩 + 原生 focus 滚动（无风险）；数据表抽屉搜索框位于顶部（无覆盖面，登记不改）。
- **护栏/验证**：`useKeyboardStableSheet.render.test.tsx` 10 例（+小表单抬升、内层滚动 2 场景 + liftToReveal 纯判据）；`keyboardSheetAudit.test.ts` 5 例（清单补录 + 两条通用规则）；tsc 0、相关 28 文件/127 例全绿；真机实测命名弹窗输入 covered:false（inputBottom 370 ≤ visibleBottom 522）。**待用户复核**：多维表（Nbcss = 你截图的「数据表 1」）的编辑记录/字段编辑器/表单视图三场景 —— 修复构建已装 emulator-5554。

### 261117 · 移动端思源观感换肤（分支 `theme-siyuan-mobile`，进行中）

- **用户裁决**：仅移动端、替换默认浅色主题（含深色跟随）、布局/行为不动；参考 = 模拟器思源 App + siyuan-master 主题源码。视觉口径登记 `docs/MOBILE-DESIGN.md` v3 节。
- **已做**：`theme/light.css` / `dark.css` 全量换取值（思源 daylight/midnight 映射：白面+中性灰+发丝线、主色 #3575f0、文字灰阶保 AA 合同、材质平涂化）；设备截图对照通过。
- **注意**：① 分支上 `git status` 里的非主题文件 = 桌面会话在途改动的**未提交覆盖层**（构建用，不入本分支提交）；② 214ba68b 提交混入了两处他人文件级改动（MobileApp/OutlineSheet），其依赖尚未提交 ⇒ 单独 checkout 该提交 tsc 会红，等桌面会话批次落地自然闭合；③ 合并前 mobile-snap 基线必须重烤（主题必然漂移）。
- **待做**：深色档设备抽查、暖色/清爽档是否跟随（待点单）、MOBILE-DESIGN v2 节存废整理、合并评审。


### 261117 · 附件超限统一提示（图片/视频/PDF/所有附件）

- **问题**：视频/PDF/普通附件虽按设置拦截，但只给卡片内泛化错误；图片还有独立 25 MiB 硬限制，用户把附件上限调到 50/100 后图片仍失败，且提示不说明当前文件多大、上限多少、去哪里调整。
- **修复**：新增 `lib/attachmentLimit` 单一错误与通知总线：文案包含文件名、实际大小、超出量、当前上限和「设置 → 常规 → 附件大小上限」。`uploadLakeResource` 在大字节读取/队列/重试前预检；Android `bridge.uploadResource` 对表格/多维表/画板/手写板直连入口同样预检；手写板 PDF 导入也复用同一口径。
- **设置生效范围**：25/50/100 MiB 现在对本地选择的图片、视频、音频、PDF/普通附件统一生效；底层协议硬上限仍 100 MiB。`MAX_IMAGE_BYTES=25 MiB` 收窄为网络图片下载/小记旧入口的内存护栏。设置页说明同步写明覆盖图片、视频、PDF 和其他附件。
- **通知**：桌面 `useDesktopShell` 订阅后显示 8 秒通知 +「打开设置」，直达常规设置；Android error toast 12 秒。
- **实测**：开发版当前上限 50 MiB，插入 50 MiB+1 B PDF：错误与桌面通知均显示“文件大小 50 MiB（比上限多 1 B），当前附件上限 50 MiB…”，点击「打开设置」真实打开常规设置；超限文件未落盘（首轮误放行测试资产已清理）。
- **门禁（261117 15:58 最终）**：`tsc`、`typecheck:electron` 均 0；全量 vitest **1025 files passed / 13 skipped（6499 tests passed / 14 skipped）**；`check:mobileui`、`check:bundle`/arch（mobile entry 50,639/51,200、首屏 346,441/350,000；桌面 599,783/600,000）、`check:core`、`git diff --check` 全过；Android `--sync --install` 已装 emulator-5554 并启动。
- **护栏**：`attachmentLimit.test.ts`、`resourceUpload.limit.test.ts`、`attachmentLimitWiring.test.ts`、移动桥 `attachmentLimit.test.ts`、PDF 导入/跨端资源契约。文档：[docs/LAKEX-CONTRACT.md](LAKEX-CONTRACT.md) §5.57。

### 261117 · 长按＋「速记」失效修复（261114 空间顺序重排的回归）

- **现场**（用户试机发现）：长按首页「＋」上滑速记、新建面板「空白小记」都建不出小记 —— 手势浮出「继续上滑记小记/松手记一条小记」正常，松手后写作卡不出现、tab 自己跳回「知识库」。
- **根因**（设备逐拍打点实锤）：`HomePage`「写作时锁横滑」效应硬编码 `stage.scrollTo({left: 0})` —— 261019 引入时空间顺序「小记」在第 0 页、恰好正确；**261114（v1.1.4）空间顺序改「知识库/小记/…」后第 0 页变成知识库** ⇒ 写作卡一挂载分页器被滚到知识库页 → `settled` 回写 tab → `[tab]` 重置效应清掉写作卡。与 Top Chrome 批无关（考古：scrollTo(0) = `244fd8e7` 10-19；顺序重排 = `f2c44c1b` 11-14）。
- **修复**：归位改走分页器机器新增的 `useTabPager.alignNow()`（复用 resize 分支：对齐 `state.tab`、auto、programmatic 标记同链路），HomePage 不算页码（守住 homeCreateFlow「HomePage 不再自己做分页判据」护栏）；`homeCreateFlow.test.ts` 补回归断言（禁 `scrollTo({ left: 0`、必须 `alignNow()`）。
- **验证**：`tsc` 0；`src/mobile` vitest **343 文件 / 1750 例全绿**；手势探针（CDP 真实 touch：长按 450ms → 上滑 60px → 松手）前后对照 = 修复前 `qn:false tab=知识库` → 修复后 **`qn:true scrollLeft=412`**；设备截图写作卡完整（键盘/dock/保存栏）。已装 lake_mobile 待用户复验。

### 261117 · 移动端顶部 Chrome 契约落地（方案 B：B0–B2，移动端会话，工作树）

- **背景**：顶部安全区重复/漏消费一族 bug（261027 / 261103 / 261110 / 261115 / 261117）根因 = 安全区是全局事实、消费散在局部组件。按 [docs/MOBILE-TOP-CHROME-REFACTOR.md](MOBILE-TOP-CHROME-REFACTOR.md) **方案 B** 落地：B0（契约+门禁）/ B1（viewport·overlay）/ B2（nested·sheet）一批完成，几何数值等价重写。
- **契约**：新文件 `src/mobile/topChrome.css` —— 顶部表面 JSX 声明 `data-mb-topbar` + `data-edge`（viewport/overlay = 贴屏幕顶、消费顶部安全区一次；nested/sheet = 恒 0）+ `data-size`（内容高 compact 44 / regular 52）；几何 = `--mb-chrome-content-h` + `--mb-chrome-inset-top`。全表面已标注（topbar 家族 / 设置页头 / 标签·日记页头 / 抽屉工具栏 / 多选顶栏（新增 `edge` prop）/ 表格 / 多维表 / Sheet 头 / 标签页列表 / 附件预览）。**iOS 口子**：契约不感知平台，inset 喂值通道唯一 = `theme/tokens.css`（`env()` ∪ 原生 `--mobile-native-*-safe`），iOS 换喂值后端不动任何消费方、edge 语义整套复用。
- **261117 AI 内嵌副栏修复已收编**：原「本地复位高度/上边距/上内距」改为契约派生（`data-edge="nested"` ⇒ inset 0）；`aiLayout.test.ts` 升级为契约口径；新护栏 `src/mobile/topChromeContract.test.ts`（表面声明全覆盖 + `var(--mobile-top-safe-area)` 允许清单棘轮仅 4 处 + 契约映射钉死）。
- **两处行为修复（仅 inset>0 设备可见，safe=0 几何不变）**：① `.mobile-model-head`（标签页列表**底部 Sheet** 头）此前误吃顶部安全区 ⇒ sheet inset=0；② `.mb-sel-topbar`（多选顶栏）261107 v2 重做时丢失的顶部安全区补回（抽屉/首页多选态，与抽屉工具栏同高不跳变）。死规则 `.side-panel .mobile-page-head` 已删。
- **门禁**：`tsc` 0；`src/mobile` vitest 343 文件 / 1750 例全绿；`check:mobileui` / `check:bundle`（mobile CSS 140,039/141,312、首屏 345.2KB/350KB、entry 50.4KB/51.2KB）/ `check:arch` 0 违规 / `git diff --check` 全过；mobileLayers 登记 topChrome.css（10 decls），mobile.css 1491→1486、ai.css 383→380 收紧。Android `--sync --install` 已装 **lake_mobile（5554）**待用户验收；**lake_gate 10 态对拍**：旧夹具数据 + 新包首轮 **8/10 态 0 差异**（含改动最大的 home-doc / home-library / settings 全绿 ⇒ 迁移数值等价获正面证明），2 态差异归属 261117 其它批次的设置页文案（settings-about 元素 +23 = 「卸载与换机」引导新增；基线 11-16 12:00 烤制早于该批）⇒ 按 §5.3 重烤基线，verify 两轮 **0 差异**。
- **§8.4 几何探针已落地（261117）**：`scripts/mobile-audit/top-chrome-geometry.mjs`（四档注入安全区 × 8 页面 × 三不变量断言，实测 **8/8 页 0 违规**；AI 内嵌头恒 44 的动态钉子在内）。用法 `node scripts/css-audit/drive.mjs 9336 scripts/mobile-audit/top-chrome-geometry.mjs`。
- **B3 剩余（§12）**：过冲 `--mb-chrome-inset-overhang: 8px` 归一化（需 §8.3 矩阵复验 + 用户裁决）；全量设备矩阵（两处行为修复需 inset 模拟 32/48 复核；多选顶栏/标签页列表/表格多维表头部/带标题 Sheet 等探针盲点一并覆盖）。

### 261117 · Lakex 图片/视频媒体卡自适应、边缘缩放与对齐

- **现象**：Lake 视频完成态固定 `450px` 高，16:9 出现上下白边；竖屏铺满正文宽后出现左右白边，且无条件居中不适合竖屏排版。官方 video 配置没有尺寸/object-fit/对齐项。
- **修复**：不改 vendor。video `toLake` 原样保留 cardValue，故用 `cardData.resetCardValue + sync(false)` 持久化 `__videoWidth`（正文可用宽度百分比，10–100，缺省 100）和 `__videoAlign`（left/center/right，缺省 left）；`videoCardOps` 把宽度投影为 `--lake-video-max-width`，完成态按 intrinsic ratio 自适应。**100% = 正文栏宽度，不是原图像素**；移除 `72vh / 720px` 高度二次封顶，解决竖屏视频 75% 与 100% 被压成同宽。
- **新视频闪烁根因**：两个视频文件 SHA-256 一致（`c8edf372…14de`）；新插入视频保持 `status=uploaded` 且已完成任务残留在 UploadObserver/卡实例 `_task`，旧视频重开后是 `status=done` 且任务表为空。50 次宽度变更：旧约 138ms、新约 231ms；清空残留任务后约 149ms。现上传成功自动归一 `done`；线程仍存活时仅在空闲后归还 manager，线程已结束（`_thread=null`）时也清掉卡实例 `_task`。
- **交互**：视频左右边缘拖拽，拖动用合成层 transform 预览、松手持久化；键盘 ←/→ 每次 5%、Home/End 到 10/100%。图片新增右侧边缘把手，松手走 `updateImageData`；**内核原生四角 resizer 保留并与右边框共存**。图片边/角、视频双边缘共用 `mediaCardResize`。
- **实测**：当前竖屏视频 75% 为 `386×685`，100% 为 `513×910`；拖动 +7.8% 实时变宽并写入 `__videoWidth:83`，随后已还原用户原值 75%。此前横屏 25% 为 `130×73`，右对齐贴正文右缘。护栏 `videoCardOps.test.ts` / `videoCardFit.test.ts` / selection-toolbar wiring；CSS 层围栏登记。
- **门禁（261117 15:58 最终）**：媒体/CSS 定点 **35/35**；`tsc`、`typecheck:electron` 均 0；全量 vitest **1025 files passed / 13 skipped（6499 tests passed / 14 skipped）**；kind 触点与 IME 入口护栏已随最新代码同步；`check:mobileui`、`check:bundle`/arch（mobile entry 50,639/51,200、首屏 346,441/350,000；桌面 599,783/600,000）、`check:core`、`git diff --check` 全过；Android `--sync --install` 已装 emulator-5554，`MainActivity` 已 resume。
- **文档**：[docs/LAKEX-CONTRACT.md](LAKEX-CONTRACT.md) §5.56 / §5.58。

### 261117 · 正式数据三问题修复（打开伪保存 / 大纲二次跳 / renderer 恢复空窗）

- **打开 Java 文档即出现保存点**：正式库指定文档在隔离副本中稳定复现：打开约 250ms 后标签 dirty，1.25s 后自动保存，但正文 SHA-256 前后不变，主进程 `NoteContentRepository.save()` 走无变化早退。根因 = `setDocument()` 初始化阶段晚到的 `contentchange` 在同步 `setting` 标志关闭后才到，被当成用户编辑。
- **修复**：`EditorTab` 增加 `userContentIntent + initialBaseline`：无用户意图时只有当前正文与打开基线逐字节相同才忽略 contentchange；内容真的变化或序列化失败仍会标脏，宁可多存不能漏数据。图片卡自愈仍通过显式 `onChange` 落盘。另修退出草稿：unmount / beforeunload 统一 `captureContent(noteId) ?? tab.content`，不再用 doc 的“最后已提交版本”作为兜底。隔离实例验证：打开不再出现保存点、不再触发 `note.save`；真实输入仍 dirty→1s 后正常保存。
- **大纲点击二次上跳**：正式 JVM 文档隔离复现：首次对齐 `targetTop=0`，约 250ms 后引擎高度 `23584→23538`、目标变 `-27px`；原 50/200ms 固定校正正好漏掉。改为 `stabilizeNodeAlignment()`：ResizeObserver(`.ne-engine`) + rAF 持续锚定，安静 1s 停止、最多观察 2.2s，用户滚动/输入立即取消；桌面自建大纲、Lake 原生大纲、锁定态与移动端 OutlineSheet 共用。
- **启动偶发空窗**：发现一条可稳定复现的空窗路径 —— renderer 崩溃后原实现只 `reload()`，窗口保持可见且等待隐藏态 rAF，可能一直不报 renderer-ready，最终 8s fallback 露出未绘制窗口。现在主窗新增主题底色；崩溃重载期间隐藏主窗、重新显示 boot；`renderer-ready` 不再只依赖 rAF（250ms timeout 兜底）；boot→主窗切换顺序改为 hide boot → show main → destroy boot。Page.crash 实测 boot 显示后主窗正常恢复（`renderer-ready` 88ms）。正式版此前偶发空窗是否同一路径仍需后续日志确认，但已消除该确定路径。
- **最终实测**：大纲修复后同一场景 `targetTop` 全程保持 `0`（布局高度变化时同采样周期完成校正）；打开文档不触发 `note.save`，真实输入仍 dirty→1s 后保存。
- **门禁**：`tsc` + electron typecheck 0；全量 vitest **1018 passed / 13 skipped（6461 passed / 14 skipped）**；`check:core` 0 违规；`check:bundle`/arch PASS（desktop 首屏 598.2/600KB）；`git diff --check` clean。

### 261117 · Android AI 内嵌副栏重复顶部安全区修复（工作树）

- **现场**：Android AI 分页的历史/新对话图标被推到内容中部，顶部出现一整段断层（用户截图）。
- **根因**：AI 以首页第 4 格内嵌后，副工具栏仍复用全局 `.mobile-topbar` 的顶部安全区高度/上内距；它位于首页顶栏**之下**，导致顶部安全区被结算两次。模拟器注入 32px 顶部安全区可稳定复现。
- **修复**：`.mobile-ai-page--embedded .mobile-ai-page__head` 固定为 44px，并清零 `margin-top` / `padding-top`；新增 `aiLayout.test.ts` 防止内嵌副栏再次引用 `--mobile-top-safe-area`。首页顶栏与独立全屏 AI 页的安全区逻辑不变。
- **验证**：`tsc` 0；相关 vitest 4 文件 / 28 例通过；`check:mobileui` 通过；Android `--sync --install` 成功（versionCode 11306）；模拟 32px 顶部安全区后副栏 `top=68` / `height=44`，与首页舞台同顶，设备截图无断层。
- **方案文档**：[docs/MOBILE-TOP-CHROME-REFACTOR.md](MOBILE-TOP-CHROME-REFACTOR.md)：顶部 Chrome 的当前模型、A/B/C 三方案、推荐迁移顺序与设备验收矩阵。

### 261118 · v1.3.6 发版（端口固定化：查漏补缺）

- **发布**：`package.json 1.3.6`（Android versionCode 11306 由根 package.json 派生）；注解 tag **v1.3.6** 双远端推送。本批 = 1 commit（清理/补强，无正常路径行为变更）。
- **补强**：`LAKE_ASSET_PORT` env 与模块级 `ASSET_PORT` 都在**监听之前**固定 —— 资源服务因端口占用启动失败时，渲染层/URL 构造仍用本形态固定端口（不退回 19876 默认值，避免指向另一实例）；preload 只从 env 读端口（移除 `--lake-asset-port` 传参）。
- **清理**：HANDOFF/RELEASE-NOTES/AGENTS 与代码注释中的「+1..+10 回退 / 实际端口 / 归一化」表述改为固定端口口径；审计脚本 `scripts/mobile-audit/long-doc-dom.mjs` 的 `ASSET_PORT_FALLBACK` → `ASSET_PORT_DEFAULT`；本地 `release/` 旧打包产物（含旧 preload）已删（ignored，重建即可）。
- **测试**：新增占用失败后 `currentAssetServerPort()` 仍等于固定端口、`main` 在 `await startAssetServer` 前写 env、`assetServer` 在 `listenFixed` 前设 `ASSET_PORT` 三条断言。
- **隔离 dev 实测**：`LAKE_ASSET_PORT=19887` → `[asset-server] listening on http://127.0.0.1:19887`，渲染层 `window.lakeNative.assetPort === 19887`，token 存在；同形态占用时日志明确报错（无回退）——符合固定端口预期。
- **门禁（发版前全量）**：`tsc` 0；`typecheck:electron` 0；全量 vitest **1025 文件 / 6462 用例（0 failed）**；`ui-metrics` 0；`cssLayers`/`primitives`/`mobileLayers` 全绿；`check:arch` 0 违规；`git diff --check` clean。
### 261118 · v1.3.5 发版（端口方案简化：固定端口 + 测试/正式分开）

- **用户裁决**：撤销 v1.3.3/v1.3.4 的「资产 URL 端口归一化 + 自动回退」复杂化；端口固定，**正式与开发用不同端口**即可。
- **端口表（固定，不再回退）**：资源服务 packaged **19876** / dev **19877**；Web 客户端 packaged **19880** / dev **19881**；`LAKE_ASSET_PORT` / `LAKE_WEB_PORT` 可覆盖。端口占用时**明确报错**（日志/设置页可读），不静默降级、不再 +1..+10 回退。
- **为什么这样就够**：同一构建形态端口固定 ⇒ 正文里的资产 URL 永远指向同一端口 ⇒ 换实例/重启不改 contentHash、不触发同步更新；dev 与正式端口/数据目录都分开，互不干扰。
- **已回退**：S3 资产 URL 归一化（`normalizeLocalAssetPorts` / `canonicalizeNoteAssetUrls` / 渲染层 strip 端口）、`--lake-asset-port` 传参、`ASSET_PORT_FALLBACK_RANGE`/`WEB_API_PORT_FALLBACK_RANGE`、自动回退测试、`scripts/fake-s3-local.mjs` 与 `scripts/s3-config-zero-regression.mjs`、`docs/SYNC-S3-VERIFY.md`。
- **保留**：`currentAssetServerPort()`（启动时解析一次的固定值，供 store/导出/小记 URL 构造）、403 对允许 origin 回显 ACAO、资源服务安全面。
- **护栏**：`electron/assetServer.port.test.ts`（固定端口/占用报错/非法端口/403 ACAO/接线）；`electron/webApiServer.test.ts` 端口占用抛可读错误。

### 261117 · v1.3.3 发版（新建文档位置 + S3 端口归一 + 移动端便携包可恢复）

- **发布**：`package.json 1.3.3`（Android versionName 1.3.3 / versionCode **11303**，已装 lake_mobile 确认）；注解 tag **v1.3.3** 双远端推送。本批 = 4 commit / 44 文件。
- **新建文档位置（桌面）**：常规设置新增「顶部新增 / 末尾追加」（默认末尾，旧存档/非法值兼容）；作用是**同级插入**且**子级生效**，覆盖文档/表格/多维表/画板/手写板 + 分组（目录）+ 笔记本。排序逻辑抽为单一实现 `electron/treeSort.ts`（文档 notes+tree_nodes 两表同事务；目录/笔记本只有 tree_nodes），`store`/`noteMetadataRepository` 不再各写 SQL；IPC 8 个创建通道加可选 position（不新增通道，缺省 bottom 向后兼容）。护栏：store 行为测试 / IPC 透传测试 / settings 归一 / UI render / 接线与「排序单一实现」源码断言。边界：AI 生成文档与批量导入固定末尾；移动端新建仍末尾（桌面偏好）。
- **S3 端口归一化**：v1.3.3 曾引入「保存/上云归一规范端口 + 渲染实际端口」的复杂契约，**已在 v1.3.5 回退**（改为固定端口方案；相关脚本/文档已删）。
- **移动端便携包导出可恢复（D 项）**：设置「关于 → 卸载与换机」新增「导出便携包到文件」（MediaStore 下载目录，**卸载后仍留存**；API29 以下回退 SAF）；重装后可「从便携包导入」**整机恢复**（原生 restoreSnapshot：校验→隔离→拷回→提交，失败回滚、崩溃 pending 兜底；快照含历史/草稿/同步基线，**不含 S3 密钥**）。修掉两个真 bug：手机快照曾被导入器当桌面包拒收、MediaStore 给 `.zip.lln` 追加 `.zip`。设备实测：导出 16.8KB → `adb uninstall`（文件仍在）→ 重装 → 恢复，DB 三表与小记正文 sha256 与快照完全一致；坏包被拒不伤数据。文档 `docs/mobile/UNINSTALL-DATA.md` §1.3。
- **门禁（发版前全量）**：`tsc` 0；`typecheck:electron` 0；全量 vitest **1026 文件 / 6479 用例（1013 passed / 13 skipped；6465 passed / 14 skipped / 0 failed）**；`ui-metrics` 0；`cssLayers`/`primitives`/`mobileLayers` 全绿；`check:arch` 0 违规；`check:bundle` PASS（桌面首屏 593KB/600KB、移动 345KB/350KB）；`git diff --check` clean。
- **已知边界**：新建位置为桌面偏好；S3 云端历史正文旧端口（显示/导出已兜住）；移动端「从便携包导入」的系统文件选择 UI 未自动化（原生 pickAndStage 与桌面包同一条），建议人工复验；移动快照跨大版本 schema 无迁移。

### 261117 · v1.3.2 发版（Android 卸载保留数据）

- **发布**：`v1.3.1 → v1.3.2`（`package.json` 1.3.2；Android versionName 1.3.2 / versionCode **11302**，设备已装并确认）；注解 tag **`v1.3.2`** 双远端推送。本批 = 1 commit / 5 文件（manifest + 移动设置文案 + 源码护栏 + 调研文档 + 文档/HANDOFF）。
- **内容**：`android:hasFragileUserData="true"`（Android 10+ 系统卸载确认框的「保留应用数据」）+ 设置「关于 → 卸载与换机」备份引导 + **重装须同签名同来源**说明；**allowBackup 保持 false**（Auto Backup 25MB/隐私/网络开关语义，理由见 `docs/mobile/UNINSTALL-DATA.md` §3）。调研结论：思源移动端未开该属性、Auto Backup 规则覆盖不到大库 ⇒ 不照抄（文档 §6 带 file:line 证据与推荐排序）。
- **门禁（发版前全量）**：`tsc` 0；`typecheck:electron` 0；全量 vitest **1019 文件 / 6437 用例（1006 passed / 13 skipped；6423 passed / 14 skipped / 0 failed）**；`ui-metrics` 0；`cssLayers`/`primitives`/`mobileLayers` 全绿；`git diff --check` 0。
- **设备验证**：`android-build.sh --sync --install` 成功（APK 37.36MB）→ `dumpsys package` 确认 versionCode 11302 / versionName 1.3.2；早前 1.3.1 已用 `aapt2 dump xmltree` 验证合并 manifest（hasFragileUserData=true / allowBackup=false，无 backup 规则资源）。
- **待真机项（文档 §6.6）**：API 29+ 勾选保留 → 同签名重装数据在；不勾选基线；API 28 无选项；`adb uninstall -k`；debug/release 签名矩阵。

### 261117 · Android 卸载保留数据（hasFragileUserData；261117 用户点单）

- 用户点单「卸载不删资源/重装还在」：manifest 加 `android:hasFragileUserData="true"`（**Android 10+ 走系统卸载确认框才会出现「保留应用数据」**——应用信息或启动器卸载菜单一般都有，静默卸载 adb/商店不会；Android 9 及以下没有）；设置「关于 → 卸载与换机」常驻备份引导（桌面导出便携包 / 云同步），并写明**重装须同签名同来源**（正式版与开发版签名不同，不能交叉安装）。**allowBackup 保持 false**（Auto Backup 25MB 限额 + 隐私，理由见 docs/mobile/UNINSTALL-DATA.md §3；**不照抄思源**——它未开 hasFragileUserData、Auto Backup 规则也覆盖不到大库，文档 §6 有 file:line 证据）。护栏 `src/mobile/settings/uninstallData.test.ts`。

### 261117 · v1.3.1 发版（打包瘦身 + 属性弹窗 + 设置收敛 + 端口隔离）

- **发布**：`v1.3.0 → v1.3.1`（`package.json` 1.3.1；Android versionCode 11301 由根 package.json 派生）；注解 tag **`v1.3.1`**，双远端推送。本批 `v1.3.0..v1.3.1` = 5 commit / 44 文件（含 26 项设置/属性/端口/瘦身改动 + 8 个新测试/文档）。
- **内容**：① 端口隔离（资源 19876/19877、Web 19880/19881；261118 起固定端口、不再回退；见下条）；② 设置三项（更新频率 **24 小时/每周/每月**、主题**下拉**、标签数桌面 8 / 移动 6）；③ 属性弹窗「附件/历史版本」**可折叠（默认收起、不加载）** + 附件缩略图档位 + 回收站孤儿预览缩略；④ 明确「正文=原图，其余=缩略图」口径；⑤ **打包瘦身 −143MB**（见下条）。
- **门禁（发版前全量）**：`tsc` 0；`typecheck:electron` 0；全量 vitest **1018 文件 / 6433 用例（1005 passed / 13 skipped；6419 passed / 14 skipped / 0 failed）**；`ui-metrics` 0；`cssLayers`/`primitives`/`mobileLayers` 全绿；`check:arch` 0 违规；`check:bundle` PASS（桌面首屏 593KB / 600KB、移动 345KB / 350KB）。
- **验证**：打包产物实机 14/14 PASS（启动/文档图片+sharp 缩略/Univer 表格/多维表/画板/手写板/AI 设置/更新中心/导出 Markdown/导入 docx/导入 xlsx/小记/回收站/同步设置）+ `scripts/e2e-packaged-smoke.mjs` exit 0；移动端更新频率已装 `lake_mobile` 设备验证（选项 24 小时/每周/每月、168 落库）。
- **已知边界**：`better-sqlite3` 外平台 `.node` ≈14MB 未裁（需按平台打包）；属性弹窗收起态不加载图片（展开才请求）；移动端与桌面更新设置是两份模型（同判据手工对齐，未做单一来源重构）。

### 261117 · 打包瘦身（功能零回归）

- **结果**：`.app` **536 → 393 MB（−143 MB / −26.7%）**、`app.asar` **213 → 70 MB（−143 MB / −67.1%）**、`asar.unpacked` 34 MB 不变（**未动任何 native**）；打包 `dependencies` 27 → 9。详见 [BUILD-SIZE.md](BUILD-SIZE.md)。
- **怎么瘦的**：① 18 个**渲染层专用**包（16×`@univerjs/*` + `perfect-freehand` + `rxjs`）从 `dependencies` 移到 `devDependencies`（它们只被 `src/**` import、早被 vite 打进 `dist`，留在 dependencies 只会被 electron-builder 塞进 asar；@univerjs 子树实测 123.3 MB）；② 排除 `node_modules/openai/src/**`（−4.9 MB）；③ 排除全仓类型声明 `*.d.ts/.d.mts/.d.cts`（−3.8 MB）。三条排除收口在 `electron/buildTarget.ts::ELECTRON_PACKAGE_FILES`（单一来源）。
- **规则（长期）**：`dependencies` = **主进程运行时真正 require 的包**；渲染层专用一律 `devDependencies`。防回涨判据：`architecture.test.ts` R6 两条（dependencies 必须被主进程 import / 渲染层重包不得回流）+ `univerContract` 与 `noteExport.inkPdf` 的依赖分层断言（已同步成「devDependencies 合法」而不是删断言）。
- **功能零回归**：真打包产物实机 **14/14 PASS**（启动/文档图片+sharp 缩略/Univer 表格/多维表/画板/手写板/AI 设置/更新中心/导出 Markdown 图片提取/导入 docx/导入 xlsx/小记/回收站/同步设置）+ 官方 `scripts/e2e-packaged-smoke.mjs` exit 0；门禁 tsc/typecheck:electron/全量 vitest（1005 文件 6419 用例）/ui-metrics/cssLayers/check:core/check:arch/check:bundle 全绿。
- **下一步可选**：`better-sqlite3/prebuilds` 里 8 个外平台 `.node` ≈14 MB（本机只用 darwin-arm64）可按平台配置再裁，属 native 面、本次按纪律未动。

### 261117 · 生产 bug 修复：dev / packaged 本地端口细分（261118 简化为固定端口）

- **现场（用户正式数据 v1.3.0 打包版）**：所有文档图片「图片加载失败」，日志是 CORS「No ACAO」。根因不是权限/资产丢失，而是**端口互抢**：dev 实例占着资源服务 19876，打包版 `listen 19876` **EADDRINUSE 后静默继续**（日志里没有 `[asset-server] listening`），渲染层图片仍请求 19876 ⇒ 打到 dev 进程的 assetServer ⇒ 该进程 token 与打包版注入的 token 不匹配 ⇒ 403（且 403 不带 ACAO）⇒ Chromium 报 CORS。**文件在本机、下载也没问题，纯 HTTP 层被拒。**
- **端口表（所有本地端口按通道整体隔离；env 覆盖优先；固定，不自动回退）**：

  | 通道 | packaged | dev | 环境变量（优先） |
  | --- | --- | --- | --- |
  | 资源服务（图片/附件） | **19876** | **19877** | `LAKE_ASSET_PORT` |
  | Web 客户端（浏览器端） | **19880** | **19881** | `LAKE_WEB_PORT` |
  | vite dev server | — | 1421 | `LAKE_DEV_SERVER_URL` / `LAKE_DEV_PORT`（不自动回退） |
  | CDP 调试 | 9333（冒烟脚本默认） | 9222 | `LAKE_CDP_PORT` |

  userData 也按形态分开（dev `lakex-local-notes-dev` / 正式 `lakex-local-notes`，`LAKE_USER_DATA` 可覆盖）⇒ **同机同时跑 dev 与打包版互不共享端口/路径**。
- **固定端口语义（261118 定稿）**：端口在**监听之前**就固定，并把 `process.env.LAKE_ASSET_PORT` 写回（preload/渲染层据此构造 URL；即使监听失败也保持一致）；`currentAssetServerPort()` 是启动时解析一次的固定值，store/导出/小记都用它。占用时**明确报错**（`EADDRINUSE` → 日志含端口与原因；资源服务降级但主窗口照常启动；Web 客户端开启时抛可读错误），不再 +1..+10 回退、不再传 `--lake-asset-port`。
- **错误可读性**：资源服务早期 403（token 不匹配）对**已允许 origin** 回显 ACAO ⇒ 浏览器不再把它显示成 CORS 失败；未知 origin 仍不回显（任意网站读不到）。
- **护栏**：`electron/assetServer.port.test.ts`（首选/回退/连续占用/非 EADDRINUSE 报错/双实例/回退后导出与小记 URL/403 ACAO/接线源码断言，12 例）+ `electron/webApiServer.test.ts` 的「+1 回退并把实际端口回给设置页」；既有 `assetServer.test.ts` 覆盖安全面与 `/ai-local`。
- **dual-instance 预期（以后照此判断）**：同机跑 dev + 打包版时，两边日志应分别出现 `[asset-server] listening on http://127.0.0.1:19877`（dev）与 `:19876`（packaged），并各有一行 `[ports] asset=… webApi=…`；若同形态实例双开/端口被占，会出现 `[asset-server] 端口 N 监听失败（已被占用…）` **error** 且图片降级 —— 这是固定端口的预期行为，关掉占用进程即可。

### 261116 · v1.3.0 发版（AI 写作能力 + review 收口）

- **发布**：`v1.2.0 → v1.3.0`（`package.json` 1.3.0；Android versionName 1.3.0 / versionCode 11300 由根 package.json 派生，未手改 build.gradle）；注解 tag **`v1.3.0`**，双远端推送（tag 触发 GitHub release 流水线）。本批 `v1.2.0..v1.3.0` = 18 commit / 91 文件 / +6.2k −0.4k。
- **Review 结论（4 路并行：主进程/架构、性能、数据协议、UI/设计系统）**：**都不需要架构改动**。数据模型（attach_refs 只存引用、字节只在主进程、单一 resolver）、模式能力表、本地专属边界、产物契约都成立；问题全是局部实现与登记缺失，已在发版前修完（见下）。唯一「结构类」建议 = 以后附件类常量若继续堆积，把 `core/aiChatMessages` 的 AI 附件预算拆到 `core/aiAttachments`（当前 2 个常量，不动）。
- **Review 修复（P0/P1/P2 全清）**：
  - 主进程：本地附件改「**先 stat 判限额再异步读字节**」（图 10MB/张+20MB/次+core `AI_MAX_IMAGES`、文本 200KB、PDF 32MB；PDF 已解析过时连字节都不读）；**HEIC/HEIF 移出图片类型表**（与 `core/assetNaming` 一致）并给「请先转 JPEG/PNG」文案；粘贴写盘改 `fs.promises` + 失败清 `.tmp`；启动清理挪到 4.5s `unref` 定时器（不再压在 `whenReady`）；`/ai-local` 补 nosniff + immutable；pick 对话框传父窗口；**CI 补 `npm run typecheck:electron`**（pr.yml + release.yml 两处）；新增 handler 级测试 20 例（3 个新 IPC + append attachRefs）；门禁源码断言改「剥注释后匹配」+ 扫描副作用 import + 禁白名单目录前缀。
  - 渲染层：`useAiWriting` 加 **generation epoch/请求快照**（切模式/新建/切会话/删除统一取消在途并丢弃旧异步，不再幽灵回写）；流式 delta **rAF 合帧**（50 push → 每帧 1 次 emit，结束/停止当帧 flush）；`AiMessageView` + 新 `AiMessageList` **memo**（历史消息在 50 delta 期间重渲染 50 次 → **0 次**）；`docTitleById` 改 `useMemo`（打字不再每键重建 O(全树)）；贴底改 rAF 合帧。
  - UI/设计系统：`.ln-pill` 固定高 → `min-height`（200% 字号不裁字）；**32px 圆形发送收成 kit `.ln-send-circle`**（两端单一实现，token 对齐 L1 `accent-ink`）；删 `aiWriting.css` 22 条死声明；chip 关闭/移除命中区 16→24（透明命中区，行高不变）；AI 助手 textarea 补 `aria-label`；HANDOFF/DESIGN/注释/棘轮注释回填；DESIGN 登记 composer 节（药丸含 --icon、32 圆形主操作、两端 composer 有意分化、chip 24 命中区、聊天 22/24 圆角、输入卡「0.5px 边+轻阴影」例外）。
  - 探针：delta 计数改事件级（150/150）、`--repeat` 默认 5、记录 longtask 与 appState、允许负 finalFlush 标注；文档写明「只适合同会话相对对比」。新数字：realistic 42.4fps/maxGap 58ms；stress 12.6fps/maxGap 278ms；dense 3.2fps/maxGap 1091ms（单次提交≈1s 是地板）。
- **已知边界（未做，登记）**：①多文档推理的附件仍只支持图片（PDF/文档注入只在对话写作的本机文件链路），`docs/AI-WRITING.md` 已写明收窄；②整库备份不含 `<userData>/ai-attachments` 粘贴图（临时文件，恢复后失效，文档已注明）；③AI 助手/写作/选图器仍不在桌面 42 态与移动 10 态视觉门禁内（P2-7）；④粘贴图总量无上限（只有 7 天无引用清理）。
- **门禁（发版前最后一次全量）**：`tsc` 0；`typecheck:electron` 0；全量 vitest **1014 文件 / 6403 用例（1001 passed / 13 skipped；6389 passed / 14 skipped / 0 failed）**；`ui-metrics` 0；`cssLayers`（kit 754 / aiDialogParts 167 / aiWriting 497 / compat 157）/ `primitives` / `mobileLayers` 全绿；`check:arch` 0 违规；`check:bundle` PASS（桌面首屏 590.9KB / 600KB）；`git diff --check` 0。**未重跑**：桌面 stylesnap 42 态（AI 面不在其覆盖内，其余样式改动仅 kit 新增/删除重复规则）与移动 snap（本批未动移动端）。

### 261116 · AI 输入面补批（发版后，master 增量）

- **输入卡统一 chat-demo 造型，但两端尺寸有意分化**：AI 助手（`src/features/ai/AiAssistantDialog.tsx`）= **紧凑卡**（`radius-md` 10 / 内距 6/8/4 / textarea **max 120**）；AI 写作空间（`src/features/aiWriting/AiComposer.tsx`）= **大输入卡**（`--lake-chat-radius-composer` 24 / 内距 lg/xl/md / textarea **min 96 / max 240**）。共同点 = 0.5px 边 + `--lake-shadow-card` + 无边框 `field-sizing: content` 自增高 textarea + 底部一行：左 = 药丸（深度思考 / 提示词 / docs 模式的选文档），右 = 圆形发送（**32px，收成 kit `.ln-send-circle`**；生成中同格变停止）。**AI 助手不做附件**（用户裁决；附件是 AI 写作需求）；AI 写作附件入口已落地（图片/本机文件/PDF/粘贴，见本段 AI 写作附件各条）。
- **深度思考从「强制开启」改为可关**（用户裁决，推翻 261109 定稿）：请求级覆盖 `runAiChat(reqId, messages, onDelta?, onReasoning?, options?: { thinking?: "enabled" | "disabled" })` → `lib/native` → `preload.cjs` → `electron/ipc/registerAi.ts` → `electron/ai/aiThinking.ts` 判据 → `aiClient`；**只在 supportsThinking 的供应商生效**（当前 DeepSeek），不传 = 与改造前 IPC payload 逐字节一致。UI 只在该供应商支持时显示开关，初值取设置里的默认值。
- **流式节流调参（A+B 实测驱动）**：`useThrottledMarkdown` 的 MAX_WAIT_MS **2000 → 300**、COST_RATE **2 → 1.5**（算法未改）。探针 `scripts/ai-stream-probe.mjs`（loopback 假供应商 → 主进程网关 → IPC → 真实渲染链）实测 3 次中位：dense 640KB 档 **2.3 → 3.3 fps、最大可见间隔 2516 → 1373ms（最坏 3951 → 1453）**；640KB stress 最大间隔 −36%；60KB 档无回归。方法与告警见 [docs/AI-STREAM-PROBE.md](AI-STREAM-PROBE.md)。
- **AI 写作附件方案**：[docs/ai/ATTACHMENTS-PLAN.md](ai/ATTACHMENTS-PLAN.md)：Phase 1（图片·视觉模型）≈3–3.5 人日，堵点 = 「视觉能力不可探测」（只能发送失败后按 400 报错，不维护硬编码模型清单、不静默去图）；Phase 2（PDF/文档注入）＋1–1.5 人日。Phase 1 已建任务（task-21）排在输入卡改造之后。
- **门禁（本批全量）**：`tsc` 0；`tsc -p tsconfig.electron.json` 0；全量 vitest **999 文件 / 6297 用例（986 passed / 13 skipped；6283 passed / 14 skipped / 0 failed）**；`ui-metrics` 0；`cssLayers`/`primitives`/`mobileLayers` 全绿（aiDialogParts / aiWriting 基线按实测登记，当前值见 `cssLayers.test.ts` 顶部注释）；`check:arch`/#core 全过；`git diff --check` 0。
- **药丸已收单一来源（261116 同批）**：新增 kit 原语 `.ln-pill` / `.ln-pill--icon`（开态支持 `aria-pressed`/`.is-on`），**两端均已迁移**（AI 写作删掉 `.aiw-pill` 三态拷贝）。**两端输入卡有意不同**：AI 助手 = 资料修改的轻对话（紧凑卡 radius md、内距 6/8/4、textarea max 120）；AI 写作 = 纯对话（大输入卡：textarea **min 96 / max 240**、内距 lg/xl/md）。判据已写进 `AiComposer.tsx` 头注释 + `docs/AI-WRITING.md`。
- **AI 写作粘贴图片（261116 用户需求：第三方剪贴板图片 → 落盘 → 随历史）**：`AiComposer` 的 `onPaste` 只拦截剪贴板里的 `image/*`（纯文本粘贴不受影响）→ 新 IPC `ai_save_pasted_image`（**通道数 190 → 191**，四面同步）→ 主进程校验 image 类型/非空/≤10MB → `tmp+rename` 原子写到 **`<userData>/ai-attachments/paste-<uuid>.<ext>`**（不在 `note-assets/`，不进 S3/便携包）→ 返回普通本机图片引用，复用 chips/缩略图/预览/发送/历史链路；**docs（多文档推理）模式明确拒绝**并给可执行提示。`paste-` token 可反推路径 ⇒ 注册表 miss 时回落读盘，**重启后历史缩略图仍可用**（普通 `loc-` token 仍重启失效）。启动清理「无 `attach_refs` 引用且 >7 天」的粘贴文件，删除会话不立即删。文档见 `docs/AI-WRITING.md`「数据边界：本地专属」。
- **AI 数据本地专属护栏（261116 用户裁决：「所有历史对话都不进 S3」）**：新增 `electron/aiWritingLocalOnly.test.ts` —— 扫全仓确认 `ai_writing_*` 只出现在 schema/repository/IPC/preload/本地 webApi；同步面（s3v3 / syncEngineController / portable / store / indexRepository）出现 `ai_writing` / `ai-attachments` / `ai-paste` 直接红；便携包白名单不含 AI 目录。现状核实为 0 违规（AI 会话与附件本来就不在同步/便携包链路里）。
- **文档图片右键菜单平铺（261116）**：图片/卡片右键的复制类动作**不再收进「复制 ▸」子菜单** —— 一级菜单直接是「复制」（复制图片到剪贴板）与「复制路径」（复制资产绝对路径），并移除「复制名称」项；两个宿主（EditorTab 桌面 / LakeEditor 移动）都不再注入 copyName。护栏 `features/editor/cardContextMenu.test.ts`。
- **AI 写作模式分化（261116 第四稿）**：能力表单一来源 `core/aiWriting.AI_WRITING_MODE_CAPABILITIES` —— `chat`（对话写作）= 纯对话：`docs:false, docAssets:true, localFiles:true`；`docs`（多文档推理）= 知识库问答：`docs:true, docAssets:true(限已选文档), localFiles:false`。**两向切换都清空**（取消在途 turn、detach 会话、清 messages/promptText/docRefs/attachRefs/input）。对话写作附件来源 = ①「从文档里选附件」（复用 AiDocPicker 同款两级浏览，**仅寻址**，不产生 docRefs）②「从电脑选择文件」（主进程 dialog + 内存 token 注册表，渲染层只拿引用/元数据；图片→image_url，文本/代码→带文件名 text 块，PDF/二进制明确拒绝，token 失效可执行报错）；多文档推理只允许已选文档里的附件，换选/移除文档时 prune 悬空附件；IPC 计数 **189 → 190**（pick_ai_local_files）。简化已写进 `docs/AI-WRITING.md`「按文档取，不做全库扫描」。
- **AI 写作附件 Phase 2（PDF / 文档内容注入，261116 同批）**：PDF 在**选择文件时解析一次并缓存**（复用 `electron/ai/pdfText.ts` 的 unpdf；源 ≤32MiB / 结果 ≤6 万字符 / 10s），发送时 resolver 复用缓存 → **带文件名与页数的 text 块**（不当 image_url，字节不进渲染层）；文本/代码与 PDF 共享单次 6 万字符注入预算（超出截断并标注）；失败语义在选择阶段即报错（加密/扫描件/损坏/超时/过大，不自动重试不静默跳过）；IPC 复用 `pick_ai_local_files`（过滤加 pdf，**通道数仍 190**）；chips 只加「大小 / N 页」提示。真实链路集成测试（真 unpdf）证明 provider 收到 text 块；原生 NSOpenPanel 本机无法可靠自动化，故未取「真点选 PDF」的 UI 截图（手动复验见 docs/AI-WRITING.md）。
- **AI 写作图片附件 Phase 1 已落地（261116 同批）**：消息协议 `AiWritingMessage.attachRefs` + `buildAiWritingMessages` **只在本轮 user 拼 image parts**（历史轮纯文本、不重发）；`ai_writing_messages.attach_refs` 列（CREATE + 旧库 ALTER）；新 IPC `list_note_image_assets(noteId)`（只回 filename/size/mimeType，不算 sha）⇒ **通道数 188 → 189**（registrar/preload/WEB_METHODS/native 四面同步）；新 `AiImagePicker`（源 = 已选 docRefs 文档里的图片、分组网格、多选 ≤10、缩略图 `?w=128`、>20MB 禁止）；输入卡附件 chips + 历史气泡只读缩略图（重启后仍在）。**视觉能力不可探测**：照发，400 时保留供应商原文并追加可执行提示（不维护模型清单、不静默去图/不自动重试）。同批修掉两个既有 bug：请求里同一句问两遍（send 把本轮 user 也塞进 history）、主进程 `{ok:false,error}` 被当作成功吞掉 400。
- **遗留**：AI 助手输入卡的 `a11y-visually-hidden` 文本与图标并存，若换图标库需同步。AI 写作附件 Phase 1/2/粘贴均已完成。**P2-7（2026-11-16 review 登记，本轮不做）**：AI 助手 / AI 写作 / 选图器不在桌面 42 态与移动 10 态视觉门禁内，后续补 ≥1 个 AI 态基线（需 provider stub）。

### 261116 · v1.2.0 发版（`modernize/web-platform-261115` **已合 master 并打 tag**）

- **发布**：分支合并回 `master`（fast-forward；master 原 `7e2db298`，备份 tag `backup/master-261115`）→ 注解 tag **`v1.2.0`** → 双远端推送（tag 触发 GitHub release 打包流水线）。版本 `package.json 1.1.4 → 1.2.0`（Android versionName/versionCode 从根 package.json 派生，未手改 build.gradle）。
- **本批新增（在 261115/261116 前两批之后）**：
  - **设置页体系**：带操作组的整块行改两列网格（一条 `:has()` 规则覆盖 9 处）；控件列按内容占位（下拉 200 / 输入 300，说明列吃满剩余，附件上限列 317→508px）；下拉窄栏 200px；S3 配置收进「同步服务配置」弹窗（列表一行 + 横排 设置/导入/导出，弹窗底部 粘贴迁移码/测试连接/取消/保存）；设置搜索收敛为常驻 `s3-config` + `MOBILE_ONLY_SETTING_IDS`；开关 36×20 + 关态实体轨道令牌（四主题）。
  - **真 bug 修复（通用层）**：`ui/Overlay` 的 portal 容器每次渲染现算 ⇒ 内层原生 `<dialog>` 在栈里时外层 `.ln-scrim` 被搬进 dialog、内层卸载连带删掉整个设置面板。改为 `pickPortalHost()` 稳定 host + 6 例回归（`overlayNestedDialog.render.test`）；`SyncSection` 里 task 级的"两段式"绕行已删。
  - **图标 C 路径**：不引 IconPark（上游 archived + 几何不 1:1 + 会打断 `svg.lucide{1.75}` 单一来源）；按裁决只做 4 处自绘修正 + `RowExpandIcon` 换 IconPark FullScreen（Apache-2.0，NOTICE + LICENSES 随包）；新增 `npm run audit:icons`（报告型）。
  - **移动端**：加载动效首批（延迟加载 300/500ms、空态入场 250ms、便携包导入 7 阶段）；设置页 A1（AI 模型行控件在 390/412 被裁，原语级 `flex-wrap` + 输入基础宽，横向溢出 3→0）与 A2（8 个单组页去重复组标题）；title 长按提示改首帧后动态加载 ⇒ 移动入口 51,440 → **50,402B**（预算 51,200B）。
  - **调研文档（本批新增，用户点名要的交付物）**：docs/icon-migration/DECISION.md（图标不换库的完整依据 + C 路径；已删，判据存 C-PATH-PLAN.md）、docs/modern-web/VERIFY-261116.md（已删，git 可查）、[docs/modern-web/STRICTER-BACKLOG.md](modern-web/STRICTER-BACKLOG.md)、docs/arch/SIYUAN-PR-21151.md（已删，git 可查）、[docs/arch/ELECTRON-LAYERING-AUDIT.md](arch/ELECTRON-LAYERING-AUDIT.md)、[docs/mobile/LOADING-MOTION.md](mobile/LOADING-MOTION.md)、[docs/mobile/SETTINGS-LAYOUT-AUDIT.md](mobile/SETTINGS-LAYOUT-AUDIT.md)。
- **门禁（发版前最后一次全量）**：`tsc` 0；全量 vitest **992 文件 / 6219 用例（979 passed / 13 skipped；6205 passed / 14 skipped / 0 failed）**；`ui-metrics` 0；`cssLayers`/`primitives`/`mobileLayers` 全绿；`check:core` 181 文件 0 违规；`check:bundle`+`check:arch` PASS（移动首屏 345.1KB/350KB、entry 50,402B/51,200B；桌面 577.1KB/600KB）；桌面 stylesnap 5 态 0 差异、移动 mobile-snap **10/10 0 差异**（lake_gate 专用实例两轮一致后重烤基线）、多维表未动；`git diff --check` 0。
- **本批明确不做（用户裁决）**：移动端 B 级四项（去分组卡片框、危险操作挪底、Item-stacked 回左右排、Block 动作前后统一）——与既有 v2 定稿冲突，保留现状。
- **遗留（下一批候选，未阻断发版）**：① `.tree-row` 常驻 `will-change`（现代 Web 复核 A20 重开项，10k 库≈1 万个合成层，需先测后改）；② ~~桌面 `main.ts` 分层护栏~~ **已完成批次 A**（同日后补：`electron/buildTarget.ts` 产物契约单一来源 + `architecture/buildContract/startupBranches` 三个门禁测试 + `tsconfig.electron.json` 无 DOM typecheck 接入 `npm run build` 首步；只加护栏、`main.ts` 行数未变；批次 B「装配外迁」建议分片择机：B1 非窗口 wiring → ≤760 行、B2 窗口层 → ≤600 行，见该文档 §8）；③ `/tmp/lake-task15-run` 有一个 4KB root 权限空壳删不掉（无功能影响）。

### 261116 · 现代 Web 平台化第二批 + AI 对话面（分支 `modernize/web-platform-261115`，已随 v1.2.0 合入 master）

- **起点**：261115 批的 A01–A30 已全部结案（见 [MODERN-WEB-AUDIT §11](MODERN-WEB-AUDIT.md)）。
- **审计收尾**：A03 批 2–4（锁卡/手写板/tag/chip/分段/大纲/多维表/A±/移动端 5 条，共 28 条文字容器 `min-height`，探针证 100% 几何不变）；A17 容器查询（属性弹窗折列改按自身宽度）；A21 收口（**tsconfig 升 ES2024** + `toSorted`/`toReversed` 73 处 + `withResolvers` + 老 WebView 运行时兜底）；A13 试点 → **桌面 13/13 个下拉调用点全量推广**（`AdaptiveSelect`，`Select.tsx` 未动；字号/资源类型/供应商/模型逐档写盘已由用户明确接受）；A10 键盘激活 3 处；200%/400% 字号走查（桌面文字溢出 27→2）。
- **浮层**：`overlay-matrix` 实测后修 2 个真问题——① 模态 `<dialog>` 内菜单/气泡改挂进 dialog（原来看得见点不到、点它关掉整个对话框）；② 关闭浮层焦点不再落 body（`lib/focusRestore` 退到主区域）+ 移动 Sheet 背景 inert。
- **AI 对话面（用户点单，借鉴 chat-demo / MIT）**：流式 Markdown 按渲染耗时节流 + 贴底跟随（`useThrottledMarkdown` / `useStickToBottom`）；DeepSeek 网页观感重排（760 列、无气泡助手、22 圆角用户气泡、24 圆角大卡片输入区，**主色仍是我们自己的墨蓝**）；消息版本/分支（重新生成保留旧回答、编辑提问分叉可切回、切版本滚动锚定）；代码块行号 + 复制。
- **主题**：新增第 4 个主题「清爽（浅色）」（`themes/chat.css` + 移动副本，token-only、不改几何；现有 42 态不重烤）。
- **验证**：桌面 42 态（严格比对 34 + 跳过 8 窄窗 + 2 异步竞态）、移动 10/10、多维表 3/3、23 屏走查、平板窗口矩阵 7 档、打包版窗口状态 smoke 全部通过；详见 §1 分支基线。
- **明确不做**：读屏（VoiceOver/TalkBack）实测（用户裁决不承诺）；A05 树窗口化；状态栏成对改高；移动端 400% 的固定高度 chrome 重构。
- **待用户裁决**：① 合并回 master（需明确同意；评审材料 MERGE-REVIEW-261116.md（已删，git 可查）：按模块的风险/验证/回滚点）；② 正式发 beta（流水线目前只认 `vX.Y.Z`，需改 tag 正则 + `prerelease`）；③ A13 是否继续扩大调用方。
### 261115 · 现代 Web 平台化第一批（分支 `modernize/web-platform-261115`，**未合 master**）
- **前置**：master `7e2db298` 已双推 Gitee+GitHub 并打注解 tag **`backup/master-261115`**；本分支按用户要求**不合并回 master**（需明确同意）。
- **落地（全部行为等价/默认档位零视觉变化）**：IME 回车 35 处过组合态判据（`core/ime.ts`）；字号令牌 rem 化（rem×16 = 改前 px）+ `meta text-scale`；`boot.html` 476KB→1.9KB（图片外置）+ `color-scheme`/`light-dark()`；`field-sizing`/标准 `mask`/`text-wrap`/删 no-op 前缀；图片 `decoding=async`；`forced-colors`；对话框背景 `inert`（引用计数）；`Error cause` + `AbortSignal.timeout`；Tooltip 逻辑抽共享 + 移动端自有 `.mb-tip`；移动 `enterKeyHint`；两处缺失焦点环；`role=main`/`role=search` 地标；**模态内菜单/气泡进 top layer**（`popover="manual"`，`<dialog>` 迁移的前置，已真实应用实测）；**`tsconfig` 升 ES2024 + `toSorted`/`toReversed`/`withResolvers` 62 处 + 老 WebView 运行时兜底**（用户裁决）；**移动端首页顶栏滚动后不再有玻璃灰条**（用户点单）；**A17 属性弹窗折列改容器查询**；**A03 第二步批 1+2**（输入容器 + 锁卡/手写板/tag/chip/分段控件，全部 height→min-height，100% 几何探针零变化）；**移动端 10 态基线按新构建重烤**（+1 元素 = `MobileTitleTips`）；**原生 `<dialog>` 迁移 24 处**（普通模态全迁，含 useConfirm 全站确认/提示；`:modal` + 居中 0 偏差 + 输入框全选 + IME 回车不提交 + 可信 Esc 关闭，均已应用内实测）；剩 8 处浮动/顶部对齐待补 `style`/变体。
- **明确不做/推迟**：`toSorted`/`Promise.withResolvers`（tsconfig ES2022 + 旧 WebView，官方 rubric dropWhen）；原生 dialog/popover 迁移（菜单是 body portal，先迁 popover 才不会被盖住）；10k 树窗口化；INP 让步；可点 div 语义化；容器查询；`enterKeyHint`；`aria-modal` 逐个校准。
- **状态表**：只看 [MODERN-WEB-AUDIT §11](MODERN-WEB-AUDIT.md)（A01–A30 逐项 + commit 号 + 下一批依赖顺序）。

### 261114 · 收口验收（设备点收 / 10k+100k 大库 / 2GB 便携包 / S3 多端回归脚本）

- **设备点验收（P0-1）**：① 移动端书签卡工具条：合成语雀 `ne-clipboard` 注入 `bookmarkInline` 卡 → 触摸点按卡片弹出工具条（转为链接/卡片/打开链接/编辑链接）→ 触摸点按「转为链接」后卡 0/`ne-link` 1 = **PASS**（证据 `/tmp/lakex-verify/evidence/bookmark-toolbar-mobile-261114.png`）；② 桌面画板自定义素材文件夹：保存→`materials/*.board.json`、自定义页显示「打开素材文件夹」+ 从文件夹载入卡片、删除同步删文件 = **PASS**；③ 空间关闭/新顺序桌面+移动复验 = PASS；④ **链接→卡片方向未覆盖**：移动文档编辑器无 link toolbar，桌面依赖内核 link toolbar 扩展，保持 `LAKEX-CONTRACT §5.54` 已知限制（不是本批回归）。
- **大库验收（10k 文档 + 100k 附件，用户确认规模）**：隔离 seed `/tmp/lake-scale-seed-full` = 10,001 笔记 / 10,022 树节点 / 100,000 附件 / 2,052,500,000B（2.0GiB），种子 223.8s。冷/热两轮：首屏 **1284/200ms**；树全量 **433/262ms**（10,022 行真实 DOM，约 20.1 万节点，renderer heap 313–317MB，主进程 RSS 48MB）；搜索 **445/1928ms**（命中）；打开文档 **369/388ms**（正文/10 file 卡正确），再开一篇 **565/544ms**；资源统计（10 万资产）**891/782ms**；资源页 535/606ms、设置 127ms；两轮硬判据/预算 PASS、无残留进程/端口。⚠️ 桌面目录树未虚拟化，10k 行进 DOM 是后续观察项；热轮搜索 1.9s 为一次抖动，报告保留原始值。
- **2GB 便携包**：从同 seed 导出 **2,144,250,965B / 110,005 条**（ZIP64、store-only），导出 39.6s（快照 37ms+遍历 978ms+写 38.5s）；自研流式结构校验 166ms 全过（manifest/counts/白名单/路径安全/抽样 CRC），系统 `unzip -t` 全部条目通过（12.2s）。**发现并修复**：Android `PortablePackagePlugin.MAX_ENTRIES` 100,000 < 110,005 ⇒ 目标规模手机导入会被拒；已提高到 **250,000**（261114 修复，仍由 4GiB/路径/解压量兜底），重跑 `mobileCompat.verdict=pass`。**真机端到端 2GB 导入未执行**（系统文件选择器无法在 CDP 自动化；staging+payload 需约 4GiB 可用空间）——发版前建议人工在真机走一次「设置→备份与恢复→便携包导入」。
- **S3 多端回归固化为可重复脚本**：新增 `scripts/multi-end-sync/regression.mjs`（统一入口、唯一前缀、2–3 个隔离桌面实例、A–K 场景、强制清理 + ListObjectsV2 残留复核、report.json、退出码）+ `loopback-s3.mjs`（127.0.0.1 内存 S3 冒烟）+ README；`--list/--dry-run` 通过；**loopback 全场景 = 94/94 断言 PASS、39 对象删除、residual=0**；本机独立复跑 A,B = **21/21 PASS residual=0**。**真实七牛桶（261114 实测，PASS）**：endpoint `https://s3.cn-north-1.qiniucs.com` / region `cn-north-1` / bucket `local-lake-hebei` / 对象根前缀 `lakex-notes-dev3`：`--scenarios A,B` **21/21 PASS**；`--scenarios all` **94/94 PASS**（39 对象删除）；`--scenarios K --instances 3` **14/14 PASS**（9 对象删除）；全程 residual=0，收尾整个 `lakex-notes-dev3/` ListObjectsV2 = **0 对象**；凭据未入库、用后删除。新增 `--base-prefix` 支持对象根前缀；`--with-mobile` 仍明确未实现。**261114 追加：手机↔桌面真实桶手工冒烟 PASS**——模拟器 `pm clear` 后配真实桶唯一前缀，移动端建文档 + 上传 1×1 PNG（66B）并同步；桌面隔离实例同前缀同步拉到正文与资产（`note-assets/<id>/...png` 落盘、`readAssetPreview` 可读）；桌面改正文 `D-v2` 同步后移动端同步拉回 `D-v2`；前缀 9 对象（含 pointer + 2 资产对象）收尾删除 residual=0，移动端凭据随后 `pm clear`、临时文件删除。
- **门禁**：tsc 0；全量 vitest 见 §1；桌面/移动 build、`check:core`（已修 `hiddenSpacesStore` 移出 core）、`check:bundle`、`check:arch`、`ui-metrics`、`git diff --check`；Android `assembleDebug` + `--sync --install`（含 MAX_ENTRIES 修复）成功并启动。
- **文档**：`scripts/scale-acceptance/README.md`（命令/耗时/限制）、`scripts/multi-end-sync/README.md` 移动端手工方法（原 21 号 §11 搬存）、`docs/PORTABLE-TRANSFER.md` 限制说明、本文件。

### 261114 · 图片批量下载提速 / 提成功率（用户点单：33 图必须下载成功；v1.1.4 候选，未发版）

- **用户点单**：「图片必须要下载成功。我记得并发不止 5 个，我记得 8 还是几来着，有没有更快的解决方案？增加成功率以及下载速度，参考思源的下载逻辑。」
- **核实并发口径**：粘贴成图走的是**内核 upload thread**，硬编码 `{parallel: 5}`（`vendor/lakex-doc-react/src/components/lakex/lakex.js` 111252 / `dist/index.es.js` 84908；插件 `new WZ()` 不传 options，改不了）；`addTask` 后 100ms 才 `_checkFinish`、且每次只启动一个、纯完成驱动 ⇒ 墙钟 ≈ `ceil(N/5) × 单张下载`。**8/12 是 S3 传输域**（`s3v3Pool` 默认 8、quickPush 资产 12 / AGENTS §3#13），不是图片上传。已回填 `docs/LAKEX-CONTRACT.md` §5.53 第 6 条。
- **基线实测（真实语雀「开发/IO」文档，Edge 复制 → 隔离实例粘贴，33 张 = 10,006,080B）**：`paste.html 1ms chars=431376`；33 张下载墙钟 **546ms**、单次 26–301ms、0 重试 0 失败；首图 **≈194ms**、最后一张下载完 **≈742ms**、正文保存 27ms；「下载完成 → 图片可见」**0–25ms/张**，0 次编辑器重建。对照同 CDN 的 30 张混批：多数 2.2s 内完成，但出现过 4.2s / 8.6s / 15.9s 的单张尾巴与 1 张 `15s×2≈30.5s` 超时 ⇒ **慢在下载侧（CDN 抖动/单条边半挂），不在文档渲染**。
- **改法（4 处，参考思源 `NetAssets2LocalAssets` 的「自定义 TLS/浏览器头 + 失败重试 + 可读失败原因」思路）**：
  1. `imageUploadTask`：文档编辑器 URL 图在**构造时**就进自管预取池（8 并发、同 note 同 URL 去重）；`run()` 复用同一次下载。内核 5 槽位只决定卡片何时翻成功，不再决定字节何时开始下载。
  2. `resourceUpload` 新增 `skipQueue`（文档图片预取用），避免再叠共享上传队列（6）把实际并发压回 6；`lakeRuntime` 文档图片路径传 `skipQueue: true`。
  3. `electron/httpFetcher.ts`：同一域名多地址逐个尝试（单地址 6s、最多 3 个、记住上次成功地址 5min、坏地址即忘）+ keepAlive Agent（`maxSockets 8`，省每张图一次 TLS 握手）+ 浏览器 Accept/Accept-Language 头。**SSRF/钉 IP 语义不变**，仍每跳解析一次并校验全部地址。
  4. `electron/resourceRepository.ts`：不再把图片 URL 当 Referer（自引用无意义、部分图床会拒）；响应 `content-type: text/html`（防盗链/登录墙）立刻给可读错误且不落盘（原来会把 HTML 当图片写坏资产）。
- **护栏**：`electron/httpFetcher.test.ts` +1（首选地址 ECONNRESET → 自动换下一个已校验地址、DNS 仍只解析一次）；`electron/resourceRepository.downloadLimits.test.ts` +1（HTML 响应 → 明确失败且不落盘）；`src/features/editor/imageUploadTask.test.ts` +2（构造即预取且 run() 不重复下载 / 同 URL 只下一次）。原 22 例既有护栏全绿。
- **门禁**：tsc 0；全量 vitest **933 文件（933 passed / 11 skipped）/ 6009 例（5997 passed / 12 skipped）/ 0 failed**；`git diff --check` 干净。**未 bumped 版本、未发版**。
- **改后复测（隔离实例 + 同一份 Edge 剪贴板 HTML）**：33/33 done、0 失败；首张完成 **374→231ms**、最后一张 **742→431ms**；下载墙钟 **546→416ms（−24%）**、单次最长 **301→238ms**，首轮 8 条连接握手后其余单张降到 **28–95ms**（keepAlive 复用生效，日志 22:53:19 首波 164–230ms → 后续 28–95ms）；`paste.html 1ms`、保存 33ms、仍 0 次编辑器重建，只有粘贴瞬间一次 172ms 抖动。
- **二批（用户追问：不到迫不得已不能直接失败，要多试几次；移动端也要处理）**：
  1. 主进程交互预算 **15s×3**（原 ×2）；HTTP 状态分类：403/408/425/429/5xx 可重试，其余 4xx（404/410/413…）永久失败给可读原因、不空转；`text/html` 反盗链页仍立刻失败且不落盘。
  2. `uploadJournal` 新增 `attempts`（失败次数，跨重启/重试保留）+ `retryableUploadsForNote`（预算 `MAX_UPLOAD_AUTO_RETRIES=5`）+ 退避 3s/10s/30s/2min/10min；`resumePendingDocumentImageUploads` 打开文档时**pending + 可重试失败**都恢复；`EditorTab` / `LakeEditor(journalRecovery)` 订阅 error 后按退避后台补拉；点内核失败图卡 `ne-image-error` 立即重试（`lakeRuntime.attachImageErrorRetryClick`）。
  3. 渲染层 `withRetry` 新增 `shouldRetry` 谓词：永久失败（404/防盗链网页/超限）不再叠加重试，避免 3×3 空转。
  4. 实测（隔离实例，合成 3 图：正常/404/httpbin 503）：正常图 done；404 报可读原因且 attempts 1→2→3→5 后按预算停止（16s 内），503 同样补拉至预算；点失败卡后对应条目立刻回到 pending 重试；均无无限重试。
- **三批（用户：移动端「不过桥，使用原生方法做」）**：
  1. Android `AssetSyncPlugin.downloadRemoteAsset`（新）：原生 HTTP 把远程图**直接落盘**为资产，字节完全不过 WebView 桥（只回 filename/size/mimeType）。逐跳 SSRF（本机/私网/链路本地/唯一本地 IPv6/组播 或解析失败一律拒）、5 跳重定向、25MiB、`text/html` 拒、魔数嗅探 PNG/JPEG/GIF/WebP/AVIF、命名与桌面 `buildAssetFilename` 同格式（`{13位ms}_{4hex}.{ext}`）、默认 3 次尝试（5xx/408/425/429/403 才重试）。纯规则抽 `RemoteAssetRules.kt` + JVM 单测 5 例。
  2. JS 接线：`window.lakeNative.downloadRemoteAsset(url, noteId, limits)`（bridge `assetsDomain` + `lakeNativeContract`，契约方法 68）；`resourceUpload` 移动端**优先原生**，旧 APK 才回退渲染层 fetch（CORS/CSP 兜底）；`LakeEditor` 新增 `journalRecovery`，移动端文档编辑器接 repair/resume/晚到重建/后台补拉（与桌面 EditorTab 同判据）。**删掉了过渡的 CapacitorHttp(base64 过桥) 方案**——用户明确不过桥。
  3. 设备验证（AVD `lake_mobile`，`--sync --install` 已装）：`downloadRemoteAsset` 下载百度 logo **193ms**，设备落盘 `files/note-assets/perf-native-download/1794584751284_6ed1.png` = 6,617B（与源一致）；私网地址 3ms 拒、HTML 页 57ms 拒、404 78ms 拒（均给可读原因）；App 启动无 FATAL。
- **HTTP/2 结论（用户问「h2 能否加快」）**：**不引入**。实测 33 图/并发 8/热边缘缓存：h1 keepAlive 墙钟 228–360ms，h2 单连接默认窗口 **4430–7618ms（慢约 7–20×）**；即便把流控窗口调大仍慢 1.3–4.2×（单 TCP 拥塞窗口上限 ~10–14MB/s vs h1 热 44MB/s）；h2 省下的握手只有 20–130ms。CDN 支持 h2（ALPN h2、`maxConcurrentStreams=128`）但不改变结论；keepAlive 已拿到连接复用收益。完整数据 `/tmp/lakex-perf/h2bench/report.md`（不入库）。
- **七批门禁（含前六批）**：tsc 0；全量 vitest **954 文件（943 passed / 11 skipped）/ 6061 例（6049 passed / 12 skipped）/ 0 failed**；Android JVM 单测 + `assembleDebug` + `--sync --install` 成功（`lake_mobile` 已装空间关闭版本并启动）；桌面/移动 `vite build` 与 `check:bundle` / `check:arch` PASS；`git diff --check` 干净。书签卡工具条**移动端未做设备级点按验收**（无现成 bookmark 卡夹具）。
- **四批（用户点单：语雀书签卡导入 + 卡片工具条，261114）**：① **导入**：语雀剪贴板的 bookmark 卡是 `ne-clipboard` 里的 `bookmarkInline`（行内）/`bookmark`（展开）卡；内核 INode 读取器只给 `yuqueInline` 有效实现、`bookmark/bookmarkInline` 是空 reader ⇒ 粘贴后只剩 `ne-link` 文本。修法 = `lakeRuntime` `bookmark.recognizeYuque: true` + `clipboardHtml.normalizeYuqueClipboardCards`（可确定的 bookmarkInline 改名 yuqueInline，桌面/移动共用 paste 预处理）+ vendor 侧把 `Gh`/`Gv` 的 INode `read` 补成真卡片（见 vendored LOCAL-CHANGES，重转内核需重放）。② **撤销粘贴降级**：261112 的「bookmark 卡自动降级为链接」（126e906f）删除，`kernelBookmarkDegrade.ts` 只留热键兜底。③ **卡工具条**：内核本版无原生卡工具条（`getCardToolbarConfig` 为 null），vendor 包装层自实现的 `BookmarkToolbar` 原来只挂在 `LakexEditor`；我们不用包装层 ⇒ 现在由 vendor 导出、`EditorTab` 与 `LakeEditor` 各自挂载（转为链接/标题/卡片/打开/编辑；图标 id 已改成本应用 sprite 里存在的）。实测（隔离实例 + 真实【IO】剪贴板 + 合成块卡）：行内卡落 `<card type=inline name=bookmarkInline>`；块卡落 `ne-card[data-card-name=bookmark][data-card-type=block]` 且带缩略图/标题/描述；hover/click 工具条出现，点「转为链接」卡→`ne-link`，点「标题」block→inline 均通过。④ **vendor dist 已重建**（含 wrapper 导出/图标修正 + 内核 2 处 reader 补丁，chunk 哈希整体变化）。护栏 `bookmarkCardToolbar.test.ts`（3 条：两宿主挂载/无降级/vendor 导出与 reader 存在）+ `clipboardHtml.test.ts` +3。契约 `docs/LAKEX-CONTRACT.md` §5.54。**未验收**：链接→卡片方向（依赖内核 link toolbar 扩展按钮）。
- **恢复提示收口（261114 用户问询后修）**：从回收站恢复后弹「云同步已关闭：按纯本地空间处理，没有去云端补拉」原来是**无条件**的——恢复流程（261006 B 方案：恢复立刻生效、不等网络）随后调 `ensure_trash_note_assets` 后台补拉，`ensureTrashNoteAssets` 在云同步关闭/未配置时直接回 `skipped`，`TrashPanel` 就用 `cloudStateHint` 弹提示。即使文档根本没有资源缺口也照弹（纯噪音）。现在 `electron/syncEngineController.ensureTrashNoteAssets` 在阻塞出网前先算**本地资产差集**（`store.getCurrentContentRefs` vs `note-assets/{id}/` 实文件，`missingLocalNoteAssets`）：没有缺口不返回 `skipped`（不弹），真有缺口才提示。护栏 `electron/s3v3/trashAssetBackfill.test.ts` +2（有/无缺口）。恢复语义本身不变（恢复永远是墓碑唯一显式例外、不等网络、恢复后 local-wins 上传）。
- **五批（261114 用户图1：文档内插画板工具条错位 + 移动端文本绘图）**：① **画板卡工具条**：移动端无 @layer ⇒ 依赖包 `.drawnix .draw-toolbar` 的横轨规则与内核同特异性且后加载（内核在 DocumentEditor chunk、drawnix 在画板懒 chunk）⇒ 卡内创建栏变卡顶横轨、370px 卡里被裁；独立画板文件有 board.css 宿主修复所以正常。修法 = `mobile/editor/edit-surface-kernel.css` ⑤ + `styles/feature.css` 显式钉成卡内左侧竖轨（含 radio 视觉隐藏），选择器用 `ne-card[data-card-name]`（不是 `.ne-card` 类）。设备实测 toolbar 46×446、11 项全可见；桌面同口径。② **移动端文本绘图解禁**：dock「更多 → 画图族」接 `customBlock` 正式入口（`$name:'text-to-diagram'` + initValue），并按移动端加自适应（工具栏换行 + 上下分栏，`edit-surface-kernel.css` ⑥）；设备实测卡宽 368、无横向溢出、Mermaid 预览正常。③ **移动端「替换」未做**（用户点单 #2 的另一半）：内核 `replaceText/replaceAll` 需要**模型 ranges**（`{start:{id,offset},end:{id,offset}}`），而公开的 `ISearchService` 只给 count/jumpTo，没有命中定位 API ⇒ 要做必须走私有 search context，单独 spike 后再动（HANDOFF §3 待办）。护栏 `mobileBoardInsert.test.ts`（文本绘图入口/自适应 CSS + 画板卡竖轨 CSS）。
- **七批（261114 用户点单：画板自定义素材改用可打开的文件夹）**：桌面数据目录下 `materials/`，每个素材一个 `<name>.board.json`（画板文档正文 + `material` 元数据；与普通画板文档同格式，用户可自行拷贝/放置）；素材面板自定义页加「打开素材文件夹」+ 提示，保存/删除直接写/删文件，打开面板时重新列目录（手动放入的画板文档也识别）。实现：vendor 新增 `MaterialLibraryStorage` 端口（`DrainixBoardCoreProps.materialStorage`；不传 = localStorage 旧行为）+ 素材库改造；宿主 `electron/boardMaterials.ts`（列表/保存/删除/唯一命名/64MiB 上限/路径穿越校验）+ IPC 单通道 `board_materials`（list/save/delete/open）+ preload/web/native 包装；桌面 `BoardEditor` 注入，移动端暂不接（Android 无「打开文件夹」语义，仍 localStorage）。验收（桌面隔离实例）：IPC save 生成 `materials/测试素材.board.json`；打开画板素材库 → 自定义页显示「打开素材文件夹」+ 提示 + 从文件夹载入的「测试素材」卡片；点卡片删除 → 文件消失、卡片消失；`node scripts` 文件回读 `kind:"board"` + `material` 元数据。护栏 `core/boardMaterialFile.test.ts` / `electron/boardMaterials.test.ts` / `features/board/boardMaterialFolder.test.ts`；IPC 通道计数 188。
- **六批（261114 用户点单：空间关闭，仅日记 / AI 写作可关）**：知识库 / 小记 / 标签固定显示；关闭 = **隐藏一级入口**（桌面空间菜单 + ⌘4/⌘5 + 默认空间选项；移动端 Dock + 分页页 + 默认空间选项），**不删数据、不阻断内部跳转**（搜索打开日记仍能进日记空间）。实现：`core/hiddenSpaces`（sanitize/visible/resolve 纯函数）+ `lib/hiddenSpacesStore`（设备本地 localStorage 键 + useSyncExternalStore 订阅，不进 S3）；桌面 `desktop/spaceVisibility` + `useHiddenDesktopSpaces`（菜单过滤、快捷键按存储读判、启动落点 resolve、关闭当前空间回落知识库、默认空间被关回知识库）；移动 `mobile/settings/spaceVisibility` + `useHiddenHomeTabs`（Dock/分页器按可见 tab，`tabPager` 全量改成接受 tabs 子集 + 新增 `tabs` 事件，隐藏 pane `[hidden]` 整页收掉；默认落点 resolve 回小记）。设置 UI：桌面「编辑器 → 空间」两个开关 + 默认空间下拉只列可见项；移动「常规」两个开关 + 默认空间 Picker 只列可见项。实测（桌面隔离实例 + `lake_mobile` 设备）：桌面 hidden=[ai-writing,diary] 时菜单只剩 知识库/小记/标签、⌘5（日记）无效、默认空间=diary 时启动落知识库；设备关闭两项后 Dock=3 格、分页 3 页、隐藏页 display:none、默认空间=diary 时冷启动落小记；重新开启两项后 Dock=5 格、hidden 键清空。**重排复验**：桌面菜单顺序 = 知识库/小记/标签/AI 写作/日记（⌘1–⌘5），实测 ⌘3→标签、⌘5→日记；设备 Dock 同序，隐藏 AI+日记后只剩 知识库/小记/标签 三格、分页 3 页。护栏 `core/hiddenSpaces.test.ts` + `desktop/spaceVisibility.test.ts` + `desktop/hiddenSpacesWiring.test.ts` + `mobile/settings/spaceVisibility.test.ts` + `home/tabPager.test.ts`（动态 tabs 两例）+ `home/homeCreateFlow` 单源断言更新。**261114 追加（用户点单）**：空间顺序改为 **知识库 / 小记 / 标签 / AI 写作 / 日记**（两端同序），快捷键随之变成 ⌘1 知识库 / ⌘2 小记 / ⌘3 标签 / ⌘4 AI 写作 / ⌘5 日记（可关闭项排最后 ⇒ 关掉后 1–3 连续）；默认空间选项、设置页两个开关顺序同步。
- **待办**：① 失败图预算耗尽后只留真实原因（可重新粘贴或点卡再试一次）；② 移动端原生下载的 DNS rebinding TOCTOU 残余风险已接受（HttpURLConnection 无钉 IP 公开接口，文档写在 `RemoteAssetRules` 注释）；③ 若以后 iOS 端建立，原生下载需同样实现（当前仅 Android 插件）。

### 261114 · 图片上传失联修复（正式数据【IO】现场；v1.1.4 候选，未发版）

- **现场**：正式数据【IO】最后一张远程图（语雀 CDN，原图 826,557B/1080×613）粘贴后显示「图片上传失败」，但 note-assets 里文件完整（orphan）。日志：18:15 粘贴 33 张，主进程下载最坏 3×30s（≈91s）后才失败、卡片已 error；18:16:33 编辑器实例重建，新实例对 loading 卡建 virtual task，3s 超时后内核把字符串 `"failed to upload"` 当 Error 取 `.message` ⇒ `errorMessage:"unknown error"`；晚到的下载成功只更新旧实例/旧卡，正文不更新 ⇒ 字节成 orphan。
- **根因（4 层）**：① 卡片上传任务与编辑器实例同生命周期（实例一重建任务就失联）；② 原 URL 在上传开始时被 pre-reader `delete src`（正文里无处重试）；③ 内核超时分支错误信息丢失（传字符串）；④ 下载/重试预算过长（主进程 3×30s + 渲染层 2 次），足够让卡片先失败。
- **修复**：文档编辑器 image 插件改自实现 `createUploadTask`（`features/editor/imageUploadTask.ts`，taskId 同步进卡片，任务自持、编辑器销毁后仍跑完）+ 持久日志 `uploadJournal`（taskId→URL/资产结果，7 天/200 条）+ 纯函数 `uploadCardRepair`（挂载时按 taskId 回填 done/error）+ `EditorTab` 订阅晚到结果触发一次重建 + `resumePendingDocumentImageUploads` 重启后重下 pending。**关键坑**：vendor 默认 image 配置带直通 URL 的 `createUploadPromise` 桩且优先级高于 createUploadTask ⇒ 必须显式 `createUploadPromise: undefined`，否则远程图变「src=原 URL/size0/done」假成功卡（实测踩到）；任务必须实现 WY 同款 `on/off` 与 `isError` 等（缺则 render assert/TypeError）。下载预算收窄为 15s×2（IPC `download_remote_resource` 新增 limits，夹 [1s,60s]×[1,3]），该路径渲染层不再叠重试。
- **运行时验证（隔离 `LAKE_USER_DATA` + `LAKE_RENDERER=scheme` + CDP 9222，未碰正式数据）**：A 粘贴远程图 → 日志 done、DOM `img.ne-image` 指向本地资产、无 renderer 错误；B 离线把正文卡改成 `src:""/status:error/unknown error`（保留 taskId）→ 重启打开 → 自动回填 src/status/size 并落盘（磁盘 body 已 done、orphan 清空）；C 日志置 pending + 正文同 taskId broken → 重启 → 自动重下并回填（磁盘 body done）。
- **门禁**：tsc 0；全量 vitest **944 文件 / 6005 例（5993 passed / 12 skipped）/ 0 failed**；`vite build` 成功；`git diff --check` clean。护栏：`uploadJournal.test.ts`（5）、`imageUploadTask.test.ts`（5）、`uploadCardRepair.test.ts`（6）、`uploadRecoveryWiring.test.ts`（3）、`electron/resourceRepository.downloadLimits.test.ts`（3）。
- **文档**：`LAKEX-CONTRACT.md` §5.53（内核扩展点/生命周期/unknown error 链路 + 复验法）、`RESILIENCE.md` §3.6、AGENTS §4「图片上传必须可恢复」、HANDOFF 本节/§1。**已双推 master（`a6b77249`），未 bump 版本、未打 tag**（用户 261114 决定：先推远程不发版；等需要装机验收再发 v1.1.4）。
### 261114 · v1.1.3（移动端删除 review 收口 + 级联/关标签详细矩阵 + 发版）

- **用户点单**：① 移动端删除也做 review（笔记本/分组/文档 × 子级/多级子级都要详细测试），删除后**关闭已打开标签、行为与桌面一致**；② 完成后推远程、打 tag 发版。
- **独立 review（trash-reviewer，只读）**确认数据层级联/恢复/purge/幂等/环/dfp/keep-alive 设计已对齐桌面，但抓到 3 个真缺口 + 2 个低风险：G1 批量删除未先落盘（随后 cancelAutoSave 丢最后输入）；G2 单条恢复「原父是活跃文档」被错误回落到笔记本根；G3 purge/自动过期/缺正文彻底删除不关闭已打开标签；G4 purge 残留 orphan_assets 行；G5 purge 无「必须在回收站」守卫。
- **修复（`c3b17bf9`）**：G1 批量 trash 前 flush（失败中止不删）；G2 resolveRestoreParent 补活跃 note 父查询；G3 purge 返回 `noteIds` + 统一 `tabDismissal.dismissNoteTabs` 通道（手动 purge/自动过期/缺正文都收标签）；G4 purge 事务内清 orphan_assets；G5 purge 加回收站守卫 + kind 由 DB 派生（`{purged,noteIds}` 返回）。**设备实测额外 bug**：批量关标签循环 `removeTab` 读旧 `tabsRef` 互相覆盖 ⇒ 父标签残留；新增 `removeTabs(ids)` 一次 setState。矩阵测试：移动 `trashCascade.test.ts` 15 例覆盖 笔记本/分组/文档 × 3~4 层 × 删除/恢复/彻底删除 + 批量顺序 + 幂等 + G2/G4/G5；桌面 `trashCascade.test.ts` 8 例补 笔记本根（多级分组+多级文档）/purge 文档子树；`src/core/tree.test.ts` 2 例（桌面关标签集合子树/环）。
- **设备验收（AVD lake_mobile，CDP 9335，最终构建）**：A 删多级分组（G1>G2>G3>GDOC，打开 GDOC 后删 G1）→ tabCount=0、toast、可回首页；B 删深层层级文档（PARENT>CHILD>GRAND，打开 GRAND 后删 PARENT）→ 无 ghost tab；C 首页长按删笔记本（含多级子文档）→ 标签存档清空、恢复整棵后重进可正常打开；另实测活跃笔记本 purge 返回 false（G5）。证据 `.css-audit/mobile-gone/del-*.png`（gitignore）。
- **门禁**：tsc 0；全量 vitest **939 文件 / 5983 例（5971 passed / 12 skipped）/ 0 failed**；`vite build`（桌面）+ `vite build -c vite.mobile.config.ts`（移动）均成功；`check:bundle`（含 vendor CSS/架构预算：desktop 首屏 577.0/600.0KB、mobile 首屏 342.2/350.0KB、mobile entry 48,994/51,200B）、`check:core` 178/0、`check:mobileui`、`ui-metrics`、`git diff --check` 全过。
- **发版**：`package.json` = **1.1.3**（Android versionName 1.1.3 / versionCode 11103，由 package.json 派生）；注解 tag **`v1.1.3`** 已双推（ref `a3f47335` → commit `12b5f7d3`），Release workflow run **43405437257** 已由 tag 触发；发布说明 = [RELEASE-NOTES](RELEASE-NOTES.md) 顶部段落。
### 261114 · 用户第二轮点单（回收站动作浮动 / 启动不硬开 / 保存被拒可退出 / 移动端同型修复）

- **① 回收站行动作浮动化**（用户截图：两个按钮占标题空间）：`TrashPanel` 文档行与小记行的「恢复 / 彻底删除」包进 `.trash-row-actions` 绝对定位覆盖层（不参与 flex 宽；hover / 选中 / focus-within 显形；行加本地类 `trash-row`、去掉 `ln-list-item--hide-action` 以避开原语跨所有权门禁）。`styles/app/panels.css` +9 声明（基线 112→121）、`cssLayers`/`primitives`/`ui-metrics` 全过。隔离实测：行宽 301.5 时标题可用宽 165.7、浮层 left 243.5 / right 8 / 宽 50（= 改前会占掉的 2×22+gap）、行高不变；hover 时右侧倒计时徽标让位不叠字；文档行/小记行同套类。
- **② 启动不硬开文档**（用户裁决）：删除 `core/coldStartNote`（含测试）与 `useBootstrap` 冷启动落点（lastOpened / 最近文档 / 多维表兜底全删）⇒ **只恢复上次标签，没有标签就保持空态**；`desktopKernelLazy` 预热断言同步（恢复标签一次）；HANDOFF 原 P1「首篇编辑器 fallback 的最终解法」按此结案。
- **③ 保存被拒也能正常退出**（用户裁决：保存已拒绝时未保存内容允许丢）：新增 `core/unloadGuard.blockingDirtyTabs`（`dirty && !deleted && !isSaveFailed`）；`useSavePipeline` 新增 `failedSavesRef`（只记 catch 的真实保存失败；外部改动冲突仍需用户决策、不在此列）；`App` 以 ref 传给 `useDesktopLifecycle`，beforeunload 只对「还能保存」的脏标签 preventDefault；失败/已删标签仍写 draft journal 兜底、允许丢弃。护栏 `unloadGuard.test.ts`。
- **④ 移动端同型修复**（用户要求检查）：确认缺陷 = `noteGoneState` 只看 parentId，删笔记本/分组级联（子文档 parent 不变、只标 `trashed_at`）后打开中的 tab 仍按 active 走保存屏障 ⇒ 关闭/返回/退回首页失败卡住；修复 = noteGoneState 回传 `trashedAt` + `isGoneNote` 全入口传；保存屏障（closeTab / 返回 / 关闭全部 / 完成编辑）命中 gone 走 `discardTab + cancelAutoSave` 并 toast「已在回收站或已删除，已关闭标签；可在回收站恢复」；删分组/笔记本按 `descendantNoteTabIds` 丢弃整棵子树标签、删除前先 flush 在途编辑。**否证**：移动无启动泄漏（listNotes / 工作区树都过滤 trashed_at、无 beforeunload、欢迎小记有 initialized 标记不复活）。残余（P2）：移动无桌面同款「tab 标记 gone + 只读横幅」，旧内容显示到关闭。
- **验证**：tsc 0；全量 vitest **923 passed / 5924 例（5912 passed / 12 skipped）/ 0 failed**（75.4s）；`cssLayers` / `uiPrimitives` / `ui-metrics` / `check:mobileui` PASS；`npx vite build` 成功。隔离实例（新构建、CDP 只读取证，夹具 C 全新库 + D 软删回放）：**C1** 全新库冷启动无 tab/空态且树里仍有 welcome-note（数据在只是不硬开，editor.init=0）；**C2** CDP 点击目录手动打开成功；**C3** 删正文→输入→日志 `save_note 失败 笔记不存在`→`Browser.close` 后 **203ms 正常退出**（≤10s，before-quit+will-quit 都有，草稿兜底落盘成功）；**C4** 浮动动作 position=absolute/right:8px、hover 宽 50 不溢出、标题宽度 idle=hover delta=0。证据 `/tmp/lakex-verify/evidence/SUMMARY-ROUND2.md`（不入库）。移动端：AVD lake_mobile 装最终 APK，设备级两场景（删文档后「完成」/Android 返回）PASS，证据 `.css-audit/mobile-gone/*.png`。
- **追加（用户追问「带子级 / 多级子级的删除」）**：审计结论 = **桌面一直有级联**（`trashLifecycle.deleteTreeNode`：多级分组、文档下多级子文档、回收站中间节点 purge、整棵恢复全部 PASS）；真正缺的是**移动端 note 分支**：`trashNote` 与 `trashTreeItem(note)` 只动根 ⇒ 子文档变 `trashed_at=NULL` 悬空行（树里不可见、搜索里还在）、purge/restore 也只处理根。已修：抽 `src/mobile/data/trashSubtree.ts`（`parent_id` ∪ `deleted_from_parent_id+trashed_at` 两路边集合）统一 `trashSubtree`；`noteRepository.trashNote` / `trashTreeItem(note)` / `restoreTreeItem(note)` / `purgeTreeItem(note)` 全部按子树处理。桌面 `deleteTreeNode` 同时补两点：已 trashed 节点重复删除**幂等**（不改 parent，避免批量顺序把子树拆成多个回收站根）、级联集合改用 `flattenedSubtreeIds`（覆盖被同步扁平化的后代）。护栏：`electron/trashCascade.test.ts`（5 例：多级分组删除/删除带子文档的文档/嵌套 purge/整棵恢复/批量先子后父幂等）、`src/mobile/data/trashCascade.test.ts`（6 例：note 删除/trashNote/恢复/彻底删除/批量顺序/分组嵌套）。
- **文档**：AGENTS §3#5（级联/幂等）与 §3#16（移动端同源）/ §4 启动 bullet / §7#12b、`docs/RESILIENCE.md` §3.5 +4 行、本文件 §1/§3 已同步；本批 commit 见 `git log -1`。
### 261114 · 回收站幽灵文档修复（启动自动打开已删除文档 + 清空回收站后关不掉退不出）

- **用户现场**（正式库 + 开发库都复现）：删光笔记本后重启仍自动打开回收站里的欢迎文档；它以可编辑标签出现（编辑器无只读横幅），保存被主进程守卫拒（`笔记已在回收站或已被删除，保存被拒绝；请先显式恢复: welcome-note`）；⌘Q/关窗被 `beforeunload` 永久拦住（日志 `[ui] 窗口无响应` + 只有 before-quit 没有 will-quit，最后靠 60s 超时/强杀）。用户清空回收站后旧 `seed` 又把 `welcome-note` 复活成孤儿行（父笔记本已 purge、侧栏看不到）⇒ 再启动继续打开它，再次「关不掉退不出」。
- **根因**：① 删除笔记本时**只有根节点** `parent_id` 移进回收站，子文档 `parent_id` 不变、只标 `trashed_at`（`trashLifecycle.deleteTreeNode` 级联）；`store.bootstrap()` 只按 `parent_id != 回收站` 过滤 ⇒ 回收站子文档泄漏进启动快照（tab session 的 `liveIds` 认为它活、`lastOpenedNoteId` 命中它 ⇒ 冷启动/恢复标签打开它）。② `readNote`/`getNoteDigest`/`isGoneNote` 都不读 `trashed_at` ⇒ 标签不标 deleted/只读；同时 `beforeunload` 只要「有脏标签」就 preventDefault，而 gone 文档保存永远被拒 ⇒ 脏标记永不清除、退出永久被拦。③ 旧 `schemaInit.seed()` 只看 notes 表是否为空 ⇒ 清空回收站（purge 物理删行）后把固定 id 的欢迎笔记复活到已不存在的默认笔记本下（幽灵孤儿，还会被同步当新文档上传）。
- **修复**：`bootstrap()` 只收「`trashed_at IS NULL` + `is_purged=0` + 父节点在位且不在回收站」；`NoteSummary.trashedAt` 回传（两份声明：`src/lib/types.ts` 与 `electron/noteQueries.ts` 镜像类型）+ `readNote` SELECT 补列；`readNoteDigest.deleted` 用 `trashed_at`；`isGoneNote({parentId, trashedAt, …})` 新判据 + `noteRef.isNoteRefGone` 同步；`seed()` 仅全新库（无 notes、无墓碑、默认笔记本在位）种欢迎笔记，启动自愈 `removeResurrectedAfterPurge()` 清「已 purge 又复活」的幽灵行（墓碑保留、幂等）；渲染层 gone ⇒ `dirty:false`（`useSyncProgress` / `App.handleBlockedSave`），`beforeunload` 只拦「脏且未 deleted」，`App.handleTrashChanged` 在 purge/清空后按 `getNoteDigest` 收掉已打开标签；冷启动剔除日记条目（261110 同口径）。
- **验证**：单测新增 `electron/startupTrash.test.ts`（7 例：删笔记本泄漏/删单篇/清空不复活血缘/幽灵自愈/父节点防御）+ `syncDecisions.test.ts` trashedAt 2 例 + `useBootstrap.render.test.tsx` 日记冷启动 1 例（相关 13 文件 217 例全过）。隔离实例（新构建 + 正式数据副本、仅 CDP 只读取证）：**A 套**（当前正式库真实状态）两次冷启动都无 tab/空态/无保存失败，幽灵行被自愈删除（`removed 1 resurrected-after-purge ghost note(s)`）、墓碑保留、二次启动不复活；**B 套**（合成回放删笔记本软删现场）无 tab/空态，`welcome-note` 仍在回收站可恢复（回收站 UI 显示「个人笔记」），宿主数据零改动；证据 `/tmp/lakex-verify/evidence/`（不入库）。开发版窗口实测：修复后启动为「开始写第一篇笔记」空态、无 tab、无错误。
- **门禁**：tsc 0；全量 vitest 见 §1；`git diff --check` 0；`npx vite build` 成功。
- **文档**：AGENTS §3#16 / §4 启动 bullet / §7#12b、`docs/RESILIENCE.md` §3.5 已同步。
### 261114 · v1.1.2 发版（62 笔提交：S3 数据安全修复 + 移动首屏/同步性能 + 云同步闸门）

- **发版**：`npm version patch` → 1.1.2（Android versionName 1.1.2 / versionCode 11102）；注解 tag **`v1.1.2`**；master 与 tag 双推（Gitee `origin` + GitHub `github`）⇒ **Release workflow run 43384377793 已跑通**（macOS x64/arm64 dmg+zip / Windows NSIS / **Android release APK 三项 build 全 success**），GitHub Release `v1.1.2` 已发布 **8 个资产**：Android APK（33.6MB）/ arm64 dmg+zip / x64 dmg+zip / Windows exe / `latest.json` / `release-body.md`；Gitee 发行版同步取决于 `GITEE_TOKEN`（不配只留代码+tag 镜像）。
- **内容**：见 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md) 顶部段落（同步数据安全：恢复后编辑被覆盖 / 附件声明一致性 / 小记共享正文 / 目录位置合并 / 小记恢复回弹 / 兜底未分类固定 id / 云同步开启闸门；移动端：入口瘦身 61,006→48,759B、基线落 gzip、云清理预览、AI 供应商；桌面：快捷键、回收站窄分栏、无障碍基线）。
- **发版前门禁**（@ 1.1.2 提交）：tsc 0；全量 vitest 931 文件 / 5901 例 0 failed；ui-metrics、check:core 178/0、check:mobileui、check:bundle/arch（mobile entry 48,759/51,200、首屏 341,652/350,000）全过；diff-check 干净。设备：lake_mobile 三屏正常、lake_gate 10 态基线按该构建重烤并两轮 0 差异。

### 261114 · 移动首屏瘦身第二批（入口 −12.2KB，预算收紧）

- **盘点**：入口 chunk 133 模块 / 486KB 源码，其中「点击才出现」的浮层与非首 tab 页面被静态打进入口。
- **改**：`ImageLightbox` / `AttachmentPreview` / `CreateNotebookSheet` / `DefaultNotebookPickerSheet` + `TagsHomeTab` / `NotebookGrid` 全部改 `lazy()` + `Suspense(null)`（与既有 `DiaryPage`/`MobileAiPage` 同一模式）。
- **实测**：入口 JS **61,006 → 48,759B gz（−12.2KB）**；首屏资源图 **353,397 → 341,652B（−11.7KB）**；preload 7 → 10（预算 12）；视觉零变化（只拆包）。
- **预算随目标收紧**：`check-bundle` mobile-entry-js 60KB → **50KB**（余 2,441B）；`check-arch` mobile 首屏 360,000 → **350,000B**（余 8,348B）。以后再涨就红，别再靠「冻结现状值」。
- **顺带修两条护栏的误判**：`kernelStyleBootstrap` 判「懒入口会挂内核」改为**先去注释**再匹配（`imagePreview` 注释里提到 LakeEditor，纯图片预览被误判）；`crossEndClassCoverage` 的「移动端在用」**把动态 import 也算上**（改 lazy 后只认 `from` 会把共享浮层误判成僵尸清单）。
- 门禁：tsc 0；全量 vitest 931 文件 / 5901 例 0 failed；ui-metrics、check:core 178/0、check:mobileui、check:bundle/arch（新预算）全过；diff-check 干净。
- **设备验收**（新 APK 已装 lake_mobile 5554 与 lake_gate 5556）：lake_mobile 上小记首屏 / 知识库（书架卡）/ 标签（空态）三屏均正常渲染（lazy chunk 正常拉取、无白屏/无 ChunkLoadError）；**lake_gate 已按新构建重烤 10 态基线并连跑两轮 0 差异**（baseline 已提交）。

### 261114 · 移动端 AI 获取模型列表（`ee7aeea5`）

- Kotlin `AiChatPlugin.listModels`：GET {baseUrl}/models（草稿 baseUrl/Key 优先，保存前也能拉）；解析 data[].id / models[]；
  错误走既有 codeForStatus/errorResult。JS 契约 `AiModelsResult/AiModelsOptions` + bridge.aiListModels（浏览器预览 unavailable）。
- 设置页模型行加「获取模型列表」：成功展示候选并自动填第一个空模型；失败显示供应商原因；无 Key 明确提示不发请求；
  切换供应商/重开页面清空候选。guide/10 同步。

### 261114 · 两端统一「云同步开启闸门」（`c808ce0c`）

- **用户裁决**：移动端与桌面端统一逻辑 —— **没配置 S3 或没通过连接测试，都不能开启云同步**；点击只提示「先测试通过才能开启」，状态保持关闭。
- 单一来源 `core/cloudSyncGate`：`cloudSyncEnableGate(configured, verified)` + `s3ConfigFingerprint`（连接字段、不含 Secret）；`lib/s3FormState` 保留 re-export。
- 桌面：开关 desc/onChange/alert 走闸门；`saveSyncCfg` **删除「点开启时自动测试再开」**——必须先由用户点「测试连接」通过才写 enabled。
- 移动端：`useS3SettingsForm` 记「测试通过指纹」（返回值以 OK 开头才算；改连接字段即失效）；SettingsDrawer 开关走闸门；
  「未配置却已开启」旧状态在读到设置后自动关一次并说明原因；开关显示改严格 `enabled === true`（默认关 = 是否已配置 S3）。
- 护栏：core 闸门单测 + 移动端测试 OK/FAIL/改字段失效用例；settings-s3 快照重烤（0 差异）；设备实测未测通时点开关保持关闭并给提示。
- **提醒样式（261114 用户点单）**：闸门提醒改**红字**（桌面 `.config-item__error`、移动 `mb-form__desc--error`，均为既有 status-error 单一来源），且**只出现一处**（desc 保留正常说明，不再与提醒重复）；桌面实测恰好 1 处、颜色 rgb(179,56,47)；移动端提醒放进 `Block`（横向内距 18px），不再作为裸 div 贴在卡外缘（边界问题）；settings-s3 元素数 2045→2047（Block 包装），基线已重烤 0 差异。

### 261113 · 设备验收批（lake_mobile 真机环节 + 门禁态）

- **A1 门禁态**：`lake_gate`（5556）上 `check-mobile-snap` **10 态 0 差异**（基线 14:00 已按当前安装包重烤，无需再烤）；**下次装新移动包后仍需重烤**（基线绑构建）。
- **A2 D1-C（移动 baseline 落文件）设备实测**（lake_mobile 5554，真实桶临时前缀，已删净）：`files/sync-v3/baseline.json.gz.b64` 存在（856B，小库）⇒ 基线确实搬出 SQLite 整行。
  - **重复点**（内容未变，`requests=1 get=1 put=0`）：总 247–486ms，`push-state 113–268` / `push-pointer 102–122` / **`push-baseline 8–32ms`**（D1-A「重复点不重写基线」生效；旧实现每点都整份归位）。
  - **变更路径**（`requests=11`）：`push-state 142–203` / `push-pointer 648–1111` / `push-body 5–33` / `push-index 107–301` / `push-upload 19–36` / `push-publish 443–783` / `push-baseline 368–542`；总 1.9–2.8s。⚠️ 本机到七牛网络的 pointer/publish 往返占大头；**push-baseline 变更路径仍 370–540ms（当前库极小）**，与历史 5000 文档 548–795ms 不可直接比较，待大数据集复测。
- **A2 D3（移动云清理预览/dryRun）**：`gcDeepCleanup({dryRun:true})` 与真删返回同形 `{dryRun,candidateCount,deletedCount,bytes,keys,kept,skippedRecent,ageUnknown}`，本次无可清理对象（`candidateCount=0,kept=9,skippedRecent=6`）；候选/已删两字段分离、dryRun 不删已验证。无法造 7 天前对象 ⇒ 「有候选时预览不删、确认才删」的设备级验证留待有真实孤儿时补。
- **收尾**：lake_mobile `pm clear` 重置、临时桶前缀 14 对象删净（residual 0）、`/tmp` 凭据与探针脚本已删。

### 261114 · 移动端 AI 助手接入「服务供应商」配置（`bbe84434`）

- **用户点单**：移动端设置也像桌面一样先选服务供应商，配置项与桌面 AiSection 对齐。
- **供应商**：同一份 `core/aiProviders` 目录（OpenAI / DeepSeek / 通义千问 / 智谱 GLM / 小米 MiMo / 自定义）；切换即填该家默认接口地址、模型、思考参数。选择只存本机 localStorage（`lakex-local-notes-mobile.ai.provider`，不含密钥、不参与同步）；打开页面时**按已保存 baseUrl 反推供应商优先**，其次本机选择，最后默认第一家。
- **字段与桌面同序**：服务（供应商 → 接口地址）→ 凭据（API Key + 清除）→ 模型与参数（模型 → 思考强度 → 思考模式 → 温度）→ 连通性（保存/测试 → AI 助手开关）→ 本机历史。思考强度/思考模式只在该家 `supportsReasoning/supportsThinking` 时出现；思考模式开启时隐藏温度（与桌面条件一致）。
- **保存语义**：支持家送 `reasoningEffort/thinking`；不支持家显式 `null` 清掉上一次切换的残留；保存后按服务端配置回填（思考参数未存过则回落该家默认）。
- **已知差异（有意）**：移动端 Key 由原生 Keystore 单配置持有（只有一份，API Key 行说明已写明「切换供应商后请确认 Key 属于该家」）；桌面按供应商各存一份配置与 Key，且桌面有「获取模型列表」——移动端原生通道暂未加 listModels（模型手填 / 用供应商默认）。
- **门禁**：tsc 0；vitest `src/mobile`（327 文件 / 1640 用例）0 failed；check:mobileui / check:bundle / check:arch PASS；APK `--sync --install` 到 lake_mobile(5554)，设备截图核对供应商/思考强度与桌面同序；新增 `aiProviderPrefs` 单测 + 表单供应商/思考参数用例；guide/10 Android 配置表同步。

### 261113 · S3 流程缺陷收口批（P1/P2 全清 + 4 轮真实桶复验；#10/#11/P3-6 已验证）

- **#8 兜底「未分类」固定 id**（task-15，HEAD 312cbb57 后真实桶 **28/28 PASS**；**261113 用户裁决：认 id 不认名字，用户自建同名本一律不动 ⇒ 已撤掉「按标题收编旧随机 id」那条**）：场景1 删光笔记本→建根文档 ⇒ 固定 id、云端仅一本、B 同步得同一 id 且不再新增；场景3 多本/同名本时绝不碰用户数据。旧随机 id 的兜底保留不迁移（多一本同名无害）。
- **第 4 轮复验**（task-14，HEAD f0b577b8 后）：#10 purge 顺序 PASS（含发布失败注入 ⇒ 对象不提前删、恢复后补删）；#11 空桶首传 purged PASS（首轮 gen=1 即带墓碑，无多一轮）；**P3-6 视觉 PASS（含收紧后三态）**：行宽 303.5 且另有徽标 ⇒ 倒计时 display:none；行宽 420 ⇒ 恢复 block；只有倒计时一个徽标的 280 窄行 ⇒ 仍 block（判据是「窄 + 另有徽标」，非纯宽度；截图 /tmp/lake-e2e/p36-new-*.png）；精简回归 10/10。**#12 判为「入口未命中」**：e2e 走的是「回收站副本（无 active 行）」⇒ pipeline 先返回 not-found；守卫对「active 行 + remotePurged」这一真实态已由单测覆盖（pipeline 2 例），未观测到复活。遗留待设备/UI 复验：编辑器开着时他端 purge，随后「保存并同步」是否走 full-sync（remote-deleted）。另有观察：B 有未同步编辑 + 未拉取 purge 的变体会产生孤儿正文对象（未复活，GC 可清），待第 5 轮定点确认。
### 261113 · S3 流程缺陷收口批（P1/P2 全清 + 3 轮真实桶复验 74/74）

- **修复**（每项都带护栏）：P1#2 发布轮不再抹掉「云端已删除·仅本地」副本；P1#3 附件「清单有但读不出字节」整条回退（不写新声明 + 索引回退 + 有告警 + 下轮自动补传）；P2#4 目录位置三件套独立合并（目录删除/恢复不再被他端改名吞掉；配套修「wire 上 trashed 目录 parentId 投影 null 导致落库被复活」）；P2#5 小记标签发布侧 LWW；P2#6 快路径 tagIds 排序；P2#7 小记 purge 前缀单一来源；R5 新问题「恢复后首次编辑被他端旧副本覆盖」（同步镜像恢复端口把 updated_at 写成本机 now ⇒ 对齐守卫跳过 ⇒ 本地误判更新、stale 上传）——修法 = 引擎自己写生命周期时元数据应用不带 expected 守卫。
- **真实桶 3 轮复验**（前缀 lakex-notes-dev3/e2e/*，每轮独立前缀、收尾 0 残留）：第 1 轮 272 断言抓到 5 个问题；第 2 轮 56/60（C1/C2 已修 PASS，暴露 P1#3 残余 + R5）；**第 3 轮 74/74 PASS**（R5 恢复后编辑 14/14、P1#3 残余 9/9、抽检 6 项、R5 回归 12/12）。
- **C3 定案**：锁只在渲染层是**设计如此**（只锁本地编辑、不拦同步；守卫不得下沉共用写函数，已写入 AGENTS §4）。UI 路径已真实桶验证：锁到达时编辑器当场切只读、UI 打字不落 DOM、解锁恢复。
- 门禁：tsc 0；core + electron/s3v3 **194 文件 / 1356 例**全过；真实桶脚本与证据在 /tmp/lake-e2e（未入仓）。

### 261114 · 壳层快捷键接入思源口径（`87b909d1`）

- **单一来源** `src/lib/shortcuts/registry.ts`：命令表 + 不可绑定保留键（系统编辑键 + 内核 ⌘F/⌘B/I/U + 思源禁用的 ⌘S/⌘Q）+ 纯函数匹配/格式化；键位用 **KeyboardEvent.code**（⇧] 不受键盘布局影响），`Mod` = mac ⌘ / 其它平台 Ctrl。`useWindowShortcuts` 改为消费注册表（capture、只命中才 preventDefault、输入法组字跳过、Esc 语义不变）。
- **绑定（思源同款）**：⌘P（⌘K 保留为别名）= 全局搜索；⌘N = 新建文档（知识库→新建弹窗 / 日记→今天新建 / 其它空间先回知识库）；⌘W = 关闭当前标签（无标签 no-op，**不关窗口**）；⇧⌘[ / ⇧⌘] = 上/下一个标签（本空间循环）；F9 = 立即同步（未配置/关闭走既有 toast 给理由）。**保留自己的**：⌘] 侧栏、⌘⇧Enter 专注、⌘1–5 空间、⌘, 设置、Esc。**未采用**：思源 ⌘1–9（撞空间切换）、⌘[ / ⌘] 前进后退（⌘] 已作侧栏）。
- **展示收口**：设置页「快捷键」从注册表生成（+6 行，`SETTING_ITEMS` 同步登记；settingsSearch/settingsGroups 两个漂移护栏同步放行注册表行）；[guide/13](../guide/13-shortcuts.md) 重写为同一份清单（含 Windows/Linux Ctrl 口径与平板边界）。
- **验证**：tsc 0；定向 vitest（registry/hook/settingsSearch/settingsGroups）绿；`check:bundle` / `check:arch` PASS；隔离实例（临时 `LAKE_USER_DATA` + CDP 9232，结束时清进程与目录）实测：⌘P/⌘K 搜索、⌘N 弹窗、F9 同步理由提示、Esc 关闭、⇧⌘[ / ⇧⌘] 切标签、⌘W 关标签（2→1）、无标签 ⌘W no-op。
- **P2（可修改）未做（用户 261114 裁决）**：调研坑 = 菜单 accelerator 双轨 / 平台归一 / 内核保留键 / 录制 UX / 设置项搜索结果；触发条件 = 命令数 15+ 或常用键不顺手。
- **第二批（`eaf5ab9f`，用户 261114「继续推进第二批」）**：标签切换增加 `⌃⇥ / ⌃⇧⇥` 通道（与 `⇧⌘] / ⇧⌘[` 并列）；新增 `⇧⌘G` 锁定/解锁当前文档（编辑器 contenteditable 实测 true→null→true）、`⌥H` 打开当前文档历史；设置页/搜索随注册表自动加两行。实测隔离实例通过；全量门禁随本批转绿（见 §1）。
- **全量 vitest（`eaf5ab9f` 之后）= 0 failed**（928 文件 / 5885 用例；并行会话的 S3 WIP 已落地，红不再出现）。
- **261114 追加（用户点单）**：移动端「云端与同步」把「第三方 S3 服务说明」**移到页首**（先讲计费/隐私，再填连接信息）；`settings-s3` 快照重烤（元素数 2045 不变、指纹更新；`--states settings-s3 --write-baseline` 合并写回，其余 9 态保留），APK 已 `--sync --install` 到 lake_mobile（5554，可点击窗口）与 lake_gate（5556）。

### 261113 · S3 真实桶实测 + 流程缺陷修复批（D1-C / D3 / D4 / C1-C2-C4 / P1）

- **真实桶端到端矩阵**（双桌面隔离实例 + 真实桶，3 轮 **272 断言**，脚本与证据在 `/tmp/lake-e2e`）：笔记本/嵌套目录/改名移动/软删恢复/purge+重建×5、文档双向改与冲突、小记快路径连点、资产差集与 GC、缺正文从云端恢复（含重启）、「云端已删除·仅本地」双遍 —— 大部分 PASS；抓到 5 个稳定问题（C1 高 / C2、C3 中 / C4 低-中 / C5 低）。
- **修掉的**：**C1** 小记「他端删除→本端恢复」跨端失效 + 删除回弹（merge 的 local-delete 缺时间戳比较 + saveQuickNotes 只看墓碑存在性 ⇒ 改为「远端 updatedAt vs 基线/墓碑」LWW）；**C2** 纯拉取轮小记时间戳 1970（engineBridge 优先用远端 meta 时间）；**C4** 冲突文案误标（新增 `conflict_kept_history` kind：「已保留本地历史版本」）；**C5** 手动「立即清理」被保留窗口挡住（`ignoreRetention` 透传成 `retentionDays=0`）。**C3 定案 = 不是缺陷**：锁只在渲染层是设计（只锁本地编辑、不拦同步，守卫不得下沉共用写函数，AGENTS §4 已记）；真实桶 UI 路径已验证（编辑器当场翻只读、UI 打字不落 DOM、解锁恢复）。
- **静态审查 12 条**（`docs/SYNC-PROTOCOL` 逐段对代码）：已修 **P1 小记共享正文对象被按 hash 误删**（删一条毁另一条云端正文，两处删除路径都加引用检查）；**P1 剩余**：附件 PUT 失败仍写新声明（声明在/对象缺、永不重试）、发布轮丢「云端已删除」副本的回收站落库；**P2 待修**：目录缺位置三件套合并、小记标签发布侧 LWW、快路径不排序 tagIds、小记 purge 漏删 `meta/assets` 前缀。
- **D4 墓碑退役**：恢复过的目录/叶子不再背永久墓碑（他端删除不再被静默丢弃、不再复活）；删掉零调用且 SQL 坏掉的 `revokeLocalDeletion`；复查补「叶子恢复」漏洞。**D1-C**：移动 baseline 搬出 `sync_v3_state` 整行 → `sync-v3/baseline.json.gz.b64`（5000 文档行 1.11MB→247B、文件 426KB、过桥约 -82%），文件损坏/丢失 = 同步硬失败（绝不把缺基线当「云端缺席=删除」）。**D3**：移动云清理补「预览 + dryRun」，候选数与已删数分开、无预览不能删。
- 门禁：tsc 0；core/s3v3 + electron/s3v3 107 文件 / 580 例、mobile 71 文件 / 287 例、全量 mobile 326 文件 / 1632 例全过；diff-check 干净。

### 261113 · 日记本开放改名/换图标 + 转小记回退为「复制 + 回收站」（`1457bc1d` / `5a555dca`）

- **用户裁决①（替代 261112 §3#25② 的一半）**：日记本**只开放改名与换图标**；删除/移动/排序/作移动目标/space 降级仍拒绝；日记条目与年/月分组仍不可改名/图标。桌面 = `noteMetadataRepository` 新增 `assertNotDiaryContent`（仅日记子树拒绝，本体放行）；移动端 = `treeRepository.diaryNotebookOf`（与桌面同判据）+ 改名/图标/移动/排序/删除守卫、`batchNotes` 目标剔除、`mobilePlatformPort` 单调闸。**移动端入口 = 日记页页头 ⋯（日记本已存在才显示）→ 只给「重命名 / 设置图标」**；桌面不新造入口（数据层放行，等待专门入口设计）。`NotebookWorkspace` 标题锁判据改用 `notebookSpace`（原用过滤后列表 ⇒ 恒 false，日记条目顶栏可改）。
- **用户裁决②（最终版，261113 晚二次裁决）**：「转为小记」= **复制 + 原稿进回收站**（可恢复），**卡片零剥离**。初期按「移动」实现（新 id + 资产目录整体移动 + 物理移除 + 删除意图）后，用户比较两案改为「复制 + 回收站」——内容小、双份占用临时（回收站 90 天自动过期），换来可恢复 + 不碰同步语义 + 回滚更简单。代码已回退到「`createQuickNoteFromContent` + 软删 `deleteTreeNode`/`trashTreeItem`」，只保留零剥离与三层作用域改写；`droppedKinds` 字段恒空（IPC 形状兼容）。
- **文档**：AGENTS §3#25②③、[DIARY](DIARY.md)、[guide 16](../guide/16-diary.md) 同步新口径（含「卡片零剥离 / droppedKinds 恒空 / 原稿进回收站可恢复」）。
- **收尾清理（`5a555dca`）**：删掉移动专属死代码（adopt/rollback/removeNoteForQuickNoteMove/deleted 意图/资产目录移动）与通知里的「未搬运」分支（零剥离后不可达）；移动端 ⋯ 菜单「日记本设置」入口、桌面左栏头 ⋯ 入口均与数据层守卫对齐。
- **门禁**：tsc 0；vitest **923 文件（912 passed / 11 skipped）/ 5837 用例（5825 passed / 12 skipped）/ 0 failed**；check:mobileui 通过；check:core 177/0；check:bundle / check:arch PASS；diff-check 0；APK `--sync --install`（lake_gate 5556）；日记页 ⋯ 菜单/重命名/设置图标 设备级截图核对，空态不显示入口。
- **欠账**：桌面「日记本改名/换图标」入口已在 `74038597` 补齐（左栏头 ⋯ → NamePromptDialog / NodeIconPicker）；转换后原稿在回收站（可恢复），无遗留数据损失面。

### 261113 · 移动端设置项对齐桌面 + 长说明行上下布局 + 选择器/Secret 修正（`de244d3a`）

- **设置项顺序对齐桌面**：云端与同步（字段序 Endpoint → AK → SK → Bucket → Region → 前缀；「连接」并入 S3 对象存储；配置迁移前置；同步策略/同步诊断拆组）；AI 助手（接口地址 → API Key（清除紧邻）→ 模型 → 温度 → 保存/测试 → 开关）；常规（附件 → 默认空间）；历史（定期清理 → 自动快照）。依据 = 桌面 SyncSection/AiSection/EditorSection/HistorySection。
- **长说明/长选项行改上下两段**：`Item` 新增 `stacked`（**复用 --field 几何**，不新增第二套 CSS —— 移动端层围栏只许降）；已应用 max-open-tabs / 默认空间 / 自动同步模式 / 自动同步间隔。
- **默认笔记本选择器重做**：`button.mb-set-item` 在 Sheet 里吃到浏览器默认外观（粗边框灰盒）⇒ 改用选择器原语 `.mb-sheet--picker` + `.mb-list-item` + `role=option/aria-selected` + 打勾。
- **Secret Key 逻辑修复**：未配置 S3 时不再显示无意义掩码（掩码只在已存密钥时出现；未配置 = 空输入框，与桌面 `S3_DEFAULTS` 同口径）。
- **设备门禁**：mobile-snap 的 settings-s3 断言随分组改名；lake_gate（5556）重灌夹具后**重烤 10 态基线，连跑 0 差异**；APK 已 --sync --install 验收（截图见会话 / 本批无独立报告）。
- 门禁：tsc 0；vitest 919 文件 / 5789 passed / 12 skipped / 0 failed；check:mobileui 通过；diff-check 0。
- ⚠️ 本轮工作树与其他会话（Codex）并发改动同一 worktree：本批只 stage 自己的 11 个文件提交，**未动**日记/同步/发布文档那批改动。

### 261113 · 移动端「转为小记」+ 发版复核 P2/P3 + v1.1.1 发布（已本地提交）

- **移动端补「转为小记」（task-106，`a57cf3cf`）**：日记条目 ⋯ 新增「转为小记」，与桌面同语义 —— 原 Lake 正文复制成新小记、图片/附件搬到 `/quick-notes/<id>/`（**原资产保留**）、原文软删进回收站（可恢复）；数据层 `src/mobile/diary/diaryToQuickNote.ts`（非 doc 拒绝 / 已引用资产缺失明确失败 / 不可承载卡片剥掉并 `droppedKinds` 明说 / 任一步失败 `removeUnsyncedQuickNote` 回滚不留半成品）+ `bridge/diary.diaryToQuickNote`（写域）+ 文案与桌面逐字一致 + ⋯ 二次确认与 toast。**至此两端都有两个单篇出口**。设备验收（5556：含图小记 / board 卡明说未搬运 / 回收站恢复）见 22 号报告 §11（audit-261112/22-diary-untag-multi-end.md，已删 git 可查），证据 audit-261112/evidence/diary-to-quicknote-mobile/（已删 git 可查）。
- **发版复核 P2/P3（task-105，`839c7a93`）**：core/electron + 桌面 UI —— 转换守卫、资产匹配、kind 单一来源、目录告警、计数、可访问性、toast×dock。
- **v1.1.1 已发布**：tag `v1.1.1`（GitHub Release 8 个资产 = APK / macOS arm64 dmg+zip / Windows exe / latest.json / release-body；run id 见 §1），本地 packaged smoke 通过；发布说明 = [RELEASE-NOTES](RELEASE-NOTES.md) 顶部段落。
- **文档收口（261113）**：AGENTS §3#25③ 明确「两端都有、同名同语义」；[DIARY](DIARY.md) / [guide 16](../guide/16-diary.md) 补移动端入口与行为（⋯ 菜单、媒体复制、原稿可恢复、droppedKinds、非 doc 拒绝）；[RELEASE.md](RELEASE.md) 新增 GitHub Secrets 节（Android 4 个名字 + 缺失后果 + `GITEE_TOKEN`）；[README](../README.md) / [MOBILE-OPS](MOBILE-OPS.md) 的 Android secret 名改为 `ANDROID_KEYSTORE_BASE64`（`ANDROID_KEYSTORE_PATH` 是 workflow 派生变量）。
- 本波门禁见 §1。

### 261112 · 日记本不可变 + 两出口 + 回收站预览加固（已本地提交，未推送）

- **日记本固定不可变（261112 用户裁决，红线见 AGENTS §3#25）**：`199f3403` 移除「取消日记标记」并把日记本定为固定不可变笔记本（`space` 只升不降；删除 / 改名 / 图标 / 排序 / 移动**均设守卫拒绝**）；`fd58dc0a` 移动端移除入口与写路径（保留单篇出口）；`d4d03260` 移动目标候选统一剔除日记子树（core 单一判据，桌面+移动共用）。
- **两个单篇出口**：`f965e62c`「转为文档」复用 AI 写作「生成文档」同款共享弹窗（只选知识库笔记本、标题可改、不选分组；先 move 再 rename）；`4b6a524a`「转为小记」原样承载 Lake 正文并搬运图片/附件（`/<noteId>/` → `/quick-notes/<id>/`，journal 原子/回滚/droppedKinds 明说；原稿进回收站可恢复、原资产保留）。
- **UI 修复**：`400dcc75` 非知识库空间也能看到 `showNotice` 提示（toast 从状态栏空壳拆出，7 个空间可见）；`3cf19a29` 回收站「云端已删除（仅本地）」副本整行可点 + 标题不再被徽标挤成 0 宽（缺正文给明确提示，task-89）。
- **发版复核修复（261112 晚）**：`142244cd` 三处真缺陷——F-01 `plan.withPosition` 显式写位置 null（否则本地已恢复被远端正文更新回滚）、F-02 同步 apply 冻结日记本的 parent/trashed 位置（旧端/脏索引不能再移动/回收它）、F-03 日记→小记创建阶段失败也回滚并清 journal/staging（不再出现「报错但重启补出小记」）。
- **文档/契约**：AGENTS §3#25、[docs/DIARY.md](DIARY.md)、[guide/16-diary.md](../guide/16-diary.md) 已同步口径；本波门禁数字见 §1。
- **发版前文档收口（261112 晚，docs-only，已本地提交）**：`0c7175cf` 新增 25 发版前移动端复核（audit-261112/25-release-review-mobile.md，已删 git 可查）；`de684e98` 补 **v1.1.1** 发布说明段 + 发版标题/版本号核对要点；`7a62d349` guide 同步本轮行为变化（日记固定+两出口 / 单篇失败降级 / 逐项 warning / 仅本地副本可预览）；随后 `task-101` 做 AGENTS/HANDOFF/SYNC-PROTOCOL/DIARY 四文档一致性复核（本批改动未提交）。

### 261112 · R2/C2 拆分收口 + 设备验收 + S3 真实桶收口（已本地提交，未推送）

- **拆分 6–10（Q19=C2）**：Sidebar 1857→1498（7 内部组件到 sidebar/）；SettingsPanel 1447→89（11 个 sections + useSettingsPanelScope 722 行）；electron/main.ts 1306→1100（boot/paths.ts + boot/ipcWiring.ts 281 行，21 依赖显式传递、单例留 main）；lakeRuntime 1699→538（6 个 kernel 模块，lazy 边界/模块级单例/__disposeExtras 时序保持）；InkPad 阶段② 完成：抽 `InkCanvas` + `InkToolbarDesktop`（InkPad 1790→1533），ink 全测 226 例绿；品牌启动（见下）改透明雀。
- **设备验收（真机 + 模拟器）**：R1 APK 已 --sync --install 到真机 Xiaomi 2109119BC（Android 14）与 5554 模拟器；**Q04 通过**（回收站文档 = 只读预览 + 横幅「编辑与保存会被拦截」，CDP 断言 + 截图）；**Q22 通过**（SecureStore→SecretBox：set/get → force-stop 重启 → get 仍为原值 → remove 清空，真机 Keystore 冒烟）；首页/Dock 正常、logcat 无 FATAL。记录与截图：docs/audit-261112/12-device-check.md（已删 git 可查）。
- **设备门禁矩阵（R2 代码重装后）**：手机 10 态（lake_gate / 9336）与平板 10 态（lake_tab / 9340）均按夹具重烤后**连跑两轮 0 差异**；多维表 3 态重烤后两轮 0 差异；**23 屏走查 23/23 ok**；窗口矩阵 `pass: true`。基线三份（mobile-snap / tablet / bitable）已随本批更新。**桌面 42 态也已重烤**：合成夹具 + 隔离实例，42/42 态采集、34 严格态连跑两轮 0 差异（8 窄窗按既有 UNSTABLE 跳过）；基线 `scripts/css-audit/baseline/stylesnap.json` 已更新。
- **门禁（R2 收尾实测）**：tsc 0；全量 vitest **886 文件（875 passed / 11 skipped）/ 5597 用例（5585 passed / 12 skipped）/ 0 failed**；ui-metrics **shadowed 0 / 跨文件重复 45** / !important 9=清单；check:core 172/0；check:mobileui 通过；双 build + bundle/arch PASS（desktop 首屏 567,551/600,000、app-js 196,192/307,200；mobile 348,211/360,000、entry 60,803/61,440、css 139,503/141,312）；diff-check 0。
- **待验/未做**：Q03 历史预览、Q07 preview 档、Q05 字号的设备级点按（单测已绿）；~~移动小记画廊 video/audio 混入~~（已修 task-32）；~~剩余 21 条 shadowed 声明~~（已清零 task-34）+ ~~mobile.css 域归位~~（已完成 task-33）；~~docs 侧机器路径~~（已清零 task-35）。**设备矩阵（手机/平板 10 态 + 多维表 3 态 + 23 屏 + 窗口 + 桌面 42 态）已全部重烤并两轮 0 差异**。
- **S3 真实桶验收（A 档 20/20 + B 档 57/57）**：三桌面隔离实例 + 七牛真实桶（**唯一测试前缀**，结束只 DELPREFIX 本前缀）⇒ **A 档 20/20 场景 PASS**；**B 档 13 条 57/57 PASS**（task-58 完成；含 S72 修复后复跑），前缀 **0 残留**。记录：13 写路径越界扫查（G1–G18 结论已并入 SYNC-PROTOCOL §9.6 附注）· 14 S3 场景矩阵（收口 45 有 / 28 部分 / 1 真空，结论同附注）· 19 B 档 13 条验收（已删 git 可查）· 21 移动多端 A–F（方法已搬 `scripts/multi-end-sync/README.md`）。
- **同步语义收口（`3fad8821`，task-44 落地）**：位置三件套独立三方合并（`src/core/s3v3/plan/positionMerge.ts`）+ 纯移动轮也发布（`apply-position`）；同步专用写路径（`saveSynced`/`saveSyncedNote`，桌面+移动同口径）；单篇 apply 异常降级为 warning+continue（不再整轮卡死）；P1-a engineBridge 改读 `meta.nodeType` 根治；P1-b 目录 local-purge 置 indexChanged。锁字段独立合并与发布 = **task-47 已落地**（基线+lockedAt LWW，见 §2）。语义要点见 §2。
- **品牌启动图（`8a131acd` / `6c5e52b1`）**：启动标记改**透明双绿折纸雀**、启动底走**主题窗色**（去掉白底/薄荷圆）；启动动画改 CSS 后删除已无引用的 APNG/poster（约 −1MB）。
- **文档批次**：主计划 K–P 重复段去重（`a2caf0ba`，821→698 行 / −123，无内容丢失）；本轮只读审计分册 13 写路径守卫越界扫查 / 14 S3 全场景矩阵 / 15 只读门禁与同步 warning 通路 / 16 移动端生命周期等价性 / 17 只读、回收站、云端已删除、保存被拒 UI 一致性 / 18 生命周期实测 / 19 真实桶 B 档 / 20 独立复核 batch2 / 21 移动多端 A–F（均已删，git 可查；13、14 结论已并入 SYNC-PROTOCOL §9.6 附注，21 手工方法已搬 `scripts/multi-end-sync/README.md`）。
- **S3 语义修复第二波（261112 晚，均已本地提交）**：① **S72** 被远端移入回收站 + 本地有未同步编辑 ⇒ **强制留历史快照**（`903a47aa`）；② **F-01b** 目录 purge 后云端索引残留（4 处叠加根因）已修（`fa2fbdad`）+ 矩阵附录 D 回写（`dc882945`）；③ **H73-G1** 位置赢家为远端时生命周期变更不再被 `lifecycleRace` 永久挡住（`4db266e9`）；④ apply 跳过改**独立 kind `apply_skipped`** + 诊断逐项 + P0 回归护栏（`1db5dea6`）；⑤ `positionMerge` / `mergeNoteLock` 表驱动 **32 例**（`811df501`）；⑥ 矩阵收口（覆盖 **45 有 / 28 部分 / 1 真空**、新增 S08）（`18019c1f`）。**task-46/47/52–58 全部关闭**；本波门禁见 §1。
- **AGENTS 新红线（`68e90df4`）**：§3#23 写路径守卫分层（用户策略只在入口/同步专用写路径，声明 U/S/I/R/M 调用方分类）+ §3#24 位置与内容正交（位置基线三方合并、恢复历史=内容动作、purge 整棵子树、**不加位置 wire 时间戳**）——内容以 AGENTS 为准，本文不复述。

## 1. 当前基线（唯一状态来源）

**261124 · v1.6.3（review 查漏 + P3 全清；tag v1.6.3 触发 Release）**：21/22 P3 落地（1 待复现登记）+ A4 桌面树行补漏；新护栏 ~20 例；语义变更 2 处（深清锁 TTL 窗、目录 keepLocalTrash）已钉。

**261124 · v1.6.2（审计 Batch B 十五处 P2 修复；tag v1.6.2 触发 Release）**：B2–B9 全清（含 B8 全 8 项、F9 便携保真），新护栏 ~22 例；B9 两条待复现场景与 B1 偏差登记见上条。**P3 清理与审计护栏清单（~40 条）未动**。

**261124 · v1.6.1（审计 Batch A/P0-B1 十条数据安全修复；tag v1.6.1 触发 Release）**：五流审计报告在 `docs/audit-261124/`（已删，git 可查；未修清单摘在 §3）；10 条修复各带回归（新护栏 ~25 例）；全量 vitest 见发版记录；语义订正钉 2 处（基线≠删除意图、绝不物删）。**B 批/P3/护栏清单在审计报告，未修**。

**261124 · v1.6.0（P0 同步丢子文档修复 + 回收站小记预览 + 小记列表三修；tag v1.6.0 触发 Release）**：全量 vitest **7088 passed / 1 flaky（perf.integration 单跑 PASS）**；tsc 双 0；ui-metrics 0；check:core 185/0；check:bundle+arch PASS；stylesnap 重烤后 32 严格态 0 差异（10 态 UNSTABLE/FLAKY_ASYNC 跳过）；diff-check 0。**真桶复现测试**（`src/mobile/v3/childDocs.s3.integration.test.ts`，前缀 lakex-notes-dev3 每次测后清空）2/2 绿。提交链：60f4d583/7c3792c5/df82cbe0/569b5970/f5d94eb0/0eb526c3/da57e588/8dc1fa32/efb30d4c/872a38a1/82c6da74 + 发版 tag。mobile-snap 门禁仍受阻（lake_gate 数据非固定夹具，§3 等裁决）。

**261124 · 回收站小记预览 + 小记列表三修批（未发版；6 提交：60f4d583 / 7c3792c5 / df82cbe0 / 569b5970 / f5d94eb0 / 0eb526c3）**：全量 vitest **7089 passed / 0 failed（真退出码）**；tsc 双 0；ui-metrics 0（未定义令牌清零）；check:core 185/0；check:mobileui 过；check:bundle+arch PASS；diff-check 0；IPC 通道 **196→197**。设备：lake_mobile（5554）装 4 版 debug 包并设备级点收（回收站小记预览/恢复/恢复后可见）；lake_gate（5556）**数据已非固定夹具 ⇒ mobile-snap 未重烤**（§3 待裁决）。桌面弹窗/移动预览层的 stylesnap/mobile-snap 状态未覆盖本批改动面（trash/lightbox 不在态清单）。

**261124 · 基线（数据事故复盘批 + 三需求，v1.5.10 发布中）**：e25c85a9 五修复 + 4acec2a2/5393cefe 三需求 + c92cda44 契约；全量 7073 passed。

**261123 · 三次批基线（密钥/目录/首相遇收口；已发 v1.5.9）**

- 本批 8 提交（4bc7127d/7c2a21fc/fd6ff76e/5e7b5d8b/e26f04c5/5fa4a921 等）；含前两批累计 35 提交（61967f18..HEAD，v1.5.6 之后未发版）。
- 门禁：全量 vitest **7064 passed / 0 failed（真退出码复核）**；tsc 双 0；git diff --check 0。文档口径批已落（密钥 7 处 + DESIGN 动效例外）。
- 首次相遇真桶 E2E 7/7（S3V3_IT 门控）；清欠账后老 A/B 套件与新语义对齐（283 处显式选择）。

**261123 · 二次批基线（云端首次相遇 + 粘贴专案；未发版）**

- 本批 9 提交（2bde53e3/46293426/e8a403e2/3ae4b2f1/4ed6fa21/d66e7289/45ddf98b/2da748ac/2947dd4b）；含六线批累计 24 提交（61967f18..HEAD）。
- 门禁：全量 vitest 0 failed；tsc 双 0；ui-metrics 0；check:bundle+arch PASS（desktop 581,218/592,000、mobile 首屏过、entry 44,104/46,000）；git diff --check 0。真桶首次相遇 E2E 7/7（S3V3_IT 门控文件 firstEncounter.s3.integration）。
- 移动端 UI 改了 SettingsDrawer/useS3SettingsForm（首次相遇弹窗+探测）⇒ 待装包；设备弹窗截图留验收。

**261123 · 六线并发批基线（未发版；v1.5.6 之后）**

- 14 提交（61967f18..HEAD）：ae0c0399 Windows 顶栏 / 6d43c71b usheet 行高 / bec9bd47 bootstrap 核心 / b1d0e30d 触点登记 / f9011fcd dock 两 bug / 906119f7 整库目录+真桶集成 / 22863157 stageFromPath / 9525272b 规模口径 / dd0c7847 P1-B / 600350cb 审计修复批 / 0b35dfc1 规模对抗测试 / 0e192161 两 P0 闭环 / c62e11b5 设置文案 / 40dc636a S3 表单水合。
- 门禁实测：全量 vitest 1117 文件 0 failed；tsc 双 0；ui-metrics 0（!important 9 = 清单）；check:core 184/0；check:mobileui 过；check:bundle+arch PASS（desktop 580,130/592,000、mobile 341,446/345,000、entry 44,104/46,000、preload 12/12）；git diff --check 0。
- 规模/对抗测试新增门控层：对抗 3 文件并入日常全量（<1s）；规模 3 文件 `LLN_SCALE=1` 门控（~10s）；真桶 `LLN_SCALE=1 S3V3_IT=1` 双门控（凭据走 env）。
- 视觉快照未跑（本批含约 70 处文案变化 ⇒ 设置屏快照指纹可能红，发版前全量快照按「文案批」归因重烤）。Android debug 包为 261123 中段构建（含 dock 修复）；Windows 包未重打（待用户确认 arch）。

**261122 · 大统一迁移包批基线（未发版；v1.5.4 之后）**

- 起点 = `master` @ `4b816b63`；本批全部门禁见 §0 记录（全量 vitest 1089 文件 / 6913 例 0 failed；双端 build + check:arch/check:bundle PASS；ui-metrics 0；tsc 0）。
- 通道数 191 → **195**（+pick_restore_backup_dir / restore_workspace_from_backup_dir / portable_import_pick_file / portable_import_run）。
- Android debug APK 已构建并安装启动（`android-build.sh --sync --install`，BUILD SUCCESSFUL）；设备级功能点收待用户。

**261121 · 表格粘贴/默认值批基线（未发版；v1.5.4 之后）**

- 起点 = `master` @ `4b816b63`（v1.5.4 + 文档；原工作树停在 v1.2.0 的已合并分支，已切回）。
- `npx tsc --noEmit` = **0**；`git diff --check` = 0。
- 相关 vitest：`src/features/usheet` + `src/core/usheetDoc.test.ts` **66/66**；`QuickNoteComposer.render.test` **7/7**。
- `ui-metrics` = 0（颜色 0 / 字号 0 / `!important` 9 = 清单 / 跨文件重复 45 = 基线 / 被压声明 0）；`check:core` **182** 文件 0 违规。
- 扩面 vitest：`src/features/usheet + src/core + src/mobile/usheet + src/components/app` **253 文件 / 1840 例全过**。
- `check:bundle` + `check:arch` PASS：desktop 首屏 **580,754 / 592,000**（余 11.2KB）、mobile 首屏 **340,541 / 345,000**（余 4.5KB）、mobile entry **43,334 / 46,000**（余 2.7KB）、mobile CSS 140,279/141,312、preload 12/12；`audit-vendor-css` OK；import 方向 0 违规。
- 未跑全量 vitest / 视觉快照（本批无 CSS 改动；表格默认值属内容区，不进 tokensnap）。⚠️ 先跑 `check:bundle` 前必须**先重建移动包**（`npx vite build -c vite.mobile.config.ts`），否则读到旧 `dist-mobile` 会假红 mobile entry。
> 数值 = 最近一次实测（261113 批，低负载串行）。**任何状态判断以本节 + `git status` / `git log -1` 为准**。

**261118 · v1.3.6 基线（端口固定化查漏补缺，tag `v1.3.6`）**

- **工作树**：本批已收口并通过门禁 —— 移动端顶部 Chrome/键盘/多维表选择器连续修复、正式数据三问题修复（打开伪保存 / 大纲二次跳 / renderer 恢复空窗）、附件超限统一提示、Lake 图片/视频媒体卡自适应与边缘缩放；HEAD 以 `git log -1` 为准。
- **分支**：`v1.3.5..v1.3.6` = 1 commit；本批提交后推送 master 双远端，无新 tag；上一 release = `v1.3.5`（tag `e9f49cee`）。
- **版本**：`package.json 1.3.6`；Android versionCode 11306（由根 package.json 派生）。
- **端口（固定，不再回退）**：资源 packaged 19876 / dev 19877；Web packaged 19880 / dev 19881；`LAKE_ASSET_PORT`/`LAKE_WEB_PORT` 可覆盖；占用时明确报错；端口在 listen 前固定（失败也不退回默认常量），preload 只从 env 读。
- **门禁（本批最后全量）**：`tsc` 0；`typecheck:electron` 0；全量 vitest **1025 files passed / 13 skipped（6499 tests passed / 14 skipped）**；`ui-metrics` 0；`cssLayers`/`primitives`/`mobileLayers` 全绿；`check:arch` 0 违规；Android debug 已构建并安装 emulator-5554；`git diff --check` clean。
- **打包产物**：本地 `release/` 已删（ignored 旧产物）；发版重建，瘦身基线仍为 v1.3.1（`.app` 393MB / `asar` 70MB / 依赖 9 个，见 `docs/BUILD-SIZE.md`）。
- **视觉门禁**：本批无视觉变更，未跑 stylesnap/mobile-snap。

**261120 · 点单批基线（未发版；v1.5.2 之后）**

- `npx tsc --noEmit` = **0**；`typecheck:electron` = **0**。
- 全量 vitest：**文件 1072 passed / 13 skipped（1085）**；**用例 6814 passed / 14 skipped（6828）/ 0 failed**（负载高时 `useKeyboardStableSheet`/`perf.integration` 类计时断言偶发 1 例红，单跑/复跑即过 —— 既有口径）。
- `ui-metrics` 0（!important 9 = 允许清单 / 跨文件重复 45 / shadowedDecls 0 / 颜色 0 / 字号 0）。
- `check:core` **181** 文件 0 违规；`check:mobileui` 通过。
- `check:bundle` **PASS**：desktop 首屏 **579,064 / 592,000**（余 22,936B；预算按本批瘦身后收紧，见 §0「首屏预算收口」）、mobile 首屏 **348,308/350,000**（entry **51,343/51,440，余 97B ⚠️**、CSS **140,239/141,312**、preload 12/12）；vendor CSS 审计 OK、import 方向 0 违规。
- 桌面超预算的旧欠账（本批前 HEAD 实测 603,695 > 602,000）已在 A 里清掉；**mobile entry 97B 余量仍需下一笔瘦身**（登记在 §3）。
- 层围栏基线按批上调：`styles/chrome.css` 533→**539**（目录行三件套 chip）；`mobile/floating.css` 318→**320**（文档引用 Sheet 两处间距/对齐）；`mobile/editor/editor-dock.css` 305→**308**（链接行键盘让位，mobile-link 流）。
- stylesnap：`hover-row:1315:{light,warm}` 两态重烤并复检 **0 差异**（42 态总数不变；n 2523→2524 经 A/B 证伪 = 夹具/实例漂移，非本次 CSS）；其余 40 态未跑（非本批改动面）。
- Android：debug APK 已重建并安装 emulator-5554（`--sync`，41.6MB）；设备验收见 §0 两项（文档引用 / 链接输入）。真机（小米）未验。

**261119 · 修复批基线（未发版；v1.4.0 之后）**

- `npx tsc --noEmit` = **0**；`typecheck:electron` 未动 electron/。
- 全量 vitest：**文件 1067（passed / 13 skipped）/ 用例 6769（passed / 14 skipped）/ 0 failed**（含 261119 各批新增）。imeEnterWiring 33 处（MediaSizePop 收口后）；selectionToolbar.css 基线 158；check:mobileui 新增三道按钮边界护栏。
- `ui-metrics` 0（!important 9 = 允许清单 / 跨文件重复 45 / shadowedDecls 0）；`cssLayers`/`mobileLayers` 棘轮按实测登记：selectionToolbar.css **164**、mobile-find.css **20**、mobileBitable.css **1109**、notePaneSkeleton.css **23**（新）、quick-notes.css **277**、floating.css **316**、mobile.css **1487**、kit.css 659。
- `check:core` **181** 文件 0 违规；`check:mobileui` 通过；`check:arch` 0 违规（desktop 首屏 599,783/600,000）；`check:bundle` PASS（mobile entry **51,359/51,440**（261119 用户批准登记上调，理由入脚本注释）、移动 CSS 140,465/141,312、preload 12/12）。
- `git diff --check` = 0。kind 触点登记：NotePaneSkeleton.tsx = 3（骨架形态分派）。
- 设备（模拟器 lake_mobile，本批已装包）：5 项交互验收 PASS（速记返回/表单焦点/拍照相机/头部恒定/查找条）+ 多维表 7 屏探针 7/7；标签长按菜单与桌面视频弹窗目视待用户点收。

**v1.5.4 已发**（261120 晚）：`package.json 1.5.4`（Android versionCode **11504** 由根 package.json 派生）；注解 tag **v1.5.4**（commit `c14ef73c` = release 提交，产品提交 `7c325c66`/`193b34aa`/`c4a89b9e`…）双推 Gitee+GitHub；GitHub **Release workflow 由 tag 触发**：macOS/Windows/Android 三个构建 job **全 success**，GitHub Release **v1.5.4** 已发布（8 资产，安卓 APK 32,711KB），**Gitee 已镜像 APK**（source zip/tar + apk）。**Budget gate** 对该 master push = success。
  **安卓产物独立复验（261120）**：从 Gitee 下载 `LakexLocalNotes-1.5.4-android-release.apk`（33,496,104B）⇒ `unzip -t` ZIP_OK；sha256 **ce026d82…0656a2** 与 GitHub 资产 `latest.json` 的 android 条目逐字节一致；`aapt` = com.lakexlocalnotes.android / versionCode **11504** / versionName **1.5.4** / targetSdk 36；`apksigner` = v2 通过、证书 CN=LakexLocalNotes, OU=Release、SHA-256 `a8ba87f7…212e35`（**与 v1.5.2/v1.5.3 同一个 release keystore ⇒ 可覆盖升级**）、四套 ABI。**并在一次性干净 AVD（API 36）真装真跑**：install Success → 启动 PID 存活、crash buffer 空、首页欢迎小记正常（验证后已删该 AVD）。
  **本批内容**（用户点单 261120）：笔记本「已收起」（桌面置底区 + 移动折叠分组，设备本地/不进 S3；分区内子树默认收起；桌面分区可上下拖拽调高度、双击复位；修复分区内点行不展开）、桌面目录行与多维表内容 15px、移动知识库书架卡 3 列改版、启动页统一白底 + 只留透明绿折纸（删 328KB APNG + 11 张带圆盘 splash.png）、移动入口 −8,727B（虚拟行窗口懒加载 + 启动期维护/诊断按需）、移动端打开笔记本无标签页保持空态。
**261120 · v1.5.4 基线（点单批 + 首屏瘦身收口，tag **v1.5.4**）**

- `npx tsc --noEmit` = **0**；`typecheck:electron` = **0**。
- 全量 vitest：**文件 1079 passed / 13 skipped（1092）**；**用例 6847 passed / 14 skipped（6861）/ 0 failed**。
- `ui-metrics` 0（!important 9 = 允许清单 / 跨文件重复 45 / shadowedDecls 0 / 颜色 0 / 字号 0 / 未定义令牌 0）。
- `check:core` **181** 文件 0 违规；`check:mobileui` 通过。
- `check:bundle` **PASS**：desktop 首屏 **579,041 / 592,000**（余 12,959B）；mobile 首屏 **340,354/345,000**（余 4,646B）；mobile entry **43,335/46,000**（余 2,665B）、CSS **140,279/141,312**、preload 12/12；vendor CSS 审计 OK。
- 本批相对 v1.5.3：移动入口 51,330 → **43,335（−8,727B，−17%）**、移动首屏 348,295 → **340,354**；预算收紧（entry 46,000 / 首屏 345,000）。
- 层围栏基线按批登记：chrome.css **579**、kit.css 766、mobile.css 1496、mobile/theme/light **76** / dark **151**、shell.css 360。
- 视觉/设备基线：stylesnap `hover-row:1315:{light,warm}` 两态重烤 0 差异（其余 40 态未跑，本批未触）；**mobile-snap 10 态整体重烤**（原基线 11-17，此后 20 个移动端提交未重烤，逐态元素数恒 +4 已归因），复检 0 差异；bitable-snap 3 态重烤（多维表内容字号 15px）。
- Android：debug APK 已构建并安装 emulator-5554；启动页白底/无圆盘冷启动逐帧验过；真机（小米）未验。
**版本与仓库**

- 主分支 `master`；**HEAD 以 `git log -1` 为准**；R2 已提交 6 笔拆分/设备记录（`a23631f6` sidebar / `fd268432` settings / `231fe845` electron boot / `c00d3a60` lakeRuntime / `4a9b965c` ink 测试 / `e352e2cb` 设备记录）；**产品代码基线 = `8e20a6a3`（R0）/ `e87016bd`（R1）/ `e352e2cb`（R2）/ `3fad8821`（R2 收尾：位置合并 + 同步专用写路径 + 单篇降级）**；**日记收口批产品笔 = `199f3403`（不可变守卫）/ `fd58dc0a`（移动移除取消标记）/ `d4d03260`（移动目标剔除日记子树）/ `f965e62c`（转文档共享弹窗）/ `4b6a524a`（转小记媒体搬运）/ `400dcc75`（showNotice 全空间可见）**；**261113 批 = `839c7a93`（发版复核 P2/P3）/ `a57cf3cf`（移动端「转为小记」+ 22 号报告 §11 + RELEASE.md Secrets 节）**（详见 §0）。
- **推送/发布**：本批收口提交 + tag **v1.1.4** 后双推 Gitee/GitHub（tag 触发 release workflow，见 §1 发布事实）；上一个 release = `v1.1.3`（tag ref `a3f47335` → commit `12b5f7d3`）。以后以 `git rev-list --count origin/master..HEAD` 与 `git log -1` 为准。
- `package.json` = **1.2.0**；Android `versionName 1.2.0` / `versionCode 11200`（从根 package.json 派生：`1000 + major*10000 + minor*100 + patch`，只增不减；**不手改 build.gradle**）。
- tag：`v1.0.0`–`v1.0.5`、`v1.1.0`、`v1.1.1`（261112 已发）、`v1.1.2`（261114 已发）、`v1.1.3`（261114）、`v1.1.4`（261114）、**`v1.2.0`（261116，分支合 master 后发布；tag 触发 release workflow；发布说明段落 = RELEASE-NOTES 顶部 `# LakexLocalNotes v1.2.0`）**；已发布 tag 不再移动。发布说明 = [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)（**v1.1.3 → v1.0.0** 倒序；当前 tag 段落 = CI 生成 GitHub Release 正文的来源）。
- 分支/远端：`master` 唯一长期分支；`origin` = Gitee（SSH，第二 pushurl = GitHub HTTPS）⇒ `git push origin <branch>` 一次推两边；GitHub 只在推 tag 时构建。remote 不入库 ⇒ 新 clone 跑 `npm run setup:remotes`。
- **工作树**：261114 批 = `f3a0e60c`（幽灵文档）→ `b676440f`（回收站浮动动作/启动不硬开/保存被拒可退出/移动 gone）→ `bbeddc3f`（级联删除）→ `c3b17bf9`（移动删除 review 收口）→ 发版 commit（1.1.3，见 `git log`）；历史上并行会话共用工作树时一律「只 stage 本批文件」，**绝不用 `git add -A`**。
- 261110 一次性历史清理（`.ai-writing-recon/` 用 `git filter-repo` 从全部历史移除，重写 v1.1.0 之后的提交；tag 未变）⇒ 旧 clone 需 `git fetch --force --prune && git reset --hard origin/master`。

**门禁基线（261114 收口批实测 2026-11-14 14:0x；分层口径见 AGENTS §3#21）**

- `npx tsc --noEmit` = **0**。
- 全量 vitest（低负载串行门禁）：**文件 = 总 956（943 passed / 13 skipped）**；**用例 = 总 6063（6049 passed / 14 skipped）/ 0 failed**。偶发 `perf.integration` 满载抖动口径见下条（单跑复验通过）。本批动了回收站行样式 ⇒ 跑了 `cssLayers`/`uiPrimitives`/`ui-metrics`（均 PASS；无该行的样式快照态，未跑 stylesnap）；移动端改动已装 APK 并设备级验收；`npx vite build` 成功（隔离验证用构建）。
- ⚠️ `electron/s3v3/perf.integration.test.ts`：**低负载串行本轮无抖动（通过）**；满载/并发构建时偶发（单跑 PASS），门禁判定以单跑/低负载为准（同 §2 既有口径）。
- `node scripts/ui-metrics.mjs`：颜色 0 / 字号 0 / `!important` 9 = 允许清单 / `crossFileDupGroups` 45 / `shadowedDecls` **0**（task-34 已清零，门禁只降）/ 未定义令牌 0。
- `check:core` **180** 文件 0 违规（`hiddenSpacesStore` 已移出 core 到 `src/lib`）；`check:mobileui` 通过。
- `check:bundle` + `check:arch` PASS：desktop 首屏 **579,135 / 600,000**（余量 20.9KB）；mobile 首屏 **343,402 / 350,000**（余量 6.6KB）、entry **49,762 / 51,200**（余量 1.4KB）、CSS 139,440 / 141,312、preload 10 / 12；vendor CSS 分层审计 OK。移动入口从「434B 余量」恢复到可加 2.4KB 的健康区。
- `git diff --check` = **0**。
- **真实 S3 桶验收**：A 档三桌面隔离实例 **20/20 PASS**（`3fad8821`）；**B 档 13 条 57/57 PASS**（task-58，含 S72 修复后复跑），唯一测试前缀 **0 残留**（19 号报告，已删 git 可查）。**移动多端 A–K 已跑完（task-72/74 已关闭；D 场景修复后复跑 9/9、收尾 0 残留，见 21 号报告——已删 git 可查，方法已搬 `scripts/multi-end-sync/README.md`）**。
- 设备/视觉（最近记录）：手机 **10 态** + 平板 **10 态** 基线重烤并连跑两轮 0 差异；23 屏走查 23/23；`edit-surface-invariants` quicknote 11 + document 11 ALL PASS；capture 入口装置 10/10。**桌面 `check:stylesnap` 42 态已重烤**（34 严格态两轮 0 差异，8 窄窗按 UNSTABLE 跳过；基线已更新，见 §3）。

**分支批基线（261115 · `modernize/web-platform-261115`；含 12 个新护栏文件）**

- `npx tsc --noEmit` = **0**；`git diff --check` = **0**。
- 全量 vitest：**文件 972（959 passed / 13 skipped）/ 用例 6126（6112 passed / 14 skipped）/ 0 failed**（本批新增 15 个测试文件；含把漏收的 `InkBackgroundSourceButtons` 纳入 render 套件）。
- `node scripts/ui-metrics.mjs` = 0（颜色 0 / `!important` 9 = 清单 / 字号字面量 0 / `crossFileDupGroups` **45 = 基线** / `shadowedDecls` 0）。
- `check:core` **181** 文件 0 违规；`check:mobileui` 通过；`check:bundle` + `check:arch` PASS（desktop 首屏 580,718/600,000；mobile 343,411/350,000；mobile entry 49,771/51,200）。
- 基线护栏随本批上调（各写明理由）：`aiDialogParts.css` 91→92、`overlay.css` 290→292、`kit.css` 674→682、`mobile/kit.css` 626→640、`mobile/usheet/usheet-chrome.css` 593→595。
- **视觉门禁（全部完成）**：桌面 42 态 —— 34/34 可严格比对的态 0 差异（8 个窄窗态按装置既有规则跳过）；移动 10 态 —— 重装新包后重烤、连跑 0 差异；23 屏走查 23/23 ok；平板/折叠屏窗口矩阵（7 档 412~1280）`pass: true`（形态判据 + active/tabs/scrollTop 保持）。**移动端已重装**（`lake_mobile`，41.57MB，0 FATAL，`.mb-tip` 生效）；对话框迁 `<dialog>` 改变 `search*` 三态 DOM ⇒ 必须在**固定夹具实例**上重烤（本轮 dev 数据试跑 2548→3143 属数据差异，**未写基线**）；`mobile-snap` 基线绑构建，同样待重烤。

**设备与环境（本机实测）**

- Node **v24.18.0**（`$HOME/.nvm/versions/node/v24.18.0/bin`，必须 24）；JDK **21**（`/Library/Java/JavaVirtualMachines/jdk-21.jdk`）；Android SDK `/opt/homebrew/share/android-commandlinetools`。
- AVD：`lake_mobile`（开发）/ `lake_gate`（门禁固定夹具，**勿改其数据**）/ `lake_tab`（平板与窗口矩阵）；移动 CDP **9335 开发 / 9336 门禁 / 9340 平板**（桌面 dev 9222；serial 以 `adb devices` 为准）。
- 数据：开发 `~/Library/Application Support/lakex-local-notes-dev`；正式 `.../lakex-local-notes`（**禁止触碰**）；日志在对应目录 `logs/`。
- **261112 R1 设备验收**：真机 Xiaomi 2109119BC（Android 14，serial 50950385）+ 5554 模拟器已装 R1 APK；Q04 回收站文档只读预览、Q22 SecureStore→SecretBox 跨重启真机通过；快照矩阵（手机 10 态 / 平板 10 态 / 多维表 3 态 / 23 屏 / 窗口矩阵）已重烤并两轮 0 差异；Q03/Q07/Q05 观感项仍待人工点收；桌面 42 态已重烤（证据 docs/audit-261112/12-device-check.md，已删 git 可查）。

**v1.1.4 已发**（261114）：tag `v1.1.4`（注解，tag object `de37abe6` → commit `f2c44c1b`）已双推 Gitee/GitHub；release workflow run **43564917249** 由 tag 触发：Windows/Android/macOS 三个构建 job **全 success**；GitHub Release **v1.1.4** 已发布（2026-11-14T06:15:35Z），8 资产：`LakexLocalNotes-1.1.4-android-release.apk` / `-arm64.dmg` / `-x64.dmg` / `-arm64.zip` / `-x64.zip` / `LakexLocalNotes.Setup.1.1.4.exe` / `latest.json` / `release-body.md`；`latest.json.version = 1.1.4`。`Publish Release` job 在 GitHub Release 发布后仍进行（Gitee 镜像/收尾，可能耗时），不影响 GitHub 产物。Android 本机 debug APK 已装 `lake_mobile`（versionName 1.1.4 / versionCode 11104）并启动。

**v1.5.2 已发**（261120）：`package.json 1.5.2`；注解 tag **v1.5.2**（commit `d1aabe33`）双推，release workflow run **44654490804** 触发。背景：用户 261120 晨清理全部 GitHub Releases/Runs 历史并手建轻量 tag v1.5.2（指 `f6397eca`，package.json 1.5.1 ⇒ release.yml 版本一致性守卫必然失败）⇒ 发版工程重建：登记 1.5.2 + 发布说明（**v1.5.1 未对外发布、内容由 v1.5.2 承载**），**删除并重打 v1.5.2 tag**（⚠️ AGENTS「已发 tag 不可移动」红线**例外一次**：该 tag 为用户手建草稿态、无发布物/无消费者/无下载方，处置经自主授权并在此亮牌登记；下不为例，已发 tag 仍不可移动）。

**v1.5.3 已发**（261120）：`package.json 1.5.3`（Android versionCode **11503** 由根 package.json 派生）；注解 tag **v1.5.3**（commit `236fba1b` = release 提交，产品提交 `ba08731a`）双推 Gitee+GitHub（push master 与 push tag 各自一次推两边）；GitHub **Release workflow 由 tag 触发**（构建 macOS/Windows/Android + packaged smoke 内联 + 发布 Releases + Gitee 镜像），**Budget gate（261120 新增）首次在 master push 上跑 = success**。
  **安卓产物独立复验（261120，因 v1.5.1 曾发失败）**：从 Gitee 镜像下载 LakexLocalNotes-1.5.3-android-release.apk（33,722,820B，与 GitHub 资产同尺寸）⇒ unzip -t 校验 ZIP_OK；sha256 ＝ 1fdc48da…c424fb，**与仓库 latest.json 里 android 条目逐字节一致**；aapt ＝ com.lakexlocalnotes.android / versionCode **11503** / versionName **1.5.3** / minSdk 24 / targetSdk 36；apksigner ＝ **v2 方案通过**、证书 CN=LakexLocalNotes, OU=Release（SHA-256 a8ba87f7…212e35，**与 v1.5.2 同一个 release keystore ⇒ 可覆盖升级**）、application-debuggable 不存在（非 debug 变体）、ABI 四套齐全。**并在一次性 AVD（API 36 干净镜像）上真装真跑**：install Success → 启动 PID 存活、无 crash buffer、首页欢迎小记正常渲染（验证后已删除该 AVD）。
  Release run id ＝ 44667849348（三个构建 job + Publish Release 全 success，8 个资产齐全，Gitee 已镜像 APK）。发版内容 = 目录右键「在上方/在下方新建」二级菜单（六 kind 锚点落位）+ 目录行三件套指向态 chip + 移动端插入链接/文档引用改可拖动浮窗 + 桌面首屏 −24,984B（发版说明按需加载）+ 首屏预算收紧 602,000→592,000；无数据/协议迁移。

**v1.5.1 已发**（261119，未对外发布——GitHub Releases 261120 被清理，内容由 v1.5.2 承载）：`package.json 1.5.1`（Android versionCode 11501 派生）；注解 tag **v1.5.1**（commit `b5ecf605`）双推 Gitee+GitHub；release workflow 触发（内容 = 修复批二 + 修复批三 + 目录/封面/禁缩放收口批，发布说明 = RELEASE-NOTES v1.5.1 段；无数据/协议迁移）。

**v1.5.0 已发**（261119）：`package.json 1.5.0`（Android versionName 1.5.0 / versionCode 11500 由根 package.json 派生）；注解 tag **v1.5.0**（commit `23492cc9`）双推 Gitee+GitHub（origin 第二 pushurl 一次推两边）；release workflow run **44490098568** 由 tag 触发（Release，构建 macOS/Windows/Android + packaged smoke 内联兜底 + 发布 GitHub Releases/Gitee 镜像）。发版内容 = 261119 各批（快捷菜单两项/拍照直出相机/速记返回链/多维表四项/标签长按菜单/跳变八项/选项色板两行/表格取色合规/视频宽高弹窗合流）+ 261117 随下版两笔（text_cache 保存即建、更新中心版本标签），发布说明 = RELEASE-NOTES v1.5.0 段。发版前评审 = 双只读评审流（P0×0 / P1×4 / P2×11 全闭环，见 release 前两笔修补提交）。

**发布与推送事实**

- **v1.1.3 已发**（261114）：tag `v1.1.3`（注解，commit `12b5f7d3`）→ Release workflow run **43405437257**；macOS/Android/Windows 三个构建 job 全 success，GitHub Release **已发布**（2026-11-13T10:04:40Z）含 8 资产：`LakexLocalNotes-1.1.3-arm64.dmg` / `-x64.dmg` / `-arm64.zip` / `-x64.zip` / `LakexLocalNotes.Setup.1.1.3.exe` / `LakexLocalNotes-1.1.3-android-release.apk` / `latest.json` / `release-body.md`；`Publish Release` 收尾 job 当时仍 in_progress（Gitee 镜像/收尾），不影响 GitHub 产物。
- **v1.1.2 已发**（261114）：tag `v1.1.2`（注解）→ Release workflow run **43384377793**；产物 8 资产见上（§0 本批）；Android job 的 release 签名校验通过（4 个 secrets 齐备）。
- Android 签名 = release keystore（证书 SHA-256 见 git 历史 v1.0.2 批次）；**keystore 必须离线备份**，丢失后无法覆盖升级。
- macOS = x64 + arm64 分开打包，ad-hoc 签名未公证（首次打开走「仍要打开」）。
- **GitHub 推送优先走 SSH remote `github`**（HTTPS 到 github.com 实测不通）；**VPN 开启时 GitHub 一律不通**（含发版 tag），发版前确认 VPN 已关。
- 发版流程 [docs/RELEASE.md](RELEASE.md)；用户手册 [guide/README.md](../guide/README.md)。

**文档地图（现存；已删文档不要再链；本表是唯一索引）**

- 入口 / 红线：[README.md](../README.md) · 本文件 · [AGENTS.md](../AGENTS.md) · [CONTRIBUTING.md](../CONTRIBUTING.md) · [SECURITY.md](../SECURITY.md)
- 架构 / 产品 / 设计：[docs/ARCHITECTURE.md](ARCHITECTURE.md) · [docs/PRODUCT.md](PRODUCT.md) · [docs/DESIGN.md](DESIGN.md) · [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md) · [docs/PAD-ADAPTATION.md](PAD-ADAPTATION.md)
- 同步 / 存储 / 容错：[docs/SYNC-PROTOCOL.md](SYNC-PROTOCOL.md) · [docs/STORAGE-LAYERS.md](STORAGE-LAYERS.md) · [docs/RESILIENCE.md](RESILIENCE.md) · [docs/SYNC-DEVICE-CONTRACT.md](SYNC-DEVICE-CONTRACT.md) · [docs/SYNC-STATE-CONVERGENCE.md](SYNC-STATE-CONVERGENCE.md)
- 空间 / 契约：[docs/DIARY.md](DIARY.md) · [docs/AI-WRITING.md](AI-WRITING.md) · [docs/TAG-SYSTEM-DESIGN.md](TAG-SYSTEM-DESIGN.md) · [docs/PANEL-CONTRACT.md](PANEL-CONTRACT.md)
- 发布 / 更新 / 换机：[docs/RELEASE-NOTES.md](RELEASE-NOTES.md) · [docs/RELEASE.md](RELEASE.md) · [docs/UPDATE-CENTER.md](UPDATE-CENTER.md) · [docs/PORTABLE-TRANSFER.md](PORTABLE-TRANSFER.md)
- 内核 / 表格 / 多维表 / 手写板：[docs/LAKEX-CONTRACT.md](LAKEX-CONTRACT.md) · [docs/lakexEditor-developer-docs/](lakexEditor-developer-docs/) · [docs/USHEET-UPGRADE.md](USHEET-UPGRADE.md) · [docs/INK-PAD.md](INK-PAD.md) · [docs/BITABLE-VIEWPORT.md](BITABLE-VIEWPORT.md)
- 移动端：[docs/MOBILE-OPS.md](MOBILE-OPS.md) · [docs/MOBILE-TECH-STACK.md](MOBILE-TECH-STACK.md) · [docs/MOBILE-TOP-CHROME-REFACTOR.md](MOBILE-TOP-CHROME-REFACTOR.md) · [docs/MOBILE-AI.md](MOBILE-AI.md) · [docs/MOBILE-BITABLE-DINGTALK.md](MOBILE-BITABLE-DINGTALK.md) · [docs/MOBILE-USHEET-YUQUE-PARITY.md](MOBILE-USHEET-YUQUE-PARITY.md) · [docs/MOBILE-SHEET-EXCEPTIONS.md](MOBILE-SHEET-EXCEPTIONS.md) · [docs/MOBILE-LONG-DOC-PROBE.md](MOBILE-LONG-DOC-PROBE.md) · [docs/MOBILE-EMPTY-CATCH-LEDGER.md](MOBILE-EMPTY-CATCH-LEDGER.md)
- 工程 / 排错：[docs/DEVELOPMENT.md](DEVELOPMENT.md) · [docs/CODEX-GUIDE.md](CODEX-GUIDE.md) · [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) · [docs/LOGGING.md](LOGGING.md) · [docs/LAKE-CONTENT-WRITING.md](LAKE-CONTENT-WRITING.md)
- 使用手册：[guide/README.md](../guide/README.md)（20 章）
- 审计（本轮）：docs/audit-261112/00-MASTER-PLAN.md（保留件：附录 E = Q01–Q27 用户裁决；其余分册已删，git 可查）
- **已删（只在 git 可查，不要再链）**：`audit-261027/` 4 份审计（261112 R1 消引用后删）· `INK-DEVICE-CHECK.md` · `S3-REDESIGN.md` · `S3-V3-FINAL-REPORT.md` · 五份旧发布说明（已并入 RELEASE-NOTES）· `docs/audit-261112/` 25 分册 + device-check/ + evidence/（261125 消引用后删；**00-MASTER-PLAN.md 保留**，13/14 结论并入 SYNC-PROTOCOL §9.6 附注、21 手工方法搬 multi-end-sync/README、04 规模结论搬 MOBILE-DESIGN）· `docs/audit-261124/` 6 份（261125 未修清单摘进 §3 后删）· `design-plans/` 4 份审计（device-debt 已搬 `docs/DEVICE-DEBT.md`）· `docs/icon-migration/` A-official/B-inventory/C-poc/DECISION（判据存 C-PATH-PLAN.md）· `docs/modern-web/VERIFY-261116.md` · `docs/MERGE-REVIEW-261116.md` · `docs/arch/SIYUAN-PR-21151.md` · `docs/mockups/brand-discussion/`

## 2. 风险与已知不稳定（跨批次，别再踩）

- **快照门禁依赖设备数据**：只在专用 AVD + 固定夹具上跑；改外壳几何/构成、重灌夹具、`pm clear`、装新构建、跑过造数据探针后**必须先重烤基线**（`--from <warm>.json --write-baseline`），否则下次全量必红。5554/5556 实例有验证数据，误跑必假红。23 屏走查装置修过「菜单页误点关闭」的潜伏 bug ⇒ **历史绿灯不完全可信**。
- **模拟器 `force-stop`/`am kill` 会丢最近的 WebView localStorage 写入**（261110 控制变量实测，**不是产品代码问题**）：验「默认空间 / 主题 / 侧栏宽度」这类本机偏好要用 App 自己的退出路径（首页连按两次返回退出再启动）。
- **验收状态**：「已合并 / 已双推 / 已发布」≠「用户逐条点收」。设备绿灯只代表装置与计算值，不代表真实第三方环境（分享面板 / 文件选择器 / AI 外部服务 / S3 覆盖恢复）。
- **平板回退史**：十三批「expanded 改内核固定工具栏」已被十四批整体回退；残留旧路径（内核工具栏、`body.lake-tablet`、`__lakeSetTablet`、`nativeDeviceHint`）若被重新引入 = 第三套口径。
- **inkDoc v4（写 4、读 1|2|3|4）**：旧端读到 v4 进只读保护 ⇒ 跨端混用要在发布说明写清（含「手机/平板需重装新包」）；改格式只能「新端写新版、旧端只读」并同步 [docs/INK-PAD.md](INK-PAD.md)。
- **依赖补丁 4 处**（univer ui / plait draw / xiangfa mindmap / lakex-drawnix）：升级后必须 grep 过滤句计数 = 0 且设备上出现「手形工具 — H」；**patch 打上但未命中不会报错**，必须逐条确认语义生效（登记见 AGENTS §2）。
- **设备装置不进 CI**（无 AVD/GPU）：PR 门禁只覆盖 tsc/vitest/双 build/core/ui-metrics/bundle/arch；设备类验证必须人工跑。
- **`npx cap sync` 会改写 `android/capacitor.settings.gradle`**（`../../lakex-local-notes/node_modules` → `../node_modules`，本机等价）⇒ 每次 android 构建后、提交前 `git checkout -- android/capacitor.settings.gradle`，生成文件不要提交。
- **并行会话共用工作树**：提交前必须 `git status` 分辨；只 stage 本批文件；共享基线文件（如 `src/styles/cssLayers.test.ts`）被双方各改几行时，用 `git hash-object -w` + `git update-index --cacheinfo` 只提交本批版本；**绝不用 `git add -A`**。
- **门禁预算现状（261120 更新）**：① 桌面首屏已瘦身并收紧到 **592,000**（实测 579,041，余 13KB），此前的「超预算 1.7KB 既有欠账」已清掉；② `check:bundle` 的 **mobile-entry 只剩约 0.1KB 余量**（51,330/51,440），脚本冻结的是「现状值」——不要把它当绿，也不要把冻结值当目标，移动端入口任何新增都要先瘦身；③ 判断「是不是这次改坏了」仍先 `git stash` 重建对照，别把既有欠账算到新批头上；④ **体积门禁已上 CI**（`.github/workflows/budget-gate.yml`，push master 触发），漂移会在下一次推送就红。
- **全量 vitest 的 `electron/s3v3/perf.integration.test.ts` 在「多模拟器 + 构建」并行时会因宿主负载误报**（261112 实测：全量跑 1 例红、单跑通过；它是 500/2000 文档的阶段耗时门禁）⇒ 见它红先看宿主负载/单跑。
- **死代码/死 CSS 清理的常踩假阳性**：`SplitHandle` 的 `${className}-handle` 定位类是命中带的 `position: relative` 锚点（删了 = 「拖不动」，261110 真 bug）；移动大纲层级 `.lv1–3`、`.diary-split-handle` 同类动态类。判「没人用」先按 AGENTS §3#14 三排除；批量删样式/注释后必须核对 `mobile.css` 注释配平并跑一次视觉门禁自证。
- **删文档/审计产物前先消引用**：例 = `audit-261027/` 4 份（5 处源码注释 + 4 处文档引用）：先把结论搬进 `RESILIENCE`/`SYNC-PROTOCOL` 并改注释再删（261112 Q16 做法），否则出处断链、后续会话只能去 git 里捞。
- **日期显示口径已变（261112 Q9）**：`8/4` → `08-04`、带秒 → 去秒；快照/截图里的旧格式属预期差异。
- **`DocumentEditor` 现 import `mobile/bridge/assets`**（OpenFile 去重）⇒ 移动分包已过 `check:arch`，后续动移动懒加载先跑 bundle/arch。
- **261112 R1/R2 设备面现状**：Q04 / Q22 已真机通过；Q03/Q07/Q05 仍只有单测需人工点按；**全部快照矩阵（手机/平板 10 态 + 多维表 3 态 + 23 屏 + 窗口 + 桌面 42 态）已重烤并两轮 0 差异**；移动小记画廊 video/audio 混入已修（task-32）。
- **真实 S3 多端验收（261112，唯一前缀）**：抓到 3 个同步缺陷并已全部修复（**`3fad8821`，task-44**；P0 回收站/删除语义、P1-a 嵌套 folder parentId、P1-b 目录 purge 未清云端索引），复跑真实桶 **20/20 PASS、前缀 0 残留**、deviceConformance 绿。**S3 同步语义要点（以后按这些判，别再重新推演）：**

  - **回收站 = 特殊笔记本；删除 = 移动（且会传播）**：移入回收站 = 「移到 `notebook-trash`」的软删（正文/附件不删、**不写墓碑**），位置三元组随索引同步；purge 才是不可恢复；**恢复是唯一显式例外**（恢复标记 → local-wins）。
  - **日记本 = 固定不可变的特殊笔记本**（261112 用户裁决；契约 AGENTS §3#25）：不可取消/删除/改名/换图标/排序/作移动目标，`space` 只升不降；两个单篇出口见下（转为文档 / 转为小记）。
  - **位置三件套独立合并**：`parentId` / `trashedAt` / `deletedFromParentId` 与内容**分开**做三方合并（`src/core/s3v3/plan/positionMerge.ts`）：本地动则本地赢并发布（纯移动轮也 `indexChanged`，新增 `apply-position` 写），远端动则应用远端，两边都动按 `updatedAt` LWW；**内容赢家 ≠ 位置赢家**（内容赢家是远端时不要再上传本地旧字节）。**wire 上 trashed 条目 `parentId` 恒为 `null`**（本地容器 id `notebook-trash` 不进 wire，task-61；原始父只在 `deletedFromParentId`）。
  - **编辑锁独立合并**：`isLocked/lockedAt` 按云端基线 + `lockedAt` LWW 独立合并（task-47）：本地锁变化即 `indexChanged` 发布（他端持续编辑正文期间也发得出去）；锁不是合并屏障——他端正文照常应用、A 的锁保留；解锁是否传播靠基线变更检测（不依赖"解锁必须带时间戳"）。
  - **同步专用写路径**：`saveSynced`（`electron/store.ts` `saveSyncedNote` / `electron/noteContentRepository.ts:61` / 端口 `saveSyncedNote`；移动 `applySyncedBody` 同口径）允许 **trashed 行**接收正文、保留 trashed、**purged 永拒** ⇒ **用户保存守卫（`assertNodeWritable` 等）不得下沉到同步/镜像路径**（否则新设备首拉/他端编辑整轮失败；F04 同类事故，**task-52/53 已闭合**——守卫分层契约见 AGENTS §3#23）。
  - **单篇 apply 失败降级**：单篇异常记 warning 后 `continue`（桌面 `SyncResult.warnings` / 移动 `warningDetails`），**不再整轮 syncNow 抛错导致设备永久卡死**。
  - **被远端移入回收站 + 本地有未发布编辑 ⇒ 强制留档**（S72，`903a47aa`）：判据 = 位置赢家为**远端 trashed** + 本地相对基线有变化 + 内容赢家为**本地** ⇒ `archive-local` 写历史快照（两份都改时只留一份）；不静默丢弃本地编辑。
  - **位置赢家=远端时不受 `lifecycleRace` 保护**（H73-G1，`4db266e9`）：该保护只覆盖「本地窗口内自己移入/移出」；远端 win 的生命周期类变更必须落地，不得被永久挡住。
  - **目录 purge 意图在设备本地 `intents`**（F-01b，`fa2fbdad`/`dc882945`）：**不新造 wire 墓碑**；回收站副本**永不 upload**、发布排除 remote-purged-trash、`fieldChanged` 不上传已删正文；显式恢复让位（远端 `updatedAt > purgedAt` 时以远端删除为准）。
  - **移动端生命周期/锁（task-55/56，已闭合）**：回收站容器 id 不落 `notes.parent_id`（N1）；`applyRemoteNoteMeta` 对 trashed 行跳过 title/parent（N3）；移动锁未生效（N4/M3）——**均已在 task-55/56 修复**。

- **日记本不可变与两个单篇出口（261112 用户裁决，契约 AGENTS §3#25）**：
  - **固定不可变**：日记本 = 像回收站一样的**特殊笔记本**，**不可取消标记/不可删除/不可改名/不可换图标/不可排序/不作为移动目标**；`space` 只允许 `null → diary` **单调升级**，禁止 `diary → null`（发布/导入/恢复同样拒绝）；底层通用排序/改名/图标 IPC 若可达日记子树必须拒绝。
  - **转为文档 = 同一 note 移动 + 可改名**：把这篇日记**移动到**知识库其他笔记本（正文/历史/回收站/索引跟随，不删除）；共享弹窗只选笔记本、标题默认日期可改、**先 move 再 rename**、失败可见。
  - **转为小记 = 原 Lake 正文 + 媒体复制搬运**：用该日记的**原正文**创建一条小记（**复制**，新 id），图片/附件搬到小记资产作用域（`/<noteId>/` → `/quick-notes/<id>/`；**原资产保留**），随后日记原文**移入回收站**（软删、可恢复、不是 purge）；承载不了的卡片（`droppedKinds`）必须剥掉并**明说**，非 doc 类型（表格/多维表/画板/手写板）整篇拒绝。
  - **回收站「云端已删除（仅本地）」副本必须可只读预览**：整行可点、标题不被徽标挤成 0 宽、缺正文给明确提示（task-89）。
  - **`showNotice` 在全部 7 个空间可见**（`NoticeToast`；桌面状态栏只是宿主之一，task-93）。
  - **已知限制（明确记录）**：同步镜像 apply 仍会应用远端的日记子树 `title`/`icon`（**入口层禁止、非 UI 暴露，不做字段冻结**）。**两个单篇出口两端都有**（261113 移动端补齐「转为小记」，`a57cf3cf`）。
- **InkPad 结构拆分（Q19-10）未做**：仅抽了 `inkPadModel` 纯逻辑 + 11 例行为测试；组合根 + 4 hook + 2 子组件拆分因 127 条文本护栏与 10 useState/45 useCallback 依赖网，留发布后按「先迁护栏 → 再抽 hook → 最后设备门禁」执行。
- **发布链路**：Gitee 单附件 100MB / 仓库 1GB 上限（mac/Windows 包只能走 GitHub）；GitHub 慢速上传依赖 workflow 的 50 分钟步骤超时，不要缩短。
- **历史编号与旧批次已失效**：旧文档/代码注释里的「HANDOFF §3#N / §4 / §7.x」是历史编号，**不对应本文**；更早的 §0 批次条目（如「第十四批」）也已删除，**只在 git 历史可查**。待办只看 §3（本节与 §3 都不编号）。

## 3. 待办（唯一待办清单）

> 规则：只有「真问题 / 不做有代价 / 收益大于复杂度」才进本节（AGENTS §3#17）；完成后**直接删行**，历史留 git。

**261124 批待办**

- **261124 审计残余（报告 `docs/audit-261124/` 已删、逐条证据 git 可查；B2–B9 与 P3 21/22 已随 v1.6.2–v1.6.4 修复，别重开）**：
  - **待复现 2 条**：⑤P3-3「手机快照合成底稿失败 + 快照无 sync-v3 目录时残留旧基线」（= B9-1 同一场景，三重叠加极小概率）；B9-2「Batch4-A 只换两库不换 sync-v3」。B1 的 folder download-to-trash 偏差 = 用户裁决语义（非 bug）。
  - **审计护栏建议清单（40+ 条）未逐条核销**：A/B/C 批修复已各带回归（~25+~22+~20 例）；8 条优先建议（commitFailedUploadKeepsLocalMeta / downloadFailureInPublishedRound / pullRoundKeepsUnsyncedQuick / rollbackKeepsUntouchedQuickDb / dfpRoundTripKeepsOriginalParent / quickSaveKeepsRestorePending / planMixedDriftMetaLock / firstEncounterFolderMapping）均挂在已修的 A1/A2/A4/A5/A6/A7/A8/B1 上、修复批已逐条带回归（测试名未必同名）；其余边缘断言要点在 git 历史各分册「护栏建议」节，补护栏时按需取。

- **mobile-snap 门禁裁决（受阻，先于本批）**：lake_gate(5556) 现为真实个人库（78 文档 / 夹具 0 / 无 `notebook-personal`）⇒ 与已提交基线不可比，`check:mobilesnap` 在 home-doc 态直接报「目录抽屉里没有可点的文档行」。A = 重灌夹具（gate-fixture.mjs，需先适配 `nodeType` 字段与默认笔记本 id 假设）+ 重烤；B = 承认新数据重烤（真实库会进基线）。**未动其数据、未重烤，等裁决。**
- **格式级改动仍在 `dirty` 之外**：切换/离开的保存闸已统一无条件过闸，但**关窗/退出**的 `onDirtyChange(dirty)` 只看文本镜像 ⇒ 只改样式（加粗等）的正文改动直接退出时可能不存；闭掉需退出路径同步 flush + 比对 body（单独小批）。
- **用户报的丢数据找回口径**：小记无历史快照、保存覆盖不留旧版 ⇒ 应用内能查的只有 text_cache（搜索索引最近保存版）与云端镜像（若当时已同步）；现场还在就先按这两条取证。

**261123 二次批待办**

- **设备弹窗截图**（lake_sync）：手动同步弹「首次相遇」询问（data-testid=first-encounter-ask，事实行+五选项）+ 后台自动同步不弹只挂状态；随装包窗口一起做（移动端 UI 已改未装包）。
- **「远端独有小记落小记回收站」物化变体**：state 世界物化下载条目后恢复原定语义（SYNC-PROTOCOL §21.4 已记）。
- paste 遥测小缺口：oversizeTableShape 耗时并入 paste.html 打点；原始剪贴板输入若再现（pbpaste 快照留证）可 100% 定罪粘贴事故输入。
- **45ddf98b 提交内容混装登记**：quick-soft-delete 修复与粘贴专案 chrome.css 选择器修复同提交（lead 收口 `git add -u` 纪律失误；内容无损、语义均已验证，仅记录）。

**261123 六线并发批待办**

- **Windows 真机验收**（顶栏融合）：先确认用户机器 arch（x64/ARM）再出对应安装包；验收 8 步 = 顶栏单层/拖拽双击最大化/按钮不被三键遮/主题跟随/F11 全屏/附件预览关闭可点/快捷键/贴靠（清单在 ae0c0399 交付简报）。
- **真机（小米）点收**（模拟器已验）：卡内打字插表情不吞卡、工具栏 ↶↷ 可见可点、整卡选中插图/插表出提示且卡完好、表格行高重开保持、S3 表单重开水合。
- **移动→移动双 AVD 设备级矩阵格**：管线级已 PASS（重导收敛即其语义核心），设备级待补（磁盘充足可起 lake_sync2）。
- **multi-end「迁入迁出后同步」固化**：按 bootstrapMigration.s3.integration 同款套路补 2 个真桶集成测试（桌面两路迁后同步）。
- **P2-B 大规模缺席保护待用户裁决**：现契约 = 顺序约束（导出端先上云→导入端再同步）；要加保护（首同步大规模缺席时拒绝自动删除待确认）需改同步语义+测试。
- **P3×4 现状钉住**（portable 对抗测试注释内有细节）：counts 不对照 / 条目名 UTF-8 字节数 / mapDesktopTree 去重 / 穿越名静默跳过 warning。it3 抖动观察项（疑测试基建：saveV3State 默认基线路径 + testSetup BodyStore 重置；断言已埋自诊断）。
- **小记「图片」内核内置工具项吞卡边界**（LAKEX-CONTRACT §5.63）：无我方可拦入口，需探索内核配置层；桌面媒体链接 insertGuard 接线 + insertBlockedNotifier 桌面宿主提示接线（通道已留）。
- **guide 同步清单（设置文案批）**：guide/12 备份与恢复、S3 配置页/第三方说明、AI 助手、空间开关、附件上限、更新中心的长说明句已变短——正文逐字引用需换新句（截图按惯例「以界面为准」）。
- settings 待确认 3 条（低风险已删）：思考强度「默认 high」、浏览器端行为差异说明、自动备份 6h 节奏说明；移动 save() 只回写 endpoint/region 两字段的小统一（settings-copy 观察项）。
- **AGENTS §7#19 复核**：lake_sync（emulator-5558）上 `adb shell input tap` 实测可用，与既有记载不符——按实测更新记载（见 AGENTS 该条 261123 注）。

**261122 大统一迁移包批待办**

- **设备/人工点收（装包已完成）**：① 手机「导出便携包到文件」→ 桌面「从便携包导入」走一遍；② 桌面「导出便携包」→ 手机导入走一遍；③ 桌面「从整库备份恢复（完整目录）」点收；④ 导入后配 S3 确认只做增量（基线随包）。
- ~~quick_note_assets 元数据回填~~（review 补强已关闭：反向导入从 .qnote 正文资源清单重建）。
- **登记边界**：移动画板素材在 localStorage，不随手机快照（桌面↔桌面走包/目录可带）。

**261122 批待办**

- **桌面目录「一跳一跳」待复现**：隔离实例量到 0 个 layout-shift、被展开行位置不动；若复现，最可能来源是 `.tree-row { content-visibility: auto }` 的**绘制闪烁**（去掉它 = 牺牲 10k 行的视口外跳过渲染），需要用户慢放录屏或指明笔记本/子文档数量。
- **移动端装包复验（两件事捆一起）**：① 小记预览图片/动图（共享解析器修复）；② 表格行高（`rowData.ia`）+ 行点击语义（文档打开/三角展开）。本机 `adb devices` 为空，需先起 AVD 再 `bash scripts/android-build.sh --sync --install`。
- **剪贴板位图待用户验收**：桌面复制图片 → 粘到 DSH / Codex / 微信三处各一次；若 DSH 仍不认，下一步是给 `text/uri-list`（需要主进程把资产落成临时文件）——先不动。
**261121 批待办**

**261121 批待办（第二批）**

- **移动端表格渲染待装包验**：本批用 `rowData[*].ia = 1` + `tb=WRAP` 兜「换行文字被 24px 行高裁掉」；本机没有在跑的 AVD（`adb devices` 为空）⇒ 未装包。下次移动端交付前 `bash scripts/android-build.sh --sync --install`，打开那张 Redis 表格看行高是否随内容长高。
- **桌面小记预览折叠观感待点收**：经典路径现在折叠 = `max-height: 220px` + 渐变遮罩 + 「展开/收起」；若 220 偏矮/偏高改 `QuickNotePreview.tsx` 的 `COLLAPSED_MAX_PX`（单一来源，移动端 slot 也用它）。
- **动图粘贴的写入端未定位**：用户确认超长链接来自「不同录屏软件的动图粘贴」。读取端已容错（`restoreEscapedCards`）；要堵写入端需要一份当时的正文（`.qnote.body`）或剪贴板 HTML。
- **移动端装包点收**：`MobileUsheetViewer` 与桌面同走 `normalizeUsheetWorkbook`（默认居中/自动换行/自动行高应同效），但本批未 `--sync --install` 设备验；动过 `src/core/usheetDoc.ts` ⇒ 下次移动端交付前先装包看一眼表格。
- **小记图片缩放「停顿约 5s 才生效」待复现（261121 用户报）**：本批已修「预览比例盒按原图尺寸 ⇒ 缩放后留大空白」（改用卡片显示尺寸）；但“拖动缩小后要等 ~5s”未复现（仓库内唯一 5000ms = 删除撤销窗口）。下次跟进要问清：编辑态拖动 vs 卡片预览、是否只在 GIF/大图、是否与保存/列表刷新时机重合；怀疑点是列表详情缓存 + 预览预热（`quickNoteDetailPrewarm`）只在刷新时更新。
- **真机从语雀网页复制**：本批验证用的是我们自己的**文档表格卡**（与语雀云端表格同源内核/同形 HTML）；语雀网页版实测未做 —— 若用户现场仍是一格，按 `usheetClipboardTable.ts` 头注释补该来源的样本。
**261120 批待办**

- **mobile entry 现余 2,665B（43,335/46,000）**：v1.5.4 又加了「已收起」与书架卡改版（+732B）；下一笔移动端入口增量前仍先看能否走懒加载（候选：第二个 tanstack 使用点、settings 抽屉里的静态重依赖、crashLog 仍被 MobileErrorBoundary 静态引用）。
- **移动端文档引用：真机（小米）未验**；另注意注册表是 `lazy` 组件，页面刚启动的极短窗口内若立刻插入文档引用会回落桌面浮层（理论窗口 < 一个 chunk 加载，实际未复现；要消掉就把 Sheet 改成静态 import，代价是 entry 预算）。
- **文档引用 Sheet 的设备观感待用户点收**（标题/搜索/行高/拖动调高）；`mobilesnap` 基线未因本批重烤（本批未改既有屏几何，新增的是新弹层）。
- **桌面右键菜单顶层新增两项**：其他入口（顶栏菜单/头部＋）未同步，若用户要求「所有入口一致」再评估（当前只按点单改目录右键）。

**261119 批待办**

- **快捷菜单剩余点收（261119 深链两路径已在模拟器实测通过）**：已验 = camera 深链直出相机（焦点 `com.android.camera2/CaptureActivity`）+ 取消留卡不再弹；clipboard 深链预填（可信按键造剪贴板 → 清空卡 → 触发深链文本完整回归）+ 空剪贴板不预填分支。待用户点收 = **长按桌面图标三项并列**（launcher UI 无法自动化）与真机（小米）链路。
- **cardMenu.tsx 收尾清理（261119 登记）**：CardMenuItem 的 focusable/ariaPressed 已无调用方（上轮为视频弹窗加的）、头注释仍提「与视频宽度弹层共用」——下批清掉。
- **表格色板案 2（261119 登记）**：core/colorPalette 单一来源 + ComponentManager 重注册 COLOR_PICKER_COMPONENT（须等选项 20 色定稿后落值、过 univerContract + usheet-kernel-probes、禁新增 patch）。
- **休眠色板登记（审计 §2.M）**：SheetMenuBody 圆点色板（无构建方）与「工作表标签更改颜色」（未实现）——动它们前先过配色审计口径。
- **inkPerf.test 墙钟断言满载 flaky（261119）**：35ms 预算满载跑出 40ms、单跑 3/3 过——与 perf.integration 同类口径（低负载为准）。
- **QuickNotePreview slot 代码出桌面图（261119 登记瘦身方向）**：组件拆分使 slotFrame/展开过渡不进桌面首屏（check-arch.mjs 注释同步登记）。
- **QuickNoteComposer 草稿防抖边缘（261119 观察）**：内核就绪前 300ms 到点会写 body:""、下次恢复丢富格式（只影响「打完字立刻杀进程」）。
- **速记失败提示文案双写（261119 登记）**：「速记内容准备失败」在 MobileApp catch 与 captureModeFlow 字节失败两处各一份（懒分包边界不共享常量）；要单一来源挪 toastBus。
- **nodeIcon 小清理（261119 登记）**：`.node-icon-picker__type-action` 与 kit `.ln-tabs__action` 重复（可再降 1）；页签选中态 text-1+600 是「原样式」本体，若要与 kit 墨线统一可一行切。
- **unicodeEmoji 数据注入面（261119 登记备用）**：内核 option `unicodeEmoji:{emojiGroups,emojiMap}`（未文档化，LAKEX-CONTRACT §5.60）——未来若要把目录面板的 emojiSearch 中文别名接进内核面板可走该面，当前补丁已够用不接。
- **batchNotes 软删列口径不一（261119 登记）**：`bridge/batchNotes.ts:81` 用 `deleted_at` 判 trashed，写路径（trashSubtree/trashRepository）标 `trashed_at`——回收站/批处理修面跟进。
- **TAP_REVIEWED 20+ 同型小目标（261119 登记）**：mb-segment__item(36)/med-f-btn(40)/mbt-cell-btn(24) 等（清单在 tapAreaContract TAP_REVIEWED）——多数一行 ::after 收口，下批一次清或 smallTap 走查定级；kit 自绘 checkbox/radio 15px 命中区未扩同登记。
- **按钮边界 B-4/B-10/B-12/13（261119 登记）**：固定 50dvh、键盘盖 foot、编辑 dock/让位账底安全区——前两者是定稿/契约不动，B-12/13 在 bottomChromeContract 允许清单待设备实测定级。
- **录屏取证教训（261119）**：H.264 GOP 关键帧再量化会产生「周期性全帧微差」伪影（本批曾误读为 0.8s 重绘环）——录屏分析先排关键帧伪影，静止段逐位比对 + 变化像素定位到盒级才算数。
- **发版前设备快照矩阵未跑（261119）**：mobilesnap 基线因色板/卡片几何变化待重烤（已在上方登记）；本次发版门禁 = 静态全量 + packaged smoke（CI 内联）+ 用户真机点收。
- **标签长按菜单设备点收**（261119）：装包已装；契约面无标签 API 无法自动种夹具，需用户上手长按验证。
- **视频宽度弹窗桌面实机目视**（261119）：机制与其它卡工具条菜单同款，低风险。
- **真机（小米）拍照复核**（261119）：模拟器已验直出相机；MIUI OEM 行为按 task-2 报告步骤（取消/EXTRA_OUTPUT 兜底）。
- **guide 3 张截图重拍**（261119）：android-home-quicknotes / android-home-library / android-settings-editor 仍是旧界面（文字已加「以界面为准」兜底）。
- **标签详情小记卡两态切换**（F-H 同型，261119 登记）：纯文本占位 → 富预览仍两态；quickNotes 侧已用 slotFrame 收口，标签卡未接。
- **预览层退场过渡**（261119 登记）：需 MobileApp/SettingsDrawer 挂载点配合；按「返回可直切」先例可接受。
- **useKeyboard.measure 与 softKeyboardVisible 判据收口**（261119 登记）：同一键盘可见性判据两处实现，建议 measure 委托收口单一来源。

**当前批次（261114 收口：设备 / 10k+100k 大库 / 2GB 便携包 / S3 多端回归）待办**

- **发版 v1.1.4 已完成**（tag/commit/workflow/资产见 §1「发布与推送事实」）；剩余只需等 Publish job 的 Gitee 镜像收尾并核对（GitHub Release 已发布）。
- **真机 2GB 便携包端到端导入未执行**：本批已验证导出/结构/Android 上限兼容（MAX_ENTRIES 250k，110,005 条 pass），但系统文件选择器无法在 CDP 自动化；需人工在设备走「设置→备份与恢复→便携包导入」，并确认 staging+payload 磁盘（约 4GiB 可用）。
- **S3 真实桶多端回归已完成**（261114，PASS）：真实七牛桶 `local-lake-hebei` 对象根前缀 `lakex-notes-dev3` 下 A,B 21/21、A–F/I/J 94/94、K（3 实例）14/14 全 PASS，residual=0、收尾 0 对象；命令与结果见 `scripts/multi-end-sync/README.md`。**移动端/真机仍不在本入口**（`--with-mobile` 明确未实现），移动端多端仍按 `scripts/multi-end-sync/README.md` 的移动端手工方法（A–K）执行（原 21 号报告，已删 git 可查）。
- **大库观察项**：桌面目录树 10k 行未虚拟化（约 20.1 万 DOM、renderer heap 313–317MB）本次仍可用，但继续增长需虚拟化/分页；热轮搜索曾出现 1.9s（冷轮 445ms），重跑确认是否抖动。
- **移动端↔桌面真实 S3 冒烟已完成（261114 手工）**：见 §0 收口验收；`--with-mobile` 仍未实现，后续可把该手工流程固化进 `regression.mjs`（需要 Android 驱动/配置注入）。
- **现代 Web 写法审计（261115 · v2 全量）**：见 [MODERN-WEB-AUDIT](MODERN-WEB-AUDIT.md)。语料 = GoogleChrome modern-web-guidance **252 篇**（克隆 `5e5cd33`）；判定 **命中 13 / 部分 68 / 干净 1 / 待验证 32 / 不适用 138**；工具 108 条（发布版 35）+ 手工 30 条问题清单（A01–A30）。实测运行时 = Electron 44.9.3 / **Chromium 152.0.7977.167**（`process.versions`）。v2 新发现：`NativeTitleTips` 拦截器三缺口、`content-visibility` 已用于目录树/大纲（10k 树的问题在 DOM 不在 CSS）、`boot.html` **476KB** 内联 APNG、无 `meta color-scheme` 导致首帧闪浅色、`scheduler.yield`/`useDeferredValue` 全缺。**已开工**：分支 `modernize/web-platform-261115`（master 已备份 + `backup/master-261115`）；A01/A03(步1)/A04/A07–A09(inert)/A12/A14/A15/A16/A18/A19/A21(部分)/A24/A25–A27/A29 已修，其余推迟项与依赖顺序见审计 **§11**（未合 master）。

**上一批次（261113 转小记 + 发版复核批）待办**

- **本批代码待办已清零**（task-105/106 已闭合：发版复核 P2/P3 + 移动端「转为小记」）；剩余只有设备点收与下一版发布（P0）。
- **S19（目录重建）：不计划**（显式 id 重建不是用户流程；矩阵登记即可）。
- 其余真剩余见下方 P0/P1/P2（设备点收 / 发版 / 已知欠账）。
- **接手清单（261113 会话收尾，给下一会话）**：当前 master `2c997420`（已双推）、v1.1.1 已发布、任务板 0 未完成；下列事项按「需裁决 / 设备 / 代码欠账 / 外部 WIP」分组，开工前先读本文件 §0–§2 与对应报告。
  - **① 用户裁决（261113 10:20，已定，别再问）**：(a) **下一版发版暂不做**——保持 1.1.1；要发时流程 = RELEASE-NOTES 补段 → `npm version …--no-git-tag-version` → 提交 → 注解 tag → 双推 tag（只有 tag 触发 CI；发前按 `docs/RELEASE.md` §七.4 核 Android 4 个 secrets + `GITEE_TOKEN`）。(b) **首篇编辑器 fallback 不做**（不拆内核 chunk、不改「启动自动打开」语义）。(c) **观感点收由用户自己验**（Q03 历史 Sheet / Q07 preview 档 / Q05 字号 / 桌面双击放大 / 平板「点空白落光标」）。(d) **移动顶栏 44→52 不做**。
  - **② 设备类欠账（需真机/构建）**：便携包 2GB 真机端到端导入（导出/格式/Android 兼容已 PASS）；更新中心设备验收（Android 下载→校验→系统安装器）；桌面 3 项实机 + 平板复验；导入/导出/键盘真机冒烟；依赖补丁 4 处升级复核；23 屏走查（本轮未跑，命令见 `24-release-review-ui.md`/`27-release-mobile-snap.md`，audit-261112 分册已删 git 可查）。
  - **③ 代码级欠账（可排期）**：复制多张大图同步阻塞（剪贴板 API 限制）；10k 文档/100k 附件桌面验收已 PASS（scripts/scale-acceptance），大库规模与真实 Android 物理机验收仍从未做过；缺正文/缺小记三条恢复路径仅单测 mock；移动端表格块级命令入口未接。**S3 流程审查剩余（低优）**：~~#10/#11/#12~~ 已修（261113 第二批）。~~#8 孤儿父各端各建随机「未分类」~~ **已修**：兜底新建改用固定 id `notebook-uncategorized`（单一来源，跨端同一本）；**认 id 不认名字** —— 用户自建的同名「未分类」一律不动，旧随机 id 不迁移（多一本同名无害）。复核报告保留不修：P3-4/5（**P3-6 已于 261113 修复并三态复验**）、F-10/11/14/16/17（理由见 `23/24-release-review-*.md`，已删 git 可查）。
  - **④ 外部并行 WIP（先确认归属，勿盲提交）**：工作树可能有其它会话的 `src/mobile/settings/**`、`scripts/mobile-audit/mobile-snap.mjs` 等未提交改动（261113 为移动设置页顺序对齐），与 §3 本批无关；提交前 `git status` 核对并只 add 自己路径。
  - **⑤ 参考**：发版复核 23/24/25/26/27 号分册（audit-261112，已删 git 可查；26 的 NO-GO 唯一阻塞=版本未 bump，已解决）；真实桶与多端 19/21 号（已删 git 可查；21 手工方法已搬 `scripts/multi-end-sync/README.md`）；日记语义 `AGENTS §3#25` + `docs/DIARY.md`。

**P0（不做就卡住主线）**

- **R1/R2 设备点收（门禁矩阵已全过，观感项待人工）**：已过 = Q04 / Q22、手机/平板 10 态 + 多维表 3 态 + 23 屏 + 窗口矩阵 + **桌面 42 态**（两轮 0 差异）；待人工 = Q03 历史 Sheet、Q07 preview 档、Q05 字号、桌面双击放大观感；真机 50950385 已装最新 APK。
- **下一版发布（v1.1.1 已发，下一版待定）**（流程 [docs/RELEASE.md](RELEASE.md)）：发布说明写清 ① inkDoc v4 旧端只读 / 手机需重装；② 标签顺序仅设备本地；③ 标签删除 = 缺席（两端都要升级）；④ 发版前全量矩阵；⑤ 发版前按 RELEASE.md §七.4 核对 Secrets（Android 4 个 + `GITEE_TOKEN`）。
- **每批收尾固定动作**：更新 §1 基线与门禁计数 + §3 + §0 批次抬头；提交后立刻回写。

**P1（该做但可排期）**

- ~~**移动小记画廊混入视频/音频**~~（已修，task-32：`previewAssets` 只筛 image mime；设备验证已随 10 态矩阵）。
- **图片缩略残余（261111 收口后）**：~~① canvas 回退可能写显示尺寸~~（已修 `866babd1`：复制图片写原图尺寸/不可知则省略）；② 复制多张大图时同步阻塞（剪贴板 API 限制，属性能专项）；③ 会话内放行依赖「待上传卡计数 = 1」，多图并发时当会话不缩（重开按正文 origin 缩，安全降级）；④ 桌面文档编辑器（Retina 优先）与平板未启用同类缩略（平板实际已启用，见复核报告）。
- **移动性能基线**：lake_gate 录制 + `--compare` 已通过（冷启 1586 / capture 893 / 写作卡热开 332 / 文档打开 4ms）；⚠️ **键盘两项该 AVD 采不到**，键盘长任务口径仍以 5554 历史记录为准（775→72ms）；换 AVD / 换包 / 改视口必须 `--record` 重烤。
- ~~**小记快路径 push-state 优化**~~（已修，task-83：移动端整行 `sync_v3_state` 3 读→1 读）。~~**push-baseline 548–795ms**~~ **已修（261113）**：A 重复点不重写基线 + 归位单查询 + 复用已读信封；C 方案把 baseline 搬出整行改落 `sync-v3/baseline.json.gz.b64`（5000 文档行 1.11MB→247B，文件 426KB，过桥约 -82%），预计 150–250ms（设备实测待补）。
- ~~**首篇编辑器 fallback 的最终解法（需用户裁决）**~~ **已裁决（261114）**：采用 ②「恢复标签为空时不自动开、保持空态」——已删 `core/coldStartNote` 冷启动落点，见 §0 本批。
- **设备类欠账**：便携包真实 3GB 数据验证；更新中心设备验收（Android 下载→校验→系统安装器）；桌面 3 项实机复核 + 平板复验；导入/导出/键盘真机冒烟；依赖补丁 4 处升级复核。

**P2（体验缺口 / 长期）**

- **docs 侧硬编码机器路径（R2 task-35 已清零）**：脚本侧 R0 清零；AGENTS / DEVELOPMENT / CODEX-GUIDE / MOBILE-OPS / 契约文档 / audit 存档里的本机绝对路径统一改成 `<repo>` 或 `$(git rev-parse --show-toplevel)`（示例统一写 `/Users/<you>/...`）；本机绝对路径已 0 命中（仅测试夹具里保留通用示例 `/Users/x`）。
- 大库与**真实 Android 物理机验收从未做过**；~~移动云清理无 UI 入口~~（入口早已有，261113 补预览/dryRun，D3）· ~~目录恢复后 `deleted_notes` 残留~~（261113 修，D4 墓碑退役）；缺正文/缺小记三条恢复路径只有单测 mock。
- 移动端文本格式未接入口（unlink / replace / style→code·quote / 表格块级命令族）；顶栏 44→52 需另开需求；平板「点空白落光标」待用户裁决。
- 移动端首轮元数据再发布（初始发布后第一轮整轮同步会因既有 tag 版本元数据做一次「只含元数据」的再发布；与快路径无关）。

**已闭合（别重复做；细节见 git）**

- **261113 批**：移动端「转为小记」（task-106，`a57cf3cf`）· 发版复核 P2/P3（task-105，`839c7a93`）· v1.1.1 发布（8 个 Release 资产 + 本地 packaged smoke）· 文档收口（AGENTS/DIARY/guide16/README/MOBILE-OPS）。
- **261112 日记收口批**：日记本固定不可变 + 取消标记已移除（task-84/85/87/88）· 移动目标剔除日记子树（task-90）· 转文档共享弹窗（task-91）· 转小记媒体搬运（task-92）· 回收站仅本地副本预览加固（task-89）· showNotice 全空间可见（task-93）· S3 多端 A–K 与 R-D（task-72/74）· 移动同步 warning 持久化 + apply_skipped 对齐代码（task-67）。
- 空间命名两端「知识库」；桌面按钮梯队 + 移动 `mb-btn`；AGENTS 预算（≤64KB 内）；首屏瘦身（entry 60KB / preload 6）；小记写作卡全屏 + 键盘长任务 775→72ms；单条小记推 13→11；手机/平板各 10 态快照 + 23 屏 + `edit-surface-invariants` 重标定 + capture 入口装置；图片缩略三边界 + 小记封面/预览去重；桌面/移动图片预览语义（双击 vs 单击预览双击编辑）。
