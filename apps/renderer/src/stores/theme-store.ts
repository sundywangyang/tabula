/**
 * 主题 store (P5)
 *
 * 状态:
 * - mode: 'light' | 'dark' | 'system'  → 实际渲染时 resolve 为 'light' | 'dark'
 * - accentColor: 用户选的重点色 (#rrggbb)
 *
 * 持久化:
 * - mode → AppConfig.theme
 * - accentColor → AppConfig.accentColor
 *
 * 实际应用:
 * - 在 hydrate + 每次 mode 变化时:
 *   1. resolve 当前有效 mode
 *   2. document.documentElement.setAttribute('data-theme', effective)
 *   3. document.documentElement.style.setProperty('--accent', accentColor)
 * - 监听 window.matchMedia('(prefers-color-scheme: dark)'),mode='system' 时切换
 *
 * 切换零闪烁:CSS 变量替换不触发 layout;data-theme 切换也只重算根元素的派生变量。
 */
import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

export const DEFAULT_ACCENT_COLOR = '#007aff';

const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: '靛蓝', value: '#6366f1' },
  { name: '蓝色', value: DEFAULT_ACCENT_COLOR },
  { name: '紫色', value: '#a855f7' },
  { name: '粉色', value: '#ec4899' },
  { name: '橙色', value: '#f97316' },
  { name: '绿色', value: '#10b981' },
];

interface ThemeStore {
  mode: ThemeMode;
  /** 解析后的实际主题(在 hydrate 后与 mode 同步;监听系统主题时单独更新) */
  effective: EffectiveTheme;
  accentColor: string;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => void;
  setAccent: (color: string) => void;
  /** 内部:用于响应系统主题变化 */
  setEffective: (t: EffectiveTheme) => void;
}

function resolveSystem(): EffectiveTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function effectiveFor(mode: ThemeMode): EffectiveTheme {
  return mode === 'system' ? resolveSystem() : mode;
}

function applyTheme(effective: EffectiveTheme, accent: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', effective);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-contrast', accentContrast(accent));
  const selection = selectionBackground(accent);
  document.documentElement.style.setProperty('--selection-bg', selection);
  document.documentElement.style.setProperty('--selection-fg', accentContrast(selection));
}

/** 选中态略深于重点色,让默认 Finder 蓝可搭配清晰的白色文字。 */
function selectionBackground(accent: string): string {
  const hex = /^#([\da-f]{6})$/i.exec(accent)?.[1];
  if (!hex) return accent;
  return `#${[0, 2, 4].map((offset) =>
    Math.round(parseInt(hex.slice(offset, offset + 2), 16) * 0.9).toString(16).padStart(2, '0'),
  ).join('')}`;
}

/** 选择与用户重点色对比度更高的黑色或白色前景。 */
function accentContrast(accent: string): '#000000' | '#ffffff' {
  const hex = accent.replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(hex)) return '#ffffff';
  const linear = [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: 'system',
  effective: resolveSystem(),
  accentColor: DEFAULT_ACCENT_COLOR,
  hydrated: false,

  hydrate: async () => {
    try {
      const cfg = await window.tabula.config.all();
      const mode = cfg.theme === 'light' || cfg.theme === 'dark' ? cfg.theme : 'system';
      const accent = cfg.accentColor ?? DEFAULT_ACCENT_COLOR;
      const eff = effectiveFor(mode);
      set({ mode, accentColor: accent, effective: eff, hydrated: true });
      applyTheme(eff, accent);
    } catch (e) {
      console.warn('[theme-store] hydrate failed', e);
      const effective = resolveSystem();
      set({ mode: 'system', effective, accentColor: DEFAULT_ACCENT_COLOR, hydrated: true });
      applyTheme(effective, DEFAULT_ACCENT_COLOR);
    }
  },

  setMode: (mode) => {
    const eff = effectiveFor(mode);
    set({ mode, effective: eff });
    applyTheme(eff, get().accentColor);
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window.tabula.config.set as any)('theme', mode);
      } catch (e) {
        console.warn('[theme-store] persist theme failed', e);
      }
    })();
  },

  setAccent: (color) => {
    set({ accentColor: color });
    applyTheme(get().effective, color);
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window.tabula.config.set as any)('accentColor', color);
      } catch (e) {
        console.warn('[theme-store] persist accent failed', e);
      }
    })();
  },

  setEffective: (t) => {
    set({ effective: t });
    applyTheme(t, get().accentColor);
  },
}));

export { ACCENT_PRESETS };
