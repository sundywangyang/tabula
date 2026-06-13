/**
 * 设计 token(与 apps/renderer/src/styles/global.css 同步)
 *
 * P6+ macOS 风格 token 镜像:
 * - 圆角: 4/6/10/14/20 (sm/md/lg/xl)
 * - 间距: 4/8/12/16/24/32
 * - 阴影: 4 档 (sm/md/lg/xl)
 * - 毛玻璃: 3 档 (sm/md/lg)
 * - 字体: SF Pro 优先系统栈
 */

export const tokens = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    xs: 4,
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
  },
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "PingFang SC", system-ui, sans-serif',
    mono: '"SF Mono", "JetBrains Mono", Menlo, Monaco, "Cascadia Code", Consolas, monospace',
    display: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
  },
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.2)',
    md: '0 4px 12px rgba(0, 0, 0, 0.18)',
    lg: '0 8px 24px rgba(0, 0, 0, 0.25)',
    xl: '0 16px 48px rgba(0, 0, 0, 0.35)',
  },
  blur: {
    sm: 'blur(12px) saturate(150%)',
    md: 'blur(20px) saturate(180%)',
    lg: 'blur(30px) saturate(200%)',
  },
  /** macOS 系统语义色 (用于 lucide 图标按类型着色) */
  fileTypeColor: {
    folder: '#007AFF',
    image: '#34c759',
    video: '#ff3b30',
    audio: '#af52de',
    archive: '#ff9500',
    exec: '#8e8e93',
    doc: '#5856d6',
    code: '#ff9500',
    text: '#aeaeb2',
    default: '#8e8e93',
  },
} as const;

export type Tokens = typeof tokens;
