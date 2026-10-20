/**
 * 14A Paper Finch 启动标记（移动端）。
 *
 * 资源：public/brand/14a-paper-finch-loading-128.apng（loop 版：启动完成可随时中断）。
 * 移动端 UI 独立：本组件与桌面 BrandLaunchMark 只共享资源，不共享样式/组件实现。
 */
export function MobileBrandLaunchMark({ label }: { label?: string }) {
  return (
    <div className="mb-launch" role="status" aria-live="polite">
      <img
        className="mb-launch__anim"
        src="/brand/14a-paper-finch-loading-128.apng"
        alt=""
        draggable={false}
      />
      <img
        className="mb-launch__poster"
        src="/brand/14a-paper-finch-poster-transparent.png"
        alt=""
        draggable={false}
      />
      {label ? <span className="mb-launch__label">{label}</span> : null}
    </div>
  );
}
