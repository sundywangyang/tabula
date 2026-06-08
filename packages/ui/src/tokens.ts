/**
 * 设计 token(与 apps/renderer/src/styles/global.css 同步)
 * P5 主题系统会扩
 */
export const tokens = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 10,
  },
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui',
    mono: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
  },
} as const;
