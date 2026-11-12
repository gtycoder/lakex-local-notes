/**
 * 14A Paper Finch 启动标记（移动端）。
 *
 * 资源：public/brand/14a-paper-finch-mark.png（透明底双绿雀；261112 去掉白底/薄荷圆）。
 * 移动端 UI 独立：本组件与桌面 BrandLaunchMark 只共享资源，不共享样式/组件实现。
 */
export function MobileBrandLaunchMark({ label }: { label?: string }) {
  return (
    <div className="mb-launch" role="status" aria-live="polite">
      <img
        className="mb-launch__mark"
        src="/brand/14a-paper-finch-mark.png"
        alt=""
        draggable={false}
      />
      {label ? <span className="mb-launch__label">{label}</span> : null}
    </div>
  );
}
