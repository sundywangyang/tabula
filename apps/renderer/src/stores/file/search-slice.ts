import type { FileSlice } from './types';
import type { GlobalSearchHit, FileTypeFilter } from './types';
import { useLayoutStore } from '../layout-store';
import { getCachedRootPath } from '../../platform-cache';
import { findPaneInLayout } from './paths';

// =================== P4: 全局搜索过滤 ===================

/**
 * 模糊匹配:query 中所有字符按顺序在 name 中出现即命中(大小写不敏感)。
 * 也支持子串匹配(更宽松,作为 fallback)。
 * 评分:子串匹配优先,模糊匹配次之。
 */
function scoreMatch(name: string, q: string): number {
  if (!q) return 0;
  const n = name.toLowerCase();
  const ql = q.toLowerCase();
  if (n === ql) return 1000;
  if (n.startsWith(ql)) return 500;
  if (n.includes(ql)) return 100;
  // 模糊:ql 字符按顺序在 n 中全部出现
  let i = 0;
  for (const ch of n) {
    if (ch === ql[i]) i++;
    if (i === ql.length) return 10;
  }
  return -1;
}

function filterGlobalHits(entries: GlobalSearchHit[], query: string): GlobalSearchHit[] {
  if (!query) {
    // 没输入:返回前 200 项
    return entries.slice(0, 200);
  }
  const scored = entries
    .map((e) => ({ e, s: scoreMatch(e.name, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, 200).map((x) => x.e);
}

type Actions =
  | 'openGlobalSearch'
  | 'runGlobalSearch'
  | 'closeGlobalSearch'
  | 'setGlobalSearchQuery'
  | 'setGlobalSearchFileType'
  | 'setGlobalSearchSelectedIndex'
  | 'setGlobalSearchPage'
  | 'recomputeGlobalResults';

export const createSearchSlice: FileSlice<Actions> = (set, get) => ({
  // ============ P4: 全局搜索 (Ctrl+P / Ctrl+Shift+F) ============
  openGlobalSearch: async () => {
    // 获取当前 pane 的路径作为搜索根目录
    const layout = useLayoutStore.getState();
    const activePaneId = layout.activePaneId;
    const paneNode = findPaneInLayout(layout.rootLayout, activePaneId);
    const rootPath = paneNode?.type === 'pane'
      ? get().getPanePath(activePaneId) || getCachedRootPath()
      : getCachedRootPath();

    set({
      globalSearch: {
        open: true,
        query: '',
        fileType: 'all',
        rootPath,
        scannedDrives: [rootPath],
        scanning: false,
        scanError: null,
        entries: [],
        results: [],
        selectedIndex: 0,
        page: 0,
        pageSize: 100,
        elapsedMs: 0,
      },
    });
  },

  /** P4 v1: 执行递归搜索 */
  runGlobalSearch: async (query: string, rootPath: string, fileType: FileTypeFilter) => {
    if (!query || query.trim().length === 0) {
      set((s) => ({
        globalSearch: {
          ...s.globalSearch,
          entries: [],
          results: [],
          elapsedMs: 0,
        },
      }));
      return;
    }

    set((s) => ({
      globalSearch: { ...s.globalSearch, scanning: true, scanError: null },
    }));

    const res = await window.tabula.fs.search({
      path: rootPath,
      query: query.trim(),
      maxResults: 500,
      fileType,
      maxDepth: 5,
    });

    if (!res.ok) {
      set((s) => ({
        globalSearch: {
          ...s.globalSearch,
          scanning: false,
          scanError: res.error.message,
        },
      }));
      return;
    }

    const entries: GlobalSearchHit[] = res.data.entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      size: e.size,
      mtime: e.mtime,
      driveRoot: rootPath,
      score: e.score,
      matchType: e.matchType,
    }));

    set((s) => ({
      globalSearch: {
        ...s.globalSearch,
        scanning: false,
        entries,
        results: entries,
        selectedIndex: 0,
        page: 0,
        elapsedMs: res.data.elapsedMs,
      },
    }));
  },

  closeGlobalSearch: () => {
    set((s) => ({ globalSearch: { ...s.globalSearch, open: false, query: '' } }));
  },

  setGlobalSearchQuery: (q) => {
    const cur = get().globalSearch;
    // 如果有 query 且和之前不同,触发递归搜索
    if (q.trim() && q.trim() !== cur.query) {
      void get().runGlobalSearch(q.trim(), cur.rootPath || getCachedRootPath(), cur.fileType);
    }
    set({
      globalSearch: {
        ...cur,
        query: q,
        selectedIndex: 0,
      },
    });
  },

  setGlobalSearchFileType: (fileType: FileTypeFilter) => {
    const cur = get().globalSearch;
    // 重新搜索
    if (cur.query.trim()) {
      void get().runGlobalSearch(cur.query, cur.rootPath || getCachedRootPath(), fileType);
    }
    set({
      globalSearch: {
        ...cur,
        fileType,
        selectedIndex: 0,
      },
    });
  },

  setGlobalSearchSelectedIndex: (idx) => {
    const cur = get().globalSearch;
    if (cur.results.length === 0) return;
    const clamped = Math.max(0, Math.min(cur.results.length - 1, idx));
    set({ globalSearch: { ...cur, selectedIndex: clamped } });
  },

  setGlobalSearchPage: (page: number) => {
    const cur = get().globalSearch;
    const maxPage = Math.max(0, Math.ceil(cur.results.length / cur.pageSize) - 1);
    set({ globalSearch: { ...cur, page: Math.max(0, Math.min(maxPage, page)) } });
  },

  recomputeGlobalResults: () => {
    const cur = get().globalSearch;
    set({
      globalSearch: {
        ...cur,
        results: filterGlobalHits(cur.entries, cur.query),
      },
    });
  }
});
