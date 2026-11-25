# 05 · 文档 / 使用说明 / 仓库清理审计（第 5 流，只读）

> 审计日：261125。范围 = guide/（19 章用户手册）+ README / README.en + 对外材料 + 仓库清理（过期文档 / 垃圾 / 死链 / 构建残留）+ 「不为历史数据写兼容」原则的文档面审查。
> **只读审计**：本报告是本流唯一写入的文件；未改任何代码/文档。所有 file:line 均为本次实际读取核实；无法实机核对的界面事实标注「未核实」。
> 内核（vendor/）不在本流范围（AGENTS §3#18 禁清理）；父目录 local-lake/ 的兄弟目录（lake-main/、siyuan-* 等）只登记不动。

## 1. 概览

**方法**：通读 AGENTS.md、docs/HANDOFF.md §1/§2/§3、README×2、guide 全部 19 章 + guide/README、docs/PORTABLE-TRANSFER.md / ARCHITECTURE / SYNC-PROTOCOL / mobile/UNINSTALL-DATA 等域内规格；对清理候选逐一做全仓引用 grep（git grep，排除 vendor/dist）；全仓 Markdown 相对链接全量校验（13 处失效全部定位）；guide 截图逐张核引用 + md5 查重；`git worktree list` / .gitignore / git ls-files 核仓库垃圾归属；compat 线索按 §3#7 判据逐条读源码定性。

**总体评价**：**手册底子好、增量欠账明确**——guide 19 章结构完整、口径与 v1.5.x~v1.6.x 主线大体一致（多端同步判断题、便携包、日记两出口等关键语义都写对了），核心文档 **0 死链**（13 处失效全在待删审计件内）；问题集中在三处：①261122~261205 三批界面/口径变化（设置文案精简、便携包入口迁移、密钥去 Keystore、标签待同步）未回灌手册与 README；②仓库里躺着一批**已完结合案**的审计/计划文档（约 8.3MB 文档 + 1.5G 旧 worktree + 700MB 级本机构建残留），引用网已摸清、可按序消引用后删；③「使用技巧」这类用户价值文档完全空白——正是开源获客最该有的一章。历史兼容面整体干净（§3#7 红线多处已按「拒绝迁移」执行），仅 2 处真·历史兼容可删、1 处文档口径与裁决冲突。按 §3#17 三问自查后，全部方案都有真实证据与不做代价，无迎合项。

## 2. 方案清单

### 2.1 使用说明 / 对外材料（G-xx）

---

**G-01（P1，共享）guide/12 设置逐条与新设置文案脱节 + 备份与恢复表残留旧分组**

- 问题与证据：
  - docs/HANDOFF.md:963 已登记欠账：「guide/12 备份与恢复、S3 配置页/第三方说明、AI 助手、空间开关、附件上限、更新中心的长说明句已变短——正文逐字引用需换新句」（起因 = c62e11b5 设置文案精简，HANDOFF.md:66「15 文件约 70 处」）。
  - guide/12-settings.md:67 仍保留「迁移包（便携包）」一行，与 :66「迁入迁出（便携包）」**内容重复**；而桌面设置当前只有 备份 / 恢复 / 迁入迁出（便携包） 三个分组（src/components/app/settings/sections/BackupSection.tsx:13/:73/:85，无「迁移包」分组）。
- 具体方案：guide/12-settings.md 删 :67 行、并入 :66；对照 c62e11b5 之后的现行文案逐句校对「备份与恢复 / 云端与同步 / AI 助手 / 空间开关 / 附件上限 / 更新中心」六块的引用句（只改引用失真处，不把已精简的长句抄回来）。落点仅 guide/12-settings.md。
- 代价与风险：约 1~2 小时人工比对；无行为风险。
- 涉及端：共享（文档）。

---

**G-02（P1，共享）guide/18 便携包出入口路径已过期（两处入口都变了）**

- 问题与证据：
  - guide/18-portable-and-migrate.md:22 写「桌面：设置 → 备份与恢复 →『**迁移包（便携包）**』→『导出便携包（全量迁移包）』」——现行分组名是「迁入迁出（便携包）」（BackupSection.tsx:85）。
  - guide/18-portable-and-migrate.md:23 写「手机：设置 → **关于 → 卸载与换机** →『导出便携包到文件』」——261122 设置重构已把导出块迁到「备份与恢复 → 迁入迁出」（src/mobile/settings/BasicSettingsSections.tsx:81-89 原处只留跳转按钮「去『迁入迁出』导出便携包」；PortableExportBlock.tsx:2「261122 大统一后收进『备份与恢复 → 迁入迁出』」）。
  - 连带：guide/12-settings.md:140 Android「备份与恢复」行漏列「导出便携包（迁出）」（现行有此功能，PortableExportBlock.tsx:30-38）。
- 具体方案：guide/18:22-23 按 BackupSection.tsx / PortableExportBlock.tsx 实际路径改写；guide/12:140 补「迁入迁出（导出 / 从便携包导入）」。可与 G-01 同批做。
- 代价与风险：几分钟；用户按手册找不着入口是真实流失点（不做代价 = 新用户第一次换机就卡住）。
- 涉及端：共享（文档）。

---

**G-03（P1，共享）密钥口径全面过期：还写着「Android Keystore / 系统安全存储 / enc:v1 惰性迁移」**

- 问题与证据（261204 用户裁决「密钥一律自管理、不进系统钥匙串/Keystore」，AGENTS.md:146；实现 = android/app/src/main/java/com/lakexlocalnotes/android/SecureStorePlugin.kt:8-20「不再使用 Android Keystore / 系统钥匙串」、electron/secretCipher.ts:92「safeStorage/系统钥匙串已全退役（261204）」）：
  - README.md:243「S3 凭证……桌面 AES-256-GCM 本机加密 + 本地钥匙文件 / **Android Keystore**」——后半句已不成立（移动 = SecretBox 私有密钥文件 + AES-GCM 密文落私有 SharedPreferences）。
  - README.en.md:245 同句英文版。
  - guide/11-cloud-sync.md:37「手机上密钥走**系统安全存储**」；guide/10-ai.md:32「只保存在本机安全存储」（泛称可留，建议统一为「应用私有加密存储」）。
  - docs/ARCHITECTURE.md:76「**旧 safeStorage 密文（enc:v1）读路径兼容、惰性迁移 enc:v2**；移动端走 **Android Keystore**」——两句都与 261204 裁决相反（现行 = enc:v1 按未配置读出、不写迁移代码，electron/secretCipher.ts:13）。
  - docs/DEVELOPMENT.md:90 测试说明「验证落盘内容（如 S3 密钥是否 enc:v1:）」——现行落盘是 enc:v2:（secretCipher.ts:8）。
- 具体方案：六处一次性按 AGENTS.md:146 口径改写（README×2 一句、guide/11:37 一句、guide/10:32 措辞、ARCHITECTURE.md:76 整句重写、DEVELOPMENT.md:90 示例改 enc:v2）；在 ARCHITECTURE.md:76 写明「enc:v1 存量按未配置读出（重填即转 v2）」，消除 §3#7 文档冲突（见 §4 #12）。
- 代价与风险：半小时；错误口径让用户误以为有 Keystore 级保护（安全预期错位，属实打实的文档缺陷）。
- 涉及端：共享（文档）。

---

**G-04（P2，共享）guide/06 缺「画板自定义素材库」能力（README 已宣称）**

- 问题与证据：README.md:48「画板（Drawnix，支持**自定义素材库**——数据目录 materials/ 文件夹自行放置）」；guide/06-board-ink.md 全文（57 行）grep「素材」0 命中。该功能是 261114 用户点单（AGENTS §3「画板自定义素材 = 桌面数据目录 materials/ 文件夹」：面板可「打开素材文件夹」、每素材一个 .board.json 画板文档、保存/删除即写/删文件、**设备本地不进 S3**、移动端暂用 localStorage 兜底且无「打开文件夹」语义）。
- 具体方案：guide/06「画板」小节补 5~8 行：素材面板在哪、怎么放文件、插入画板保存后图片才进该画板资产、设备本地不同步、移动端边界。落点 guide/06-board-ink.md。
- 代价与风险：小；不写 = 用户永远发现不了这功能（README 宣称但手册没有步骤）。
- 涉及端：共享（文档；桌面为主）。

---

**G-05（P2，共享）guide 缺「同步记录账本」用户面说明**

- 问题与证据：README「当前能力」有「同步记录：最近『被覆盖 / 他端删除 / 保存时磁盘被改』账本（角标 + 列表 + **一键恢复本地版**）」；guide 全书 grep「同步记录/账本」只命中「同步意图账本（不随包）」（guide/18:28），没有讲功能本身。机制（AGENTS §4）：设备本地审计、不进 S3、500 条/90 天轮转、恢复 = 历史快照 → 标 local-wins 重传、后台同步不弹窗只给角标。
- 具体方案：guide/11「出问题时」或 guide/09 补一小节「同步记录（冲突账本）」：什么时候出现、在哪看（桌面同步状态 / 手机设置→云端与同步）、一键恢复本地版怎么用、为什么不弹窗。落点 guide/11-cloud-sync.md（或 09）。
- 代价与风险：小；不写 = 「被覆盖」是用户最慌的场景之一却没有手册指引（guide/11 只讲「留历史快照」，没讲账本入口）。
- 涉及端：共享（文档）。

---

**G-06（P2，共享）v1.6.4 新行为未进手册（标签待同步计数、同步气泡、新建文档直进编辑）**

- 问题与证据：
  - 标签接入云按钮与同步展示（261205 批，HANDOFF.md:12）：本地标签增删改/合并 → 云按钮显示「待同步」、成功清零（electron/quickNoteTagService.ts:39「261204：本地标签变动 → 云按钮『待同步』」、electron/quickNoteTagsStore.ts:38-39 TAGS_PENDING_KEY）。guide/08/11 未提。
  - 同步气泡（261205）：点云图标即弹进度气泡；guide/11:53 只写「顶部同步状态可查看同步进度」。
  - 移动端「新建文档直进编辑」（261205，HANDOFF.md:12「kind 触点钉 7→8」）：guide/03:66「点顶栏铅笔进入编辑」对旧文档仍对，但新建路径已变，未提。
- 具体方案：guide/08「规则与注意」补一句标签变动会显示「待同步」；guide/11 补一句气泡；guide/02 或 03 加一行「新建的文档直接进入编辑态（261205 起）」。1 行级改动，落点 guide/08、guide/11、guide/02。
- 代价与风险：极小；注意别把 UI 细节写死（沿用「界面为准」口径）。
- 涉及端：共享（文档，移动端为主）。

---

**G-07（P2，共享）「卸载会删数据」与 hasFragileUserData 矛盾（README 对、guide 错）**

- 问题与证据：guide/README.md「数据在哪里」与 guide/14-faq.md 均写「Android……**卸载应用会连同数据一起删除**」；而应用已声明 android:hasFragileUserData="true"（android/app/src/main/AndroidManifest.xml:5/:14），**Android 10+ 从系统卸载对话框卸载时可勾「保留应用数据」**（docs/mobile/UNINSTALL-DATA.md:5-20；README「换机三条路」也写了）。两处口径冲突。
- 具体方案：guide/README 与 guide/14 改为：「卸载默认删除；Android 10+ 系统卸载对话框可勾『保留应用数据』（同签名同来源重装数据还在；桌面拖走图标 / adb 卸载不弹此选项）——不勾或 Android 9 及以下则全删，重要数据请先导出便携包」。依据 = docs/mobile/UNINSTALL-DATA.md §0（唯一来源）。
- 代价与风险：小；不改 = 用户对「卸载前要不要备份」判断错误。
- 涉及端：移动端（文档）。

---

**G-08（P1，共享）新增「使用技巧」章（承载 TIP-01~TIP-11）+ 章数口径同步**

- 问题与证据：guide 现为 19 章（guide/README.md 目录表），无任何「技巧/省流/省钱」向内容（本流 TIP 全部需要新载体）；章数「19 章」被 4 处写死：README.md 徽章「guide 手册-19 章 · 19 chapters」、README.en.md:15 同、CONTRIBUTING.md:13「19 章中文手册」、docs/HANDOFF.md:891「（19 章）」。
- 具体方案：新建 guide/20-tips.md（标题「使用技巧」，收 TIP-01~TIP-11，每条 = 标题 / 一句话价值 / 步骤要点 / 指向章节）；guide/README.md 目录表加行并挂到「想马上做的事」；四处「19 章」改「20 章」。**先定稿 TIP 清单（用户逐条裁决）再落章**。
- 代价与风险：新增一章手写成本（约 150 行）；章数口径漏改会不一致（改时 grep「19 章」全量，共 4 处）。收益明确：用户重点（第 7/8 点），也是开源页最缺的「为什么用它」素材。
- 涉及端：共享（文档）。

---

**G-09（P3，共享）截图欠账登记与补齐口径**

- 问题与证据：HANDOFF.md:1015「guide 3 张截图重拍（261119）：android-home-quicknotes / android-home-library / android-settings-editor 仍是旧界面（文字已加『以界面为准』兜底）」；实际兜底只在 guide/01:51 与 guide/07:68，guide/12 末尾 android-settings-editor.png 无行内注。guide/assets/screenshots 31 张**全部被引用**（逐张核过，无冗余截图）、无 md5 重复（唯一重复图在 docs/mockups，见 X-06）。
- 具体方案：装新包后重拍 3 张；重拍前给 guide/12 末尾那张补同一句「界面以你安装的版本为准」。
- 代价与风险：依赖设备/装包窗口（HANDOFF §3 有装包待办可搭车）。
- 涉及端：移动端（文档）。

---

**G-10（P2，共享）README 对外材料补缺（开源视角，不编造）**

- 问题与证据：README.md 无面向**最终用户**的「下载与安装」一节（现在直接进「项目简介→能力→技术栈」，普通用户要自己找 Releases）；文档表只列 4 个入口，CONTRIBUTING.md / SECURITY.md / docs/PRODUCT.md 已存在但 README 不链；无系统要求下限（Android minSdk 24 已由 v1.5.3 产物复验证实，HANDOFF v1.5.3 段「minSdk 24」）；README 零截图（guide/README.md:3 的 desktop-overview.png 可复用）。
- 具体方案：README.md 顶部加「下载与安装」小节（Releases 链接、.dmg 首次右键打开 / .apk、Android 7.0+（minSdk 24）、macOS 未签名提示——全部已有事实）；文档表补 CONTRIBUTING / SECURITY / PRODUCT 链接；复用 1 张截图；README.en.md 同步。**不写 testimonials/定价/路线图承诺**（PRODUCT.md 禁编造红线）。⚠️ macOS 最低系统版本未核实（electron-builder target 未读）——先核再写或不写。
- 代价与风险：小。
- 涉及端：共享（文档）。

---

**G-11（P3，共享）guide/12 设置菜单清单未逐一核实，实施时对齐 settingsSearch**

- 问题与证据：guide/12:5-6 逐项列了桌面/Android 设置根菜单顺序；本流只实证了「备份与恢复」分组（BackupSection.tsx）与移动端备份块，其余分组顺序**未核实**。设置是重构高频区（261122/261123/261205 都动过）。
- 具体方案：实施 G-01/G-02 时顺手把 guide/12:5-6 与 src/components/model/settingsSearch.ts（SETTING_ITEMS 分类）对一遍，对不齐按现状改。单列只为不漏。
- 涉及端：共享（文档）。

### 2.2 使用技巧（TIP-xx，落点统一 = 新章 guide/20-tips.md，另注互链位置）

---

**TIP-01（核心）便携包替代/减少 S3 首轮全量——省 S3 流量费**
- 价值：换机/新设备首同步要传拉全库（按 GB 计费的桶上是真金白银）；便携包走本地文件，**之后配 S3 只做增量**。
- 步骤：老设备确认已同步 →「备份与恢复 → 迁入迁出 → 导出便携包」得 .zip.lln（≤4GiB）→ 传到新设备「从便携包导入（覆盖本机）」→ 用迁移码搬 S3 配置（TIP-03）→ 打开云同步只见增量。**包内带同步基线**；已开云同步时导出会先自动同步一次（失败不出包）。
- 依据：docs/PORTABLE-TRANSFER.md §0/§3.1（零基线合成合并底稿、配好即增量）+ guide/18。互链：guide/11「按需下载附件」是第二条省流路径。

**TIP-02 三种备份/迁移怎么选：省钱省时决策表**
- 价值：选错路白折腾（guide/18 原话）；一张表讲清「便携包 / 整库备份目录 / 数据库快照 / S3」各搬什么、花多少。
- 步骤：跨端省流量 → 便携包；同端大库/要历史 → 整库备份目录（无 4GiB 限、含历史快照）；只防坏库 → 自动备份（仅数据库，每天一份）；已有桶增量 → S3。**便携包不含历史快照与 AI 会话**。
- 依据：guide/18「几条路怎么选」表 + docs/PORTABLE-TRANSFER.md §0 决策记录。

**TIP-03 S3 配置迁移码：免手填、别外传**
- 价值：五段配置（Endpoint/Region/Bucket/前缀/密钥）手机手填易错，迁移码/配置文件一键搬。
- 步骤：桌面「云端与同步 → 配置迁移 → 导出到文件…」→ 发到手机「从文件导入」或粘贴 LLN1. 开头迁移码 → 导入**覆盖**本机 S3 配置。**只防误读不是安全边界（固定种子）**，别贴聊天工具。
- 依据：guide/11 配置迁移 + docs/PORTABLE-TRANSFER.md §6。

**TIP-04 关闭云同步 = 零出网的隐私姿势**
- 价值：想要「纯本地、一个字节都不出网」不用断网——关掉「启用云同步」即任何路径不出网（AI 助手另有独立开关）。
- 步骤：设置 → 云端与同步 → 关「启用云同步」→ 界面回「仅本地」；S3 配置与本地数据都保留，随时重开继续增量。注意：没通过「测试连接」本来也开不了（先测试后开启的闸门）。
- 依据：guide/11 关闭云同步节 + README「关闭云同步 = 完全没配置」。

**TIP-05 AI 隐私：会话不进同步、不随包、Key 只在本机**
- 价值：用 AI 又不想内容外泄/跟人走，需要知道边界在哪。
- 步骤要点：请求只发你自己配的供应商（不过项目中转）；Key 本机加密、不进备份/便携包；**桌面 AI 助手对话只在内存**（关面板即失）；**AI 写作会话只存本机**（不进云同步、便携包不含、换机不跟）；想留结果就落进文档（才有历史版本）。
- 依据：guide/10「桌面：对话只存在内存」+ guide/17「会话存在哪」+ guide/18 便携包不含 AI 会话。

**TIP-06 Android 卸载保留数据（省一次重装迁移）**
- 价值：清空间后还要装回时，勾一下就不用重新导数据。
- 步骤：Android 10+ 从**系统卸载对话框**（应用详情/启动器卸载菜单）卸载 → 勾「保留应用数据」→ 同包名同签名重装后数据还在。⚠️ 桌面拖走图标、adb 卸载、Android 9- 不弹此选项；不保险就先「导出便携包到文件」（落系统下载目录、卸载后仍留存）。
- 依据：docs/mobile/UNINSTALL-DATA.md §0 + AndroidManifest.xml:14。注意：先落 G-07 修 guide 相反口径。

**TIP-07 画板素材库 materials/：常用图形做成可复用素材**
- 价值：流程图里的固定组件（架构图例、表单框）不用每次重画。
- 步骤（桌面）：画板素材面板 →「打开素材文件夹」→ 往数据目录 materials/ 放 .board.json（一份画板文档正文 + material 元数据）→ 重开面板自动列出 → 插入画板保存后图片才进该画板资产。⚠️ 素材**设备本地**：不进 S3、不随便携包（桌面↔桌面走整库目录可带）；手机端暂用本地兜底、无「打开文件夹」。
- 依据：README.md:48 + AGENTS §3「画板自定义素材」（261114 用户点单）。手册侧须先落 G-04。

**TIP-08 日记 ↔ 小记/文档互转：写错了空间不用重打**
- 价值：随手在日记里写长了/写成资料了，一键挪走，正文卡片零损失。
- 步骤：日记条目右键（手机 ⋯）→「转为文档…」选笔记本（= **移动**，历史/回收站/索引跟随）；或「转为小记」（= **复制**正文+图片/附件到小记，原稿进回收站可恢复）。⚠️ 表格/多维表/画板/手写板类型的日记只能先「转为文档」；不支持反向移入日记本。
- 依据：guide/16 转为文档/转为小记节（261122 已写准，技巧化改写即可）。

**TIP-09 同步记录账本：被覆盖的编辑一键恢复本地版**
- 价值：「另一台把我的字盖了」不再恐慌——账本记了远端覆盖/他端删除/保存时磁盘被改三类，一键恢复并重传。
- 步骤：出现角标 → 打开同步记录列表（桌面同步状态 / 手机设置→云端与同步）→ 对某条「恢复本地版」（走历史快照 → 标 local-wins 重传）。后台同步永远不弹窗，只给角标。
- 依据：AGENTS §4 同步记录账本 + README 当前能力。手册侧须先落 G-05。

**TIP-10 编辑锁当「防误改」用（两端共享语义）**
- 价值：给定稿/借出去的文档加只读锁，锁随同步传播到所有设备，不用挨台设。
- 步骤：文档右键「锁定（只读）」（⇧⌘G）→ 各端同步后都只读；解锁同入口。⚠️ 锁**只锁本地编辑、不拦同步**（别的设备照样能改并同步进来——锁不是「停止同步」）；想让某台完全不出网用 TIP-04。
- 依据：guide/02 锁定 + guide/11 多端同步判断题 + guide/13 快捷键。

**TIP-11 长按与批量：手机上的效率入口**
- 价值：手机整理几百条不靠一条条点。
- 步骤：① 长按桌面图标三快捷入口（拍照小记/剪切板小记/新建小记；前两者整份替换未提交草稿、取消不动草稿）；② 首页「＋」长按约 260ms 上滑 = 直接进速记写作卡；③ 长按文档行进多选（上限 500）批量移动/打标签/移入回收站；④ 笔记本卡片长按 = 编辑菜单（含「收起」）。
- 依据：guide/07 快捷入口 + guide/02/15 批量选择（均已核实，技巧化串联）。

### 2.3 清理清单（X-xx）

> 处置总原则（HANDOFF §2 先例）：**先搬结论/改注释/改链接，再删**；每条给出引用点 grep 证据与处置顺序；删除在 git 历史可查。

---

**X-01（P2）docs/audit-261112/（27 分册 + device-check/ + evidence/，约 7.5MB）——完结合案但引用网最密，按「存活集」裁剪**

- 引用点证据（git grep 实测）：
  - **AGENTS.md:75**（§3#23 指 13-write-guard-sweep.md 作越界清单）、**docs/SYNC-PROTOCOL.md:344**（G1–G18 判定出处）——契约级；
  - **electron/s3v3/remoteIconWrite.test.ts:4**、**electron/s3v3/scenarioMatrix.test.ts:4**——测试头注释出处；
  - **scripts/multi-end-sync/README.md:7/:91/:114**（21 号报告 = 移动多端手工方法手册）；
  - **docs/MOBILE-DESIGN.md:497**（04-mobile 的规模数字出处）；
  - **docs/HANDOFF.md:5**（00-MASTER-PLAN 附录 E = Q01–Q27 用户裁决）、:530/:698（21/22 号报告、evidence/diary-to-quicknote-mobile/）、:720/:723/:841/:1024（分册链接）、:1059（P2 已写「audit-261112 分册……按需搬进对应文档」）。
- 处置顺序：① 13 号「G1–G18 越界清单 + 其余 15 处必要守卫结论」并入 SYNC-PROTOCOL.md §9.6 附注 → 改 AGENTS.md:75、SYNC-PROTOCOL.md:344、两个测试头注释指向新落点；② 21 号 A–K 移动多端手工方法整段搬进 scripts/multi-end-sync/README.md（已是命令手册）→ 改 3 处链接；③ **00-MASTER-PLAN.md 单文件保留**（附录 E 用户裁决不可失联）；④ 04-mobile 的规模结论搬进 MOBILE-DESIGN.md:497 后可删；⑤ 其余分册（02/03/05/06/07/09–12/15–20/22–27）+ device-check/ + evidence/（除 HANDOFF:698 引的 diary-to-quicknote-mobile/，或连引用一起改）删除；⑥ HANDOFF 各处链接改无链文字。**建议存活集 = 00-MASTER-PLAN（+13/21 若未搬完）**。
- 代价与风险：一次性 2~4 小时消引用；风险 = 裁决附录 E 误删（必须留）；收益 = 瘦 7MB 级 + 27 份过期审计不再误导新会话（开源前最值得做的一件）。
- 涉及端：共享（文档/测试注释/脚本注释）。

---

**X-02（P2）docs/audit-261124/（6 文件，148KB）——**未完结合案**，先摘未修清单再删**

- 引用点证据：docs/HANDOFF.md:21、:733（「**B 批/P3/护栏清单在审计报告，未修**」——未完事项压在报告里）、docs/RELEASE-NOTES.md:75（用户可见发布说明带 docs/audit-261124 路径）。
- 处置顺序：① 把报告里的未修清单（B 批残留 / P3×21 / 40 条护栏建议）摘成 HANDOFF §3 待办行；② RELEASE-NOTES.md:75 改为不带路径的陈述；③ 删目录（或留 00-MASTER 删 5 分册）。**先摘后删**，否则待办真丢（HANDOFF 是唯一待办清单）。
- 代价与风险：摘清单半小时。
- 涉及端：共享（文档）。

---

**X-03（P2）design-plans/（5 文件，92KB）——活跃欠账表搬家 + 4 份完结合案删**

- 引用点证据：
  - **device-debt-261117.md = 活跃欠账总表**（非合案）：docs/RESILIENCE.md:189、scripts/mobile-audit/README.md:146、scripts/mobile-audit/device-debt-smoke.mjs:3、src/mobile/bridge/context.ts:123 四处引用。
  - 已完结合案 4 份（bitable-ui-audit-261117 / color-palette-audit-261119 / mobile-button-boundary-audit-261119 / mobile-ui-jank-audit-261119）：引用点 = docs/HANDOFF.md:217/:230/:258/:274/:290（批次记录）、docs/RELEASE-NOTES.md:413/:423（发布说明带路径）、src/mobile/usheet/usheetColorCompliance.test.ts:2（「261119 审计 design-plans/color-palette-audit-261119.md §3」）。
- 处置顺序：① device-debt-261117.md → docs/DEVICE-DEBT.md，改 4 处引用（context.ts:123 是产品代码注释，改动零行为但要过 tsc/vitest）；② 4 份合案删，RELEASE-NOTES 两处去链接、usheetColorCompliance.test.ts:2 注释改「261119 配色审计（git 可查）」；③ HANDOFF §0 批次行保留文字不带链。
- 代价与风险：约 1 小时。
- 涉及端：共享（文档 + 1 处代码注释）。

---

**X-04（P3）docs/icon-migration/（5 文件，188KB）——判据被契约引用，只删调研 4 份 + 修 1 处死链**

- 引用点证据：docs/DESIGN.md:432 指 **C-PATH-PLAN.md §3**（J1–J4 自绘图标判据 = 现行设计红线出处）、scripts/audit-icons.mjs:9 指 **§4.3**（R1/R2/R3 判据）；docs/HANDOFF.md:502 指 DECISION.md。**死链**：C-PATH-PLAN.md:436 引 docs/icon-migration/LICENSE-IconPark.txt（不存在；真实许可在 LICENSES/IconPark-APACHE-2.0.txt，NOTICE「二、其它第三方」已指对）。
- 处置顺序：① 修 :436 死链指向 LICENSES/IconPark-APACHE-2.0.txt；② A-official / B-inventory / C-poc / DECISION 删（改 HANDOFF:502 一处）；③ **C-PATH-PLAN.md 保留**（判据出处）——或把 §3/§4.3 判据原文抄进 DESIGN.md 与 audit-icons.mjs 头注释后全删（多 1 小时，收益同）。
- 代价与风险：低；不搬判据直接删 = DESIGN 红线出处断链。
- 涉及端：共享（文档/脚本注释）。

---

**X-05（P3）modern-web 家族 + MERGE-REVIEW：只删两份已完成件，backlog 保留**

- 引用点证据：MODERN-WEB-AUDIT.md 被 **12 处源码契约注释**引用（src/core/ime.ts:2、src/styles/textScale.test.ts:7、modernCssGates.test.ts:7、focusRingGates.test.ts:7、src/mobile/ui/enterKeyHint.test.ts:7、src/lib/imageAttrGates.test.ts:7、keyboardActivationGates.test.ts:7、landmarkGates.test.ts:7、electron/boot.html:10、bootAssets.test.ts:6 等），且 HANDOFF.md:1027 以其 §11 为**未结案推迟项**来源 ⇒ **保留**；docs/modern-web/STRICTER-BACKLOG.md = 更严格候选 backlog（未结案）⇒ 保留；docs/modern-web/VERIFY-261116.md = 对审计的复核（已完结合案，唯一引用 HANDOFF:502）⇒ 删；docs/MERGE-REVIEW-261116.md = 分支合并评审材料（唯一引用 HANDOFF.md:516，「待用户裁决」三项已随 261121 合入了结）⇒ 删。
- 处置顺序：改 HANDOFF:502/:516 两处 → 删两文件。若用户想留评审材料可只删 VERIFY。
- 代价与风险：15 分钟。
- 涉及端：共享（文档）。

---

**X-06（P3）docs/arch/SIYUAN-PR-21151.md + docs/mockups/brand-discussion/ 的删除；mockups 其余保留**

- 引用点证据：
  - SIYUAN-PR-21151.md：8 处相对链接在仓库内**全部失效**（指向容器外 siyuan-master/、lakex-local-notes/ 路径——全仓死链 13 处里占 8）；唯一仓内引用 = HANDOFF.md:502。同目录 ELECTRON-LAYERING-AUDIT.md 被 .github/workflows/pr.yml:39 + electron/architecture.test.ts:14 / buildContract.test.ts:28 / buildTarget.ts:4 / startupBranches.test.ts:20 + tsconfig.electron.json:2 + vite.config.ts:8 引用 ⇒ **保留**。
  - docs/mockups/brand-discussion/（660KB、10 png）：**全仓 0 引用**；其中 b-crane-two-green.png 与 public/brand/14a-paper-finch-mark.png **md5 逐字节相同**（品牌定稿资产已被 electron/bootAssets.test.ts:31 钉为逐字节相同护栏；裁决结论在 src/components/app/BrandLaunchMark.tsx:4 等注释）。
  - docs/mockups/ai-writing-b.html **保留**（docs/AI-WRITING.md:184/:187 引作「B 方案不做」讨论记录）；docs/mockups/mobile-bitable.html + mobile-bitable/（2.8MB 钉钉实机截图）**保留**（docs/MOBILE-BITABLE-DINGTALK.md:9/:11/:198/:325 引用）。
- 处置顺序：改 HANDOFF:502 → 删 SIYUAN-PR-21151.md；删 brand-discussion/（连带消除唯一一组重复图片）。
- 代价与风险：低。
- 涉及端：共享（文档/图片）。

---

**X-07（P1）仓库垃圾与本机构建残留（约 2.3GB 级）——最实打实的一条**

- 证据：
  - **.agents/worktrees/theme-siyuan-mobile：git worktree（git worktree list 核实：分支 theme-siyuan-mobile @ 7b4d5d36），1.5GB，含完整 node_modules**；同表还有 /private/tmp/lake-bisect（detached、**prunable**）。它是共享仓注册 worktree（git status 因此干净），留着 = 后续会话误入旧检出/并行改动混淆的真实隐患；产品面 0 引用。
  - .ai-writing-recon/ 15MB（.gitignore:31「走查现场」，261110 filter-repo 清出历史后的本机残留）；.css-audit/ 80MB（.gitignore:7 工具中间数据；门禁基线不在其中——scripts/clean-dev-artifacts.sh 头注释写明）；根 .DS_Store（.gitignore:6）。
  - release/ 604MB：builder-debug.yml + 「LakexLocalNotes Setup 1.5.6.exe」+ win-arm64-unpacked——⚠️ 与 HANDOFF §3「Windows 真机验收（先确认 arch 再出包）」**可能就是待交付产物**，删除前必须和用户确认。
- 处置顺序：① 确认分支已合/无会话在用后 `git worktree remove .agents/worktrees/theme-siyuan-mobile` + `git worktree prune`（顺带清 lake-bisect）；② .gitignore 补 .agents/；③ `bash scripts/clean-dev-artifacts.sh`（默认 dry-run）清 .ai-writing-recon/.css-audit/构建产物，看报告再 --apply；④ release/ 单独等 Windows 交付确认。
- 代价与风险：worktree 删除前查 `git branch --merged`；其余零风险。收益 = 1.5G + 700MB 级 + 消误操作隐患。
- 涉及端：共享（仓库）。

---

**X-08（P2）死链修复清单（全仓校验 13 处，全部落在上述候选内）**

- 证据（本次相对链接全量校验）：docs/arch/SIYUAN-PR-21151.md ×8（→X-06）；docs/audit-261112/00-MASTER-PLAN.md → ../guide/16-diary.md（少一级，应 ../../guide/）、07-docs-cleanup.md → path、09-r0-docs-review.md ×3（15-import-export.md / README.md / 13-shortcuts.md 少 guide/ 前缀）（→X-01 随删消失或顺手修）；docs/icon-migration/C-PATH-PLAN.md:436（→X-04）。**guide/、README×2、核心规格（HANDOFF/AGENTS/PORTABLE-TRANSFER/SYNC-PROTOCOL 等）0 死链**。
- 处置：随 X-01/X-04/X-06 一并消。
- 涉及端：共享（文档）。

---

**X-09（基本不做）scripts/ 过期脚本清点结论：无「零引用」死脚本**

- 证据：对 20 个疑似一次性脚本（ab-verify / cdp-eval / table-paste-stress / lake-roundtrip-check / s3v3-manual-capacity / verify-svg-csp / e2e-f06-android / mobile-f16-acceptance / mobile-lake-coverage / mobile-coldopen-breakdown / mobile-kernel-perf / ai-stream-probe / e2e-block-* / e2e-sidebar-hover / generate-update-manifest / lakexLocalize 等）逐一 git grep：**每个至少 1 处 docs/测试/代码引用**（多为 HANDOFF 登记的排障/探针入口）；android-build.sh / s3-ls.mjs / setup-* 在 AGENTS §6 命令表。
- 处置：不删；只在 X-01/X-02 删文档时核对脚本注释是否断链。
- 涉及端：共享。

---

**X-10（P2，§3#7 文档面审查结论）历史口径统一**：与 G-03 同批——ARCHITECTURE.md:76（「enc:v1 读路径兼容、惰性迁移」与 261204「按未配置读出、不写迁移代码」直接冲突）、DEVELOPMENT.md:90、README.md:243、README.en.md:245、guide/11:37 五处改口径；另 android/.../SecureStorePlugin.kt:16 注释「存量 Keystore 密文一次性迁移后退役」表述含混（易被读成现行仍有迁移；建议改「存量按未配置读出、重填即转 v2」——代码注释、零行为）。详见 §4 #12。其余文档（guide/18「旧版便携包（v1）不兼容」、PORTABLE-TRANSFER「不写 v1 兼容」、STORAGE-LAYERS「旧库 notes.content 整库重置」、ARCHITECTURE:104「manifests 孤儿不读不迁不删」）**均与 §3#7 一致，无需改**。

## 3. 明确不建议做清单

1. **不清理 vendor/ 与依赖侧冗余、死代码**——AGENTS §3#18 硬红线（含 public/vendor 字体）。
2. **不为便携包 v1 写兼容读取**——§3#7；现状「formatVersion 1 直接拒」（src/core/portable/portableFormat.ts:8）就是正确姿势，别反过来「顺手支持」。
3. **不给 guide 截图做压缩/转 WebP/统一重录**——收益只有几百 KB 体积，代价是 31 张全量重截比对；「以界面为准」口径已兜底。
4. **不给 guide 做英文版**——工作量大且非开源必需（README.en + 中文定位已够）；等真有英文用户需求再立项。
5. **不给文档加站点/生成工具链**——新依赖、新构建面（§3#22 四问过不了）；GitHub/Gitee 直读 Markdown 已够。
6. **不在本流做 InkPad/大文件拆分重构**——HANDOFF 已登记 Q19-10 拆分计划与顺序，重复立项违反「已结案别立项」；本流只出补注释方案（§5）。
7. **不合并 README「当前能力」与 guide 目录为单一来源**——受众不同（贡献者/用户），强合并要引入生成机制，收益只停在「更整洁」。
8. **不动 docs/lakexEditor-developer-docs/（75 篇官方镜像）**——内核检索第一出处（AGENTS §2）。
9. **不删 update checkIntervalHours=0 的「历史值只读兼容」**——看似可删（设置值可重建），但 0 = 用户曾选「关闭自动检查」，收敛成 24 等于**悄悄恢复出网检查**，违反用户意图（详见 §4 #4）。
10. **不收编/迁移旧随机 id 的兜底「未分类」笔记本**——AGENTS §3#12 已结案（认 id 不认名字、多一本无害）。
11. **不做 guide/README 一致性自动 lint**——一次性人工核对已覆盖，脚本护栏对文档收益小于维护成本。
12. **不删 docs/mockups/ai-writing-b.html 与 mobile-bitable 样机**——被契约文档当「不做方案/评审稿」的证据引用（AI-WRITING.md:184、MOBILE-BITABLE-DINGTALK.md:9）。

## 4. 历史兼容代码清单（§3#7 面；仅列本流实际读过核实的条目）

| # | 位置 | 类别 | 现状语义 | 能否按 §3#7 删 | 删的代价 |
|---|---|---|---|---|---|
| 1 | electron/quickNoteTagsStore.ts:36/:279、src/mobile/data/quickNoteTagsRepository.ts:28/:232、docs/TAG-SYSTEM-DESIGN.md:17（tag_absent_migrated） | ①真·历史数据兼容 | 旧库「删除=墓碑（deleted_at）」一次性迁移成「删除=缺席」，跑一次置标记 | **可删**（旧 deleted_at 行可直接物理删——能删了重建） | 极小：从未升级的老库残留墓碑行（显示面已按缺席语义判）；删迁移时保留「清行」路径即可 |
| 2 | docs/SYNC-STATE-CONVERGENCE.md:158（sync_base legacy） | ①真·历史数据兼容 | 旧同步基线表仅剩 3 处活引用，收敛计划已写「删表+方法+测试、旧库空表不迁移」 | **可删**（按既定计划执行） | 小；连测试一起清，属既定待办非新决定 |
| 3 | src/core/firstEncounter.ts:35/:47、docs/SYNC-PROTOCOL.md:690（目标身份「兼容旧四段式存储键」） | ①边界（本机派生键） | sameSyncTargetKey 容忍旧 4 段/新 3 段键，防两端 region 填法不同误触发首次相遇 | 技术上可删（键可重建），**但不值得**：删后旧键失配 = 重新弹首次相遇询问 + 基线重合成 | 收益仅省几行；建议保留（判据容错≠数据迁移） |
| 4 | src/core/update/updateTypes.ts:16/:22、src/mobile/update/updateSettings.ts:16、docs/UPDATE-CENTER.md:69（checkIntervalHours=0 只读兼容） | ②不许删 | 0 = 旧版本「关闭自动检查」语义；现行 UI 不再提供 0 选项，读到仍当关闭 | **不能删** | 删 = 把旧用户「关闭自动检查」悄悄收敛成 24h 自动检查 = **出网语义变化**，比兼容代码本身更糟 |
| 5 | AGENTS.md:127、docs/INK-PAD.md（inkDoc v3 读兼容：读 1/2/3/4 写 4） | ②不许删 | 旧手写板正文可读可导出；旧端读 v4 已进只读保护 | **不能删** | 用户手写数据**不能删了重建**（§3#7 判据反面） |
| 6 | src/features/quickNotes/quickNotePreviewParser.ts:349（restoreEscapedCards） | ②不许删 | 还原被旧版本实体化转义的卡片正文（261121「超长链接」修复的读端） | **不能删** | 对应小记正文是用户内容，删 = 历史小记预览退回「超长链接」 |
| 7 | 移动 schema 历史 DDL/DROP（docs/SYNC-STATE-CONVERGENCE.md:159「旧库 DROP COLUMN 迁移」等） | ②不许删 | 旧版本安装的库升级到现行版本的链路 | **不能删** | 删迁移步 = 老用户升级断链丢库；清理只能走「整库重置」级决策，须用户裁决 |
| 8 | src/features/usheet/usheetAutoHeightHeal.ts（+ rowData.ah） | 非兼容（视图自愈） | 旧表格行无渲染高度缓存时打开期自愈、不标脏 | 无需删 | 删了旧表行高退回 24px 裁字；它就是「重建派生值」本身 |
| 9 | android/.../PortablePackagePlugin.kt:44、src/core/portable/portableFormat.ts:8（便携包 v1） | 已合规 | formatVersion 1 直接拒、不写兼容 | 无需动作 | —（§3#7 样板） |
| 10 | AGENTS.md:115、docs/STORAGE-LAYERS.md:89（旧库 notes.content） | 已合规 | 升级整库重置一次、不写兼容读取 | 无需动作 | —（§3#7 样板） |
| 11 | docs/ARCHITECTURE.md:104（旧 manifests/latest.json） | 已合规 | V2 遗留孤儿：不读、不迁移、不删除 | 无需动作 | — |
| 12 | **docs/ARCHITECTURE.md:76 + docs/DEVELOPMENT.md:90 + README.md:243 + README.en.md:245 + guide/11-cloud-sync.md:37（密钥口径）** | **文档口径冲突** | 文档仍写「enc:v1 惰性迁移 enc:v2 / Android Keystore / 系统安全存储」，与 261204 裁决（按未配置读出、不写迁移、SecretBox 自管理）相反 | 文档必须改（代码已合规：electron/secretCipher.ts:13/:92） | 不改 = 用户安全预期错位 + 后续会话照文档写回兼容代码 |

**小结：可删 2（#1/#2）／不许删或不值得删 5（#3~#7）／无需动作 4（#8~#11）／文档口径冲突 1（#12，并入 G-03/X-10）。** 全库未发现「正在为旧数据写新兼容」的在途违规；§3#7 红线在便携包 v1、notes.content、enc:v1 三处均按「拒绝迁移」执行到位。

## 5. 大文件与注释现状小结

**口径**：只评自有代码（vendor/lakex-doc-react 的 26K 行 CSS、4K 行 icon.tsx 等不评，AGENTS §3#18）；「缺头注释」= 文件首行即 import、无职责/红线说明。本节只出**补注释方案**（纯文档性、零行为），不做拆分（见 §3 第 6 条）。

| 文件（行数） | 现状 | 补注释方案 | 优先级 |
|---|---|---|---|
| electron/store.ts（2210） | 无头注释 | 补 8~10 行：职责（两库/正文文件/基线）、**写守卫 U/S/I/R/M 调用方分类指针**（SYNC-PROTOCOL §9.6、AGENTS §3#23）、saveSyncedNote 特例 | P2 |
| electron/main.ts（1164） | 无头注释 | 补：进程职责、IPC 注册集中地、external 从 dependencies 派生红线（AGENTS §4） | P3 |
| src/App.tsx（1533） | 无头注释 | 补：桌面壳层组合根、空间切换/标签/生命周期挂载点清单 | P3 |
| src/components/app/Sidebar.tsx（1685） | 无头注释 | 补：目录树职责、展开记忆/启动不跟随两条语义（261122 根因 A/B）、拖拽落点语义 | P3 |
| src/features/editor/EditorTab.tsx（1204） | 无头注释 | 补：内核 lazy 边界之一、createUploadPromise:undefined 红线、BookmarkToolbar/图片画廊挂载点（AGENTS §4 三红线） | P2 |
| src/features/ink/InkPad.tsx（1533） | 无头注释 | 补：inkDoc v4 读写口径指针（docs/INK-PAD.md）、落笔不得整篇序列化红线（拆分计划已在 HANDOFF，勿动结构） | P3 |
| src/mobile/MobileApp.tsx / home/HomePage.tsx / features/bitable/BitableEditor.tsx / bitableCells.tsx | 已有合格头注释 | 可作范例，不动 | — |
| src/lib/lakeEmojis.ts（1425）/ emojiZhKeywords.ts（1188）/ core/bitableDoc.test.ts（1578） | 数据/测试文件 | 不需要头注释 | — |
| src/mobile/mobile.css（约 1498 行） | 有分区注释配平纪律（AGENTS 踩坑「批量删注释后必须配平」） | 维持现状，不拆 | — |

**契约注释缺口**：usheet（usheetKernelContract.ts）、ink、topChrome（topChromeContract）、写守卫（SYNC-PROTOCOL §9.6）都已有契约文件/护栏；主要缺口 = 上表 store.ts / EditorTab.tsx 两处「红线触点不写在进门处」。全部为 P2/P3 纯注释改动，逐条 5 分钟级、无行为风险。

---
*报告完。本流未修改任何代码/文档；上述删除类方案均须按各条「处置顺序」先消引用再动手，删除在 git 历史可查。*
