/**
 * 图片浮动工具栏图标 —— **1:1 取自云端 lake**（Yuque 编辑器图片卡工具栏的内联 SVG symbol）。
 *
 * 来源：在语雀编辑器里选中图片后，页面内联 sprite 含下列 symbol（viewBox 原样保留）：
 *   #ne-t-image-crop（裁剪）/ #ne-t-image-rotation（旋转）/ #ne-t-image-size（宽高）/
 *   #ne-t-link（链接）/ #ne-t-image-title（描述）/ #ne-t-alignment-center（对齐）/
 *   #ne-t-image-style（样式）/ #ne-c-tb-spacing（边距）/ #ne-t-batch-apply（批量应用）。
 * 内核 kitchen-iconfont（lakex v1.99.0）没有这些图形，故不再手绘/lucide 兜底。
 *
 * 全部用 `currentColor`，尺寸默认 16（= 内核 .ne-icon-symbol），随按钮颜色/尺寸。
 */
type IconProps = { size?: number };

/** 裁剪（云端 lake 原图：symbol #ne-t-image-crop，viewBox 0 0 256 256）。 */
export function IconImageCrop({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <g fill="currentColor" fillRule="nonzero"><path d="M72.74 20c5.832 0 10.578 4.735 10.737 10.637l.004.306V161.17c0 5.941 4.648 10.777 10.44 10.939l.301.004H225.26c5.932 0 10.741 4.9 10.741 10.944 0 5.941-4.647 10.777-10.44 10.939l-.3.004H94.221c-17.618 0-31.933-14.406-32.218-32.287L62 161.17V30.943C62 24.9 66.809 20 72.74 20Z"></path><path d="M183.39 237c-5.76 0-10.448-4.676-10.605-10.505l-.005-.302V95.423c0-5.868-4.59-10.644-10.312-10.804l-.297-.004H30.61c-5.86 0-10.61-4.839-10.61-10.808 0-5.867 4.59-10.643 10.313-10.803L30.61 63h131.56c17.404 0 31.545 14.227 31.826 31.886l.004.536v130.77c0 5.97-4.75 10.808-10.61 10.808Z"></path></g>
    </svg>
  );
}

/** 旋转（云端 lake 原图：symbol #ne-t-image-rotation，viewBox 0 0 256 256）。 */
export function IconImageRotate({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <g fill="none" fillRule="evenodd"><rect stroke="currentColor" strokeWidth="20" x="26.127" y="102" width="163.38" height="116" rx="20"></rect><path d="M124.295 69.037 95.058 45.322a3 3 0 0 1 0-4.66l29.237-23.715a3 3 0 0 1 4.89 2.33v47.43a3 3 0 0 1-4.89 2.33Z" fill="currentColor"></path><path d="M127.5 43.003c13.398 0 42.885-2.143 65.723 9.607C216.062 64.36 228 88.605 229.4 109.001" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round"></path></g>
    </svg>
  );
}

/** 宽高（云端 lake 原图：symbol #ne-t-image-size，viewBox 0 0 14 14）。 */
export function IconImageSize({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path d="M2.625 13.25A1.875 1.875 0 0 1 .75 11.375v-8.75C.75 1.589 1.59.75 2.625.75h2.5C6.161.75 7 1.59 7 2.625v3.75c0 .345.28.625.625.625h3.75c1.025 0 1.858.823 1.875 1.844v2.531c0 1.036-.84 1.875-1.875 1.875ZM5.125 2h-2.5A.625.625 0 0 0 2 2.625V3.75h1.25a.563.563 0 0 1 0 1.125H2v1.75h2.063a.563.563 0 0 1 0 1.125H2V9.5h1.25a.562.562 0 1 1 0 1.125H2v.75c0 .314.231.574.533.618l.092.007h3.187v-1.75a.562.562 0 1 1 1.125 0V12h1.875v-1.063a.562.562 0 1 1 1.126 0L9.937 12h1.438a.625.625 0 0 0 .618-.533l.007-.092v-2.5a.625.625 0 0 0-.625-.625H7c-.69 0-1.25-.56-1.25-1.25V2.625A.625.625 0 0 0 5.125 2Z" fill="currentColor" fillRule="nonzero"></path>
    </svg>
  );
}

/** 链接（云端 lake 原图：symbol #ne-t-link，viewBox 0 0 256 256）。 */
export function IconImageLink({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <path d="M155.639 173.9c3.839 3.84 3.904 10.023.195 13.942l-.195.2-30.783 30.783c-24.052 24.052-63.167 23.884-87.366-.315-23.957-23.957-24.362-62.533-1.03-86.64l.715-.726 30.783-30.783c3.905-3.905 10.237-3.905 14.142 0 3.839 3.84 3.904 10.023.195 13.942l-.195.2-30.783 30.783c-16.214 16.214-16.1 42.666.315 59.082 16.252 16.251 42.34 16.525 58.592.797l.49-.482 30.783-30.783c3.905-3.905 10.237-3.905 14.142 0Zm17.366-90.905c3.839 3.84 3.904 10.023.195 13.942l-.195.2-76.368 76.368c-3.905 3.905-10.237 3.905-14.142 0-3.839-3.84-3.904-10.023-.195-13.942l.195-.2 76.368-76.368c3.905-3.905 10.237-3.905 14.142 0ZM218.51 37.49c23.957 23.957 24.362 62.533 1.03 86.64l-.715.726-30.783 30.783c-3.905 3.905-10.237 3.905-14.142 0-3.839-3.84-3.904-10.023-.195-13.942l.195-.2 30.783-30.783c16.214-16.214 16.1-42.666-.315-59.082-16.252-16.251-42.34-16.525-58.592-.797l-.49.482L114.503 82.1c-3.905 3.905-10.237 3.905-14.142 0-3.839-3.84-3.904-10.023-.195-13.942l.195-.2 30.783-30.783c24.052-24.052 63.167-23.884 87.366.315Z" fill="currentColor" fillRule="nonzero"></path>
    </svg>
  );
}

/** 描述（云端 lake 原图：symbol #ne-t-image-title，viewBox 0 0 256 256）。 */
export function IconImageTitle({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <g fill="none" fillRule="evenodd"><rect stroke="currentColor" strokeWidth="20" x="38" y="38" width="180" height="84" rx="20"></rect><rect fill="currentColor" x="28" y="158" width="200" height="20" rx="10"></rect><rect fill="currentColor" x="28" y="208" width="120" height="20" rx="10"></rect></g>
    </svg>
  );
}

/** 对齐（云端 lake 原图：symbol #ne-t-alignment-center，viewBox 0 0 256 256）。 */
export function IconImageAlign({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <g fill="currentColor" fillRule="nonzero"><path d="M181 148c5.523 0 10 4.477 10 10 0 5.43-4.327 9.848-9.72 9.996L181 168H76c-5.523 0-10-4.477-10-10 0-5.43 4.327-9.848 9.72-9.996L76 148h105ZM218 89c5.523 0 10 4.477 10 10 0 5.43-4.327 9.848-9.72 9.996L218 109H38c-5.523 0-10-4.477-10-10 0-5.43 4.327-9.848 9.72-9.996L38 89h180ZM181 30c5.523 0 10 4.477 10 10 0 5.43-4.327 9.848-9.72 9.996L181 50H76c-5.523 0-10-4.477-10-10 0-5.43 4.327-9.848 9.72-9.996L76 30h105ZM218 207c5.523 0 10 4.477 10 10 0 5.43-4.327 9.848-9.72 9.996L218 227H38c-5.523 0-10-4.477-10-10 0-5.43 4.327-9.848 9.72-9.996L38 207h180Z"></path></g>
    </svg>
  );
}

/** 样式（云端 lake 原图：symbol #ne-t-image-style，viewBox 0 0 14 14）。 */
export function IconImageStyle({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path d="M8.563.75c.986 0 1.794.761 1.869 1.728l.002.084h.941c.986 0 1.795.762 1.87 1.729l.005.146v6.938c0 .986-.761 1.795-1.728 1.87l-.147.005H4.437a1.875 1.875 0 0 1-1.869-1.728l-.006-.147v-.941l-.084-.002A1.875 1.875 0 0 1 .756 8.709L.75 8.563V2.625c0-.986.761-1.795 1.728-1.87L2.625.75h5.938Zm.398 9.645L10.565 12l.81.001a.625.625 0 0 0 .618-.533l.007-.092v-.38l-1.707-1.708a1.879 1.879 0 0 1-1.332 1.108Zm-4.268.042h-.881v.938c0 .314.232.574.533.618l.093.007h1.817l-1.562-1.563Zm3.249 0H5.753L7.316 12h2.19l-1.564-1.563Zm2.495-4.255v2.189L12 9.934v-2.19l-1.563-1.562ZM8.563 2H2.625a.625.625 0 0 0-.618.533L2 2.625v5.938c0 .313.231.573.533.618l.03.002.062.005 1.877-.001h4.061a.625.625 0 0 0 .618-.532l.007-.092V2.625A.625.625 0 0 0 8.562 2Zm1.874 1.812v1.309L12 6.684V4.437a.625.625 0 0 0-.533-.618l-.092-.006-.938-.001Z" fill="currentColor" fillRule="nonzero"></path>
    </svg>
  );
}

/** 边距（云端 lake 原图：symbol #ne-c-tb-spacing，viewBox 0 0 256 256）。 */
export function IconImageSpacing({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <g fill="none" fillRule="evenodd"><rect fill="currentColor" x="28" y="22" width="28" height="28" rx="8"></rect><rect fill="currentColor" x="28" y="206" width="28" height="28" rx="8"></rect><rect fill="currentColor" x="85" y="22" width="28" height="28" rx="8"></rect><rect fill="currentColor" x="85" y="206" width="28" height="28" rx="8"></rect><rect fill="currentColor" x="143" y="22" width="28" height="28" rx="8"></rect><rect fill="currentColor" x="143" y="206" width="28" height="28" rx="8"></rect><rect fill="currentColor" x="200" y="22" width="28" height="28" rx="8"></rect><rect fill="currentColor" x="200" y="206" width="28" height="28" rx="8"></rect><rect stroke="currentColor" strokeWidth="20" x="38" y="78" width="180" height="100" rx="20"></rect></g>
    </svg>
  );
}

/** 批量应用（云端 lake 原图：symbol #ne-t-batch-apply，viewBox 0 0 14 14）。 */
export function IconImageBatch({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path d="M12.625 4.772c.34 0 .615.27.625.608v6.017a1.875 1.875 0 0 1-1.844 1.875H5.362a.625.625 0 0 1-.018-1.25h6.031c.34 0 .615-.27.625-.607V5.397c0-.345.28-.625.625-.625ZM6.875.75a.625.625 0 1 1 0 1.25h-4.25a.625.625 0 0 0-.618.533L2 2.625v6.25c0 .314.231.574.533.618l.092.007h6.25a.625.625 0 0 0 .618-.533l.007-.092V6.687l.007-.092a.625.625 0 0 1 1.243.093v-.001 2.188c0 .986-.761 1.795-1.728 1.87l-.147.005h-6.25a1.875 1.875 0 0 1-1.87-1.728L.75 8.875v-6.25c0-.986.761-1.795 1.728-1.87L2.625.75Zm4.285.92a.625.625 0 0 1 .038.87l-.013.014L6.9 7.09a1.25 1.25 0 0 1-1.791.026l-.017-.017-1.704-1.767a.625.625 0 0 1 .886-.881l.014.013 1.704 1.768 4.285-4.535a.625.625 0 0 1 .883-.025Z" fill="currentColor" fillRule="nonzero"></path>
    </svg>
  );
}
