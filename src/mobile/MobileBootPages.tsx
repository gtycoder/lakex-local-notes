/**
 * 启动三页（M-06② 从 MobileApp.tsx 尾部搬出，纯搬移/零行为变化）：启动失败页 / 坏库页 / 冷启动骨架。
 * 三者都是**启动相位的可处置出口/占位**（MOB-08 / 261105 坏库口径），与主应用路由无关 ⇒ 独立成文件；
 * 调用顺序与处置按钮接线仍在 MobileApp（错误页优先于骨架、坏库页优先于错误页）。
 * 护栏：mobileBootError.test / mobileDbProblemPage.test（源码级，读本文件 + MobileApp）。
 */
import { MobileBrandLaunchMark } from "./ui/BrandLaunchMark";

/**
 * 启动失败页（MOB-08）：可处置 —— 重试 / 清派生缓存后重试 / 复制诊断。
 * 只用现有原语（toolbar + mobile-settings-content + mb-card/mb-btn/mb-set-*），不写内联样式、不新增 CSS。
 */
export function MobileBootErrorPage(props: {
  message: string;
  onRetry: () => void;
  onClearCacheAndRetry: () => void;
  onCopyDiagnostics: () => void;
}) {
  return (
    <div className="mobile-app">
      <div className="mobile-home">
        <header className="toolbar toolbar--border mobile-topbar" data-mb-topbar data-edge="viewport" data-size="regular">
          <span className="mobile-topbar-gap" aria-hidden="true" />
          <span className="mobile-topbar-title">启动失败</span>
          <span className="mobile-topbar-gap" aria-hidden="true" />
        </header>
        <div className="mobile-settings-content">
          <div className="mb-set-group">
            <div className="mb-set-title">本地知识库未能打开</div>
            <div className="mb-card">
              <div className="mb-card__head">错误信息</div>
              <div className="mb-card__body">
                <p className="mb-form__desc">{props.message}</p>
                <p className="mb-form__desc">数据仍在本机：重试不会改动正文、附件或未同步的修改。</p>
                <p className="mb-form__desc">「复制诊断信息」可一并导出最近的崩溃记录（含上一条原生崩溃）。</p>
              </div>
            </div>
            <div className="mb-set-items">
              <button type="button" className="mb-btn mb-btn--primary mb-btn--block" onClick={props.onRetry}>重试</button>
              <button type="button" className="mb-btn mb-btn--block" onClick={props.onClearCacheAndRetry}>清理缓存后重试</button>
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--block" onClick={props.onCopyDiagnostics}>复制诊断信息</button>
            </div>
            <p className="mb-form__desc">「清理缓存」只清可重建的派生数据（搜索索引/FTS 账本 + 渲染临时文件），不删除正文、历史快照和已下载资源。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 坏库页（261105）：本地数据库打开报「损坏」或 `PRAGMA quick_check` 未通过时的出口。
 *
 * 与普通启动失败页的区别：只重试没有意义，必须先给「从云端恢复」。语义与设置页同名入口同源
 * （bridge/sync.ts:533 restoreFromCloud：清本机同步账本 → 只拉不打；云端没有的本机文档进回收站，可恢复）。
 * 本机库文件不做导出（移动端没有桌面那种文件选择器；先把能力限制在「诊断可复制 + 恢复可执行」）。
 */
export function MobileDatabaseProblemPage(props: {
  reason: string;
  onRetry: () => void;
  onClearCacheAndRetry: () => void;
  onRestoreFromCloud: () => void;
  onCopyDiagnostics: () => void;
}) {
  return (
    <div className="mobile-app">
      <div className="mobile-home">
        <header className="toolbar toolbar--border mobile-topbar" data-mb-topbar data-edge="viewport" data-size="regular">
          <span className="mobile-topbar-gap" aria-hidden="true" />
          <span className="mobile-topbar-title">本地数据库需要处理</span>
          <span className="mobile-topbar-gap" aria-hidden="true" />
        </header>
        <div className="mobile-settings-content">
          <div className="mb-set-group">
            <div className="mb-set-title">本地库检查未通过</div>
            <div className="mb-card">
              <div className="mb-card__head">原因</div>
              <div className="mb-card__body">
                <p className="mb-form__desc">{props.reason}</p>
                <p className="mb-form__desc">正文、附件与历史快照都在本机文件里，不会被这一步删除。</p>
                <p className="mb-form__desc">本机数据库文件暂不支持导出，请先「复制诊断信息」留存（会一并带上最近的崩溃记录）。</p>
              </div>
            </div>
            <div className="mb-set-items">
              <button type="button" className="mb-btn mb-btn--primary mb-btn--block" onClick={props.onRestoreFromCloud}>从云端恢复（换机/坏库）</button>
              <button type="button" className="mb-btn mb-btn--block" onClick={props.onRetry}>重试</button>
              <button type="button" className="mb-btn mb-btn--block" onClick={props.onClearCacheAndRetry}>清理缓存后重试</button>
              <button type="button" className="mb-btn mb-btn--ghost mb-btn--block" onClick={props.onCopyDiagnostics}>复制诊断信息</button>
            </div>
            <p className="mb-form__desc">「从云端恢复」会清空本机同步记录并以云端为准重新下载：云端没有的本机文档会移入回收站（可恢复），不会上传本机内容，也不会删除本机附件。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 冷启动骨架（261013，6.9）：结构与真实首页同构、尺寸走同一批令牌 ⇒ 数据到达后原地填充、不整屏跳。
 * 纯静态、无内核、无数据依赖；容器 aria-busy，占位条 aria-hidden（读屏不会念出一堆无意义节点）。
 */
export function MobileHomeSkeleton() {
  return (
    <div className="mobile-app">
      <div className="mobile-home" aria-busy="true">
        {/* 与真实顶栏同构（261110 底部 Dock 改版）：左 = 设置，中 = **当前空间标题**，右 = 空间内动作 + 搜索 + 云同步。 */}
        <header className="toolbar toolbar--border mobile-topbar mobile-topbar--home" data-mb-topbar data-edge="viewport" data-size="compact">
          <div className="mobile-topbar-group mobile-topbar-group--start">
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
          </div>
          <div className="mobile-topbar-group mobile-topbar-group--center">
            <span className="mb-skel mb-skel--tab" aria-hidden="true" />
          </div>
          <div className="mobile-topbar-group mobile-topbar-group--end">
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
            <span className="mb-skel mb-skel--icon" aria-hidden="true" />
          </div>
        </header>
        <div className="mobile-tab-stage">
          <div className="mobile-scroll">
            <section className="home-section">
              <div className="home-section__head"><span className="mb-skel mb-skel--group" aria-hidden="true" /></div>
              <span className="mb-skel mb-skel--row" aria-hidden="true" />
              <span className="mb-skel mb-skel--row" aria-hidden="true" />
              <span className="mb-skel mb-skel--row" aria-hidden="true" />
            </section>
          </div>
        </div>
        {/* 骨架与真实底部同构（261110）：五格 Dock + 中央悬浮＋，否则数据到达时宽度/位置会跳一次。 */}
        <div className="mb-home-dockwrap" aria-hidden="true">
          <nav className="mb-home-dock">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="mb-skel mb-skel--baritem" />)}
          </nav>
          <span className="mb-skel mb-skel--fab" />
        </div>
      </div>
      <div className="mb-launch-overlay">
        <MobileBrandLaunchMark label="正在打开本地知识库" />
      </div>
    </div>
  );
}
