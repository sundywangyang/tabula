/**
 * 收藏 + 历史 store (P5)
 *
 * 状态:
 * - favorites: 收藏列表(用户主动 ☆ 的目录)
 * - history:   最近访问过的目录(去重 + 上限 50)
 *
 * 持久化:
 * - 走 electron-store,通过 window.tabula.config.set('favorites' | 'history', ...)
 * - 但 AppConfig 的 type 没列 favorites/history,所以 renderer 这边用一个
 *   旁路通道:存到 cfg:favorites / cfg:history 走 'extensionsDir' 之外的任意 key
 *   实际上 electron-store 接受任意 string key,所以这里直接 cfg:set('favorites', ...)
 *   不需要在 AppConfig 类型上扩展(因为 IPC API 是 generic)。
 *
 * 注意:
 * - 此 store 持有的是 renderer 侧状态;rehydrate 在 App 启动时调一次。
 * - recordVisit 在 loadDir 成功时被调(在 file-store.loadDir 里 dispatch 一个事件,
 *   或者由 PaneView/TabBar 在路径变更时调)。本 store 提供 recordVisit() 让 UI 主动调。
 */
import { create } from 'zustand';

export interface FavoriteItem {
  id: string;
  path: string;
  label: string;
  addedAt: number;
}

export interface HistoryItem {
  path: string;
  visitedAt: number;
}

const FAVORITES_KEY = 'favorites';
const HISTORY_KEY = 'history';
const HISTORY_MAX = 100;

interface FavoritesStore {
  favorites: FavoriteItem[];
  history: HistoryItem[];
  /** 是否已经从持久化恢复完成 */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;

  // Favorites
  addFavorite: (path: string, label?: string) => FavoriteItem | null;
  removeFavorite: (path: string) => void;
  renameFavorite: (path: string, newLabel: string) => void;
  reorderFavorites: (from: number, to: number) => void;
  isFavorite: (path: string) => boolean;
  /** 切换(已收藏则删,未收藏则加) */
  toggleFavorite: (path: string, label?: string) => boolean;

  // History
  recordVisit: (path: string) => void;
  clearHistory: () => void;
}

function genId(): string {
  return `fav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultLabel(p: string): string {
  // 末段作为 label
  const m = p.match(/[^\\\/]+$/);
  if (m) return m[0] || p;
  return p || '(根)';
}

async function persistK(key: string, value: unknown): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window.tabula.config.set as any)(key, value);
  } catch (e) {
    console.warn('[favorites-store] persist failed', key, e);
  }
}

async function loadK<T>(key: string, fallback: T): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = await (window.tabula.config.get as any)(key);
    if (v === undefined || v === null) return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  favorites: [],
  history: [],
  hydrated: false,

  hydrate: async () => {
    const favs = await loadK<FavoriteItem[]>(FAVORITES_KEY, []);
    const hist = await loadK<HistoryItem[]>(HISTORY_KEY, []);
    set({
      favorites: Array.isArray(favs) ? favs : [],
      history: Array.isArray(hist) ? hist.slice(0, HISTORY_MAX) : [],
      hydrated: true,
    });
  },

  persist: async () => {
    const { favorites, history } = get();
    await persistK(FAVORITES_KEY, favorites);
    await persistK(HISTORY_KEY, history);
  },

  addFavorite: (path, label) => {
    if (!path) return null;
    const trimmed = label?.trim() || defaultLabel(path);
    const cur = get().favorites;
    if (cur.some((f) => f.path === path)) {
      // 已存在:更新 label(如果提供了新 label)
      if (label && label.trim()) {
        const updated = cur.map((f) => (f.path === path ? { ...f, label: trimmed } : f));
        set({ favorites: updated });
        void get().persist();
      }
      return cur.find((f) => f.path === path) ?? null;
    }
    const item: FavoriteItem = {
      id: genId(),
      path,
      label: trimmed,
      addedAt: Date.now(),
    };
    set({ favorites: [...cur, item] });
    void get().persist();
    return item;
  },

  removeFavorite: (path) => {
    set({ favorites: get().favorites.filter((f) => f.path !== path) });
    void get().persist();
  },

  renameFavorite: (path, newLabel) => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    set({
      favorites: get().favorites.map((f) => (f.path === path ? { ...f, label: trimmed } : f)),
    });
    void get().persist();
  },

  reorderFavorites: (from, to) => {
    const cur = get().favorites;
    if (from < 0 || from >= cur.length || to < 0 || to >= cur.length) return;
    if (from === to) return;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    set({ favorites: next });
    void get().persist();
  },

  isFavorite: (path) => {
    return get().favorites.some((f) => f.path === path);
  },

  toggleFavorite: (path, label) => {
    const exists = get().favorites.some((f) => f.path === path);
    if (exists) {
      get().removeFavorite(path);
      return false;
    }
    get().addFavorite(path, label);
    return true;
  },

  recordVisit: (path) => {
    if (!path) return;
    const now = Date.now();
    const cur = get().history;
    // 去重:同 path 提到最前
    const filtered = cur.filter((h) => h.path !== path);
    const next: HistoryItem[] = [{ path, visitedAt: now }, ...filtered].slice(0, HISTORY_MAX);
    set({ history: next });
    void persistK(HISTORY_KEY, next);
  },

  clearHistory: () => {
    set({ history: [] });
    void persistK(HISTORY_KEY, []);
  },
}));
