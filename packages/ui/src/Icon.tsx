/**
 * 统一 lucide 图标包装
 *
 * 统一 strokeWidth、颜色继承、size 语义。
 * 不强制 React 依赖 — 通过 props 类型让消费者传入 lucide 组件。
 */
import { type ComponentType, type SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** lucide 图标组件(运行时从 lucide-react 传入) */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** 图标尺寸(px),默认 16 */
  size?: number;
  /** 描边宽度(默认 1.75,macOS 风格) */
  strokeWidth?: number;
}

/**
 * 统一风格的 lucide 图标包装:
 * - strokeWidth=1.75 (macOS Big Sur+ 视觉重量)
 * - 颜色用 currentColor
 * - 尺寸统一用 size
 */
export function Icon({
  icon: IconComponent,
  size = 16,
  strokeWidth = 1.75,
  ...rest
}: IconProps) {
  return (
    <IconComponent
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      color="currentColor"
      {...rest}
    />
  );
}
