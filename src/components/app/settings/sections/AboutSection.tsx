// 261112 R2-S7：设置页「about」分组（纯搬移自 SettingsPanel.tsx；只改文件位置，不改任何设置项/文案）。
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { Group, Block, Item } from "../../../ui/settingsPrimitives";
import { Image as Info, HardDrive, Search, Monitor } from "lucide-react";
import { formatBytes } from "../../../../lib/formatBytes";
import { S3V3_POINTER_VERSION } from "../../../../core/s3v3/protocol/s3v3Types";

export function AboutSection({ c }: { c: SettingsPanelContext }) {
  const { LAKE_KERNEL_VERSION, LAKE_WRAPPER_VERSION, copyDiagnostics, depVersion, revealFolder, sysInfo } = c;
  return (
    <>
              <>
                {!sysInfo && (
                  <Group title="关于" icon={<Info size={16} />}>
                    <Block><div className="config-empty">读取中…</div></Block>
                  </Group>
                )}
                {sysInfo && (
                  <>
                    <Group title="关于" icon={<Info size={16} />}>
                      <Block itemId="about-app" name={`LakexLocalNotes ${sysInfo.app.version}${sysInfo.packaged ? "" : "（开发实例）"}`} desc="本地优先、离线可用；数据保存在本机，S3 只作云端备份。" />
                      <Block itemId="about-fonts" name="字体" desc="界面与正文使用内置 MiSans（小米科技，依《MiSans 字体知识产权许可协议》免费商用；此处按协议注明使用）。代码块使用 JetBrains Mono（SIL OFL 1.1）。两者均随应用内置、离线可用。" />
                    </Group>

                    <Group title="数据与存储" icon={<HardDrive size={16} />}>
                      <Block itemId="about-storage-stats" name="内容统计" desc="计数来自本机库与资源目录（只读遍历资源目录两层，不做全盘扫描）。">
                        <div className="config-stats">
                          <span>笔记 <strong>{sysInfo.storage.notes}</strong></span>
                          <span>笔记本 <strong>{sysInfo.storage.notebooks}</strong></span>
                          <span>分组 {sysInfo.storage.groups}</span>
                          <span>小记 <strong>{sysInfo.quickNotes}</strong></span>
                        </div>
                        <div className="config-stats">
                          <span>资源 <strong>{sysInfo.storage.assetFiles}</strong> 个，{formatBytes(sysInfo.storage.assetBytes)}</span>
                          <span>历史快照 <strong>{sysInfo.storage.historySnapshots}</strong> 份，{formatBytes(sysInfo.storage.historyBytes)}</span>
                          <span>库文件 {formatBytes(sysInfo.storage.dbBytes)}</span>
                        </div>
                        <div className="config-stats">
                          <span>回收站节点 {sysInfo.storage.trashedNodes}</span>
                          <span>删除标记 {sysInfo.storage.tombstones}</span>
                          <span>未归属记录 {sysInfo.storage.orphanRows}</span>
                        </div>
                      </Block>
                      <Item itemId="about-data-dir" name="数据目录" pathDesc desc={sysInfo.storage.root}>
                        <button className="ln-btn ln-btn--outlined" onClick={() => revealFolder("data")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-workspace-dir" name="工作空间" pathDesc desc={sysInfo.paths.workspace}>
                        <button className="ln-btn ln-btn--outlined" onClick={() => revealFolder("workspace")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-assets-dir" name="资源目录" desc="图片与附件按笔记分目录存放（note-assets/{noteId}/）。">
                        <button className="ln-btn ln-btn--outlined" onClick={() => revealFolder("assets")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-history-dir" name="历史快照目录" desc="快照与正文分离存放，恢复对应版本时从这里读。">
                        <button className="ln-btn ln-btn--outlined" onClick={() => revealFolder("history")}>在 Finder 中显示</button>
                      </Item>
                      <Item itemId="about-logs-dir" name="日志目录" pathDesc desc={sysInfo.paths.logs}>
                        <button className="ln-btn ln-btn--outlined" onClick={() => revealFolder("logs")}>在 Finder 中显示</button>
                      </Item>
                    </Group>



                    <Group title="诊断" icon={<Search size={16} />}>
                      <Block itemId="about-diagnostics" name="复制诊断信息" desc="把版本、运行环境、依赖与本机计数拼成一段纯文本，反馈问题时直接贴出来。" descAfter>
                        <div className="config-block__actions">
                          <button className="ln-btn ln-btn--outlined" onClick={() => void copyDiagnostics()} disabled={!sysInfo}>复制诊断信息</button>
                        </div>
                      </Block>
                      <Block itemId="about-health-entry" name="一致性检查" desc="正文文件、历史快照、孤儿登记、引用资源与目录树父子链的只读体检在「文档与历史」页运行。" />
                    </Group>
                    <Group title="版本与运行环境" icon={<Monitor size={16} />}>
                      <Item itemId="about-version" name="应用版本" desc={sysInfo.app.description || undefined}>
                        <span className="config-item__ctl"><code className="kv__v">v{sysInfo.app.version}</code></span>
                      </Item>
                      <Block itemId="about-tech-stack" name="技术身份" desc="桌面端运行框架、数据层与编辑器内核；框架版本取运行时与 package.json，内核为固定 pin。">
                        <div className="kv">
                          <div className="kv__row"><span className="kv__k">桌面框架</span><span className="kv__v">Electron {sysInfo.runtime.electron} / React {depVersion(sysInfo.deps, "react")} / better-sqlite3 {depVersion(sysInfo.deps, "better-sqlite3")}</span></div>
                          <div className="kv__row"><span className="kv__k">编辑器内核</span><span className="kv__v">Lake v{LAKE_KERNEL_VERSION}（@dlient/lakex-doc-react {LAKE_WRAPPER_VERSION}）</span></div>
                          <div className="kv__row"><span className="kv__k">同步协议</span><span className="kv__v">S3 v{S3V3_POINTER_VERSION}</span></div>
                        </div>
                      </Block>
                      <Block itemId="about-runtime" name="运行时" desc="Lake 内核运行在 Electron（Chromium）中；Node 版本决定本地数据库模块能否正常加载。实际版本见下表。">
                        <div className="kv">
                          <div className="kv__row"><span className="kv__k">Electron</span><span className="kv__v">{sysInfo.runtime.electron}</span></div>
                          <div className="kv__row"><span className="kv__k">Chromium</span><span className="kv__v">{sysInfo.runtime.chromium}</span></div>
                          <div className="kv__row"><span className="kv__k">Node</span><span className="kv__v">{sysInfo.runtime.node}</span></div>
                          <div className="kv__row"><span className="kv__k">平台</span><span className="kv__v">{sysInfo.runtime.platform} / {sysInfo.runtime.arch}</span></div>
                        </div>
                      </Block>
                      <Block itemId="about-deps" name="内核与关键依赖" desc="内核按 package.json 锁定版本，请勿随意升级。">
                        <div className="kv">
                          {Object.entries(sysInfo.deps).map(([name, ver]) => (
                            <div key={name} className="kv__row"><span className="kv__k">{name}</span><span className="kv__v">{ver}</span></div>
                          ))}
                        </div>
                      </Block>
                    </Group>

                    <Group title="第三方与许可" icon={<Info size={16} />}>
                      <Block itemId="about-siyuan-license" name="思源笔记 SiYuan" desc="界面版式与主题令牌移植自 SiYuan（AGPL-3.0，https://github.com/siyuan-note/siyuan）：相关规则已收编到 src/styles/compat.css 与 kit.css（保留署名）；本项目不构成分发思源代码。" />
                      <Block itemId="about-lakex-license" name="语雀 Lake 内核" desc="Lake 内核为语雀闭源第三方产物，已 pin，并以 vendored 形式随仓库及构建产物包含。MIT 包装层与闭源内核的许可范围不同；本项目与语雀/蚂蚁无关，未取得官方分发授权，详见仓库 NOTICE。" />
                      <Block itemId="about-third-party" name="开源依赖" desc="主要开源依赖：better-sqlite3（MIT）、sharp（Apache-2.0/MIT）、@aws-sdk/client-s3（Apache-2.0）、lucide-react（ISC）、react/react-dom（MIT）、electron-log（MIT）、TypeScript（Apache-2.0）、Vite（MIT）。完整清单以 package.json 与 lockfile 为准。" />
                    </Group>
                  </>
                )}
              </>
    </>
  );
}
