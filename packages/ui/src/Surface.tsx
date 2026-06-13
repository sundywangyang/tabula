/**
 * 毛玻璃 Surface 组件
 *
 * 用法:
 *   <Surface blur="md">content</Surface>
 *
 * 优先用 CSS 变量(--bg-translucent / --blur-md),支持 4 档模糊强度。
 */
import { type CSSProperties, type ReactNode } from 'react';

export type BlurLevel = 'sm' | 'md' | 'lg' | 'none';

export interface SurfaceProps {
  children: ReactNode;
  /** 模糊强度,默认 md (20px) */
  blur?: BlurLevel;
  /** 自定义类名 */
  className?: string;
  /** 内联样式 */
  style?: CSSProperties;
  /** 元素,默认 div */
  as?: 'div' | 'section' | 'aside' | 'header' | 'footer' | 'nav';
}

const blurMap: Record<BlurLevel, string> = {
  sm: 'var(--blur-sm)',
  md: 'var(--blur-md)',
  lg: 'var(--blur-lg)',
  none: 'none',
};

/**
 * 毛玻璃容器。继承父节点 color-scheme,自动暗/亮主题适配。
 * 降级:浏览器不支持 backdrop-filter 时,自动用纯色背景。
 */
export function Surface({
  children,
  blur = 'md',
  className = '',
  style,
  as: Tag = 'div',
}: SurfaceProps) {
  const blurValue = blurMap[blur];
  const isBlurSupported = blur !== 'none';
  return (
    <Tag
      className={`tabula-surface ${className}`.trim()}
      style={{
        background: 'var(--bg-translucent)',
        backdropFilter: isBlurSupported ? blurValue : 'none',
        WebkitBackdropFilter: isBlurSupported ? blurValue : 'none',
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
