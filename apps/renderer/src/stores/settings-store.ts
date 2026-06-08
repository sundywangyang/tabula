/**
 * 设置 store (P5)
 *
 * 集中管理所有用户偏好设置,独立于 theme-store。
 *
 * 设置项:
 * - theme (同步到 theme-store)
 * - accentColor (同步到 theme-store)
 * - showHidden
 * - showExtensions
 * - sortBy / sortDir
 * - confirmDelete
 * - language
 *
 * 持久化:全部通过 window.tabula.config.* 读写 electron-store。
 *
 * 实时生效:Zustand subscription → 对应的 consumer store 更新。
 */
import { create } from 'zustand';
import type { ThemeMode } from './theme-store';
import { useThemeStore } from './theme-store';

export type SortField = 'name' | 'size' | 'mtime' | 'type';
export type SortDir = 'asc' | 'desc';
export type Language = 'zh-CN' | 'en-US';
export type DefaultView = 'list' | 'grid' | 'details';

export interface SettingsState {
  theme: ThemeMode;
  accentColor: string;
  showHidden: boolean;
  showExtensions: boolean;
  sortBy: SortField;
  sortDir: SortDir;
  confirmDelete: boolean;
  language: Language;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setTheme: (v: ThemeMode) => void;
  setAccent: (v: string) => void;
  setShowHidden: (v: boolean) => void;
  setShowExtensions: (v: boolean) => void;
  setSortBy: (v: SortField) => void;
  setSortDir: (v: SortDir) => void;
  setConfirmDelete: (v: boolean) => void;
  setLanguage: (v: Language) => void;
}

async function persist(key: string, value: unknown) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window.tabula.config.set as any)(key, value);
  } catch (e) {
    console.warn('[settings-store] persist failed', key, e);
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'system',
  accentColor: '#6366f1',
  showHidden: false,
  showExtensions: true,
  sortBy: 'name',
  sortDir: 'asc',
  confirmDelete: true,
  language: 'zh-CN',
  hydrated: false,

  hydrate: async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg = await (window.tabula.config.all as any)();
      const theme = cfg.theme ?? 'system';
      const accentColor = cfg.accentColor ?? '#6366f1';
      set({
        theme,
        accentColor,
        showHidden: cfg.showHidden ?? false,
        showExtensions: cfg.showExtensions ?? true,
        sortBy: cfg.sortBy ?? 'name',
        sortDir: cfg.sortDir ?? 'asc',
        confirmDelete: cfg.confirmDelete ?? true,
        language: cfg.language ?? 'zh-CN',
        hydrated: true,
      });
      // 同步 theme store
      useThemeStore.getState().setMode(theme);
      useThemeStore.getState().setAccent(accentColor);
    } catch (e) {
      console.warn('[settings-store] hydrate failed', e);
      set({ hydrated: true });
    }
  },

  setTheme: (v) => {
    set({ theme: v });
    void persist('theme', v);
  },

  setAccent: (v) => {
    set({ accentColor: v });
    void persist('accentColor', v);
  },

  setShowHidden: (v) => {
    set({ showHidden: v });
    void persist('showHidden', v);
  },

  setShowExtensions: (v) => {
    set({ showExtensions: v });
    void persist('showExtensions', v);
  },

  setSortBy: (v) => {
    set({ sortBy: v });
    void persist('sortBy', v);
  },

  setSortDir: (v) => {
    set({ sortDir: v });
    void persist('sortDir', v);
  },

  setConfirmDelete: (v) => {
    set({ confirmDelete: v });
    void persist('confirmDelete', v);
  },

  setLanguage: (v) => {
    set({ language: v });
    void persist('language', v);
  },
}));
