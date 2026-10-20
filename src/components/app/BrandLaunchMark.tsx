/**
 * 14A Paper Finch 启动标记（桌面）。
 *
 * 资源：public/brand/14a-paper-finch-loading-256.apng（loop 版：可被启动完成随时中断）。
 * one-shot 版留给固定时长的品牌开场；实际启动不能用 one-shot —— 桌面冷启动实测约 0.3s，会把折纸截在中段。
 * reduced-motion 时改用透明静态 poster；图片本身是品牌资产，容器/文字仍走 --lake-* 令牌。
 */
export function BrandLaunchMark({ label }: { label?: string }) {
  return (
    <div className="brand-launch" role="status" aria-live="polite">
      <img
        className="brand-launch__anim"
        src="/brand/14a-paper-finch-loading-256.apng"
        alt=""
        draggable={false}
      />
      <img
        className="brand-launch__poster"
        src="/brand/14a-paper-finch-poster-transparent.png"
        alt=""
        draggable={false}
      />
      {label ? <span className="brand-launch__label">{label}</span> : null}
    </div>
  );
}
