/** 主窗口与启动屏共用的启动主题,保持原生底色与渲染层一致。 */
import { nativeTheme } from 'electron';
import { getConfig } from '../../store/config';

export interface WindowAppearance {
  theme: 'light' | 'dark';
  background: string;
  elevated: string;
  foreground: string;
  secondary: string;
  separator: string;
  accent: string;
}

export function getWindowAppearance(): WindowAppearance {
  const systemTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  let theme: 'light' | 'dark' = systemTheme;
  let accent = '#007aff';
  try {
    const preference = getConfig('theme');
    if (preference === 'light' || preference === 'dark') theme = preference;
    const savedAccent = getConfig('accentColor');
    // 启动屏将颜色插入 HTML,只接受配置契约支持的十六进制颜色。
    if (savedAccent && /^#[\da-f]{6}$/i.test(savedAccent)) accent = savedAccent;
  } catch (error) {
    theme = systemTheme;
    console.warn('[appearance] config unavailable, following system theme', error);
  }
  const dark = theme === 'dark';
  return {
    theme,
    background: dark ? '#1e1e1e' : '#ffffff',
    elevated: dark ? '#292929' : '#f3f3f3',
    foreground: dark ? '#f5f5f7' : '#1d1d1f',
    secondary: dark ? '#a1a1a6' : '#6e6e73',
    separator: dark ? '#424242' : '#dedede',
    accent,
  };
}
