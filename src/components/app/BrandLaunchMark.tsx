/**
 * 14A Paper Finch 启动标记（桌面）。
 *
 * 资源：public/brand/14a-paper-finch-mark.png —— **透明底、双绿折纸雀**（261112 用户裁决：
 * 去掉白底与淡薄荷圆，只保留绿雀；启动底色走主题窗底，见 electron/main.ts）。
 * 入场动效由 styles/brand-launch.css 的 250ms ease-out 承担；reduced-motion 下静态呈现。
 */
export function BrandLaunchMark({ label }: { label?: string }) {
  return (
    <div className="brand-launch" role="status" aria-live="polite">
      <img
        className="brand-launch__mark"
        src="/brand/14a-paper-finch-mark.png"
        alt=""
        draggable={false}
      />
      {label ? <span className="brand-launch__label">{label}</span> : null}
    </div>
  );
}
