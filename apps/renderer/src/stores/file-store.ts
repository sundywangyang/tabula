/**
 * 全局文件状态(P2: 按 paneId 分片)
 *
 * 按职责组合 selection / preview / search / trash / thumbnail / archive slices。
 * P1: 视图模式 + 排序 + 多选 + 键盘导航 + 显示选项 + 重命名 + 路径补全
 * P2: 数据按 paneId 区分;layout-store 持有 LayoutNode 树 + activePaneId
 * P3: 剪贴板(copy/cut/paste)、拖放状态、toast、进度、新建/批量删除/重名冲突
 *
 * 共享(view / sort / 隐藏选项 / clipboard / dragState / toast / progress)
 * 走全局;每 pane 独立的数据
 * (currentPath / entries / selectedPaths / cursorPath / renameTarget / pathBar*)
 * 走 panes[paneId] 分片。
 */
import { create } from 'zustand';
import type { AppConfig } from '@tabula/bridge';
import { useLayoutStore } from './layout-store';
import type { FileStore, ViewMode, SortDir, SortField, ConflictItem } from './file/types';
import { emptyPaneData } from './file/pane-data';
import { pathToBreadcrumb, joinPath, parentPath, basename, findPaneInLayout, sameFilePath } from './file/paths';
import { displayEntries } from './file/view-selectors';
import { createSelectionSlice } from './file/selection-slice';
import { createPreviewSlice } from './file/preview-slice';
import { createSearchSlice } from './file/search-slice';
import { createTrashSlice } from './file/trash-slice';
import { createThumbnailSlice } from './file/thumbnail-slice';
import { createArchiveSlice } from './file/archive-slice';

export { makeFolderTab } from './folder-tab';
export type {
  BreadcrumbSegment,
  ViewMode,
  SortField,
  SortDir,
  GroupByMode,
  GroupSection,
  ClipboardState,
  DragState,
  ToastItem,
  ProgressInfo,
  ConflictItem,
  ConflictResolution,
  PendingConflicts,
  PaneFileData,
  PreviewState,
  GlobalSearchHit,
  GlobalSearchState,
  FileTypeFilter,
  ThumbnailEntry,
  FileStore,
} from './file/types';
export { groupEntries } from './file/view-selectors';
export { THUMBNAIL_EXTS, isThumbnailable } from './file/thumbnail-slice';

const VIEW_KEY = 'defaultView';
const SORTBY_KEY = 'sortBy';
const SORTDIR_KEY = 'sortDir';
const HIDDEN_KEY = 'showHidden';
const EXT_KEY = 'showExtensions';

async function persistConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
  try {
    await window.tabula.config.set(key, value);
  } catch (e) {
    console.warn('[file-store] persist failed', key, e);
  }
}

// =================== Store ===================

export const useFileStore = create<FileStore>((set, get, store) => {
  let nextDirectoryRequest = 0;
  const directoryRequests = new Map<string, number>();
  const refreshAffected = async (sources: string[], destination: string) => {
    const normalize = (path: string) => {
      const normalized = path.replace(/[\\/]+/g, '/').replace(/\/$/, '');
      return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
    };
    const directories = new Set([destination, ...sources.map(parentPath)].map(normalize));
    await Promise.all(Object.entries(get().panes)
      .filter(([, data]) => directories.has(normalize(data.currentPath)))
      .map(([id]) => get().refresh(id)));
  };

  return {
    // 视图(共享)
    sortBy: 'name',
    thumbnailSize: 64,
    setThumbnailSize: (value) => { const size = Math.max(40, Math.min(160, Math.round(value))); set({ thumbnailSize: size }); void persistConfig('thumbnailSize', size); },
    setFileType: (paneId, fileType) => set(s => ({ panes: { ...s.panes, [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), fileType, selectedPaths: new Set(), cursorPath: null } } })),
    revealInPane: async (paneId, path) => {
      const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      if (slash < 0) return;
      const parent = slash === 0 ? path.slice(0, 1) : /^[a-z]:$/i.test(path.slice(0, slash)) ? path.slice(0, slash + 1) : path.slice(0, slash);
      await useLayoutStore.getState().pane.navigate(paneId, parent);
      set(s => ({ panes: { ...s.panes, [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchQuery: '', fileType: 'all' } }, ...(path.slice(slash + 1).startsWith('.') ? { showHidden: true } : {}) }));
      get().selectOne(paneId, path);
      useLayoutStore.getState().pane.focusPane(paneId);
    },
    sortDir: 'asc',
    showHidden: false,
    showExtensions: true,

    // 路径栏
    pathBarOpen: false,
    pathBarTargetPaneId: null,
    pathBarValue: '',
    pathBarError: null,
    pathBarCompletions: [],

    // P3
    clipboard: null,
    dragState: null,
    toasts: [],
    progress: null,
    pendingConflicts: null,

    // P4
    previewState: null,
    globalSearch: {
      open: false,
      query: '',
      fileType: 'all',
      rootPath: '',
      scannedDrives: [],
      scanning: false,
      scanError: null,
      entries: [],
      results: [],
      selectedIndex: 0,
      page: 0,
      pageSize: 100,
      elapsedMs: 0,
    },

    // P3: 回收站
    trashItems: [],
    trashLoading: false,
    trashError: null,
    trashSelectedPaths: new Set(),

    // P7: 缩略图缓存
    thumbnails: new Map(),
    thumbnailLoading: new Set(),

    // Archive (压缩 / 解压)
    archiveJobs: new Map(),
    archiveToasts: new Map(),
    archivePaneIds: new Map(),

    // panes
    panes: {},

    // ============ Pane 数据生命周期 ============
    ensurePane: async (paneId) => {
      if (!get().panes[paneId]) {
        // Publish the shell before awaiting configuration, so concurrent loads share it.
        set((s) => ({ panes: { ...s.panes, [paneId]: emptyPaneData() } }));
        // 尝试从持久化配置读 viewMode 默认值(没有则用 'details')
        let defaultView: ViewMode = 'details';
        try {
          const all = await window.tabula.config.all();
          if (all.defaultView) defaultView = all.defaultView as ViewMode;
        } catch {
          /* noop */
        }
        set((s) => {
          const data = s.panes[paneId];
          if (!data || data.viewMode !== 'details') return s;
          return { panes: { ...s.panes, [paneId]: { ...data, viewMode: defaultView } } };
        });
      }
    },

    removePaneData: (paneId) => {
      directoryRequests.delete(paneId);
      set((s) => {
        if (!(paneId in s.panes)) return s;
        const next = { ...s.panes };
        delete next[paneId];
        return { panes: next };
      });
    },

    clearPaneDirectory: (paneId) => {
      directoryRequests.delete(paneId);
      set((s) => {
        const data = s.panes[paneId];
        if (!data) return s;
        return { panes: { ...s.panes, [paneId]: { ...emptyPaneData(), viewMode: data.viewMode, groupBy: data.groupBy, fileType: data.fileType } } };
      });
    },

    // ============ 目录 ============
    loadDir: async (paneId, path) => {
      const request = ++nextDirectoryRequest;
      directoryRequests.set(paneId, request);
      // 无 active tab 时自动建一个 tab 再加载
      const layout = useLayoutStore.getState();
      const paneNode = findPaneInLayout(layout.rootLayout, paneId);
      if (paneNode?.type === 'pane' && !paneNode.activeTabId) {
        const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
        useLayoutStore.getState().pane.openTab(paneId, {
          id: tabId,
          type: 'folder',
          title,
          path,
          pinned: false,
          closable: true,
          history: [path],
          historyIndex: 0,
        });
      }
      get().ensurePane(paneId);
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: {
            ...(s.panes[paneId] ?? emptyPaneData()),
            loading: true,
            error: null,
            currentPath: path,
            entries: [],
            breadcrumb: pathToBreadcrumb(path),
            selectedPaths: new Set(),
            cursorPath: null,
            lastClickedPath: null,
            renameTarget: null,
            searchQuery: '',
            searchOpen: false,
          },
        },
      }));
      let result;
      try {
        result = await window.tabula.fs.listDir(path);
      } catch (error) {
        result = { ok: false as const, error: { message: String(error) } };
      }
      if (directoryRequests.get(paneId) !== request || get().panes[paneId]?.currentPath !== path) return;
      if (result.ok) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), entries: result.data.entries, loading: false },
          },
        }));
      } else {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), loading: false, error: result.error.message, entries: [] },
          },
        }));
      }
    },

    refresh: async (paneId) => {
      const data = get().panes[paneId];
      if (!data || !data.currentPath) return;
      const request = ++nextDirectoryRequest;
      directoryRequests.set(paneId, request);
      let result;
      try {
        result = await window.tabula.fs.listDir(data.currentPath);
      } catch (error) {
        result = { ok: false as const, error: { message: String(error) } };
      }
      if (directoryRequests.get(paneId) !== request || get().panes[paneId]?.currentPath !== data.currentPath) return;
      if (result.ok) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...s.panes[paneId], entries: result.data.entries, loading: false, error: null, selectedPaths: new Set() },
          },
        }));
      } else {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...s.panes[paneId], loading: false, error: result.error.message },
          },
        }));
      }
    },

    // ============ 视图(per-pane) ============
    setViewMode: (paneId, mode) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), viewMode: mode },
        },
      }));
      void persistConfig(VIEW_KEY, mode); // 持久化最后一个切换的视图模式(新 pane 默认值)
    },

    // G007: 设置 pane 的分组模式(per-pane;v1 不持久化,UI 渲染延后实现)
    setGroupBy: (paneId, mode) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), groupBy: mode },
        },
      }));
    },

    cycleSort: (field) => {
      const { sortBy, sortDir } = get();
      let nextDir: SortDir;
      if (sortBy !== field) {
        nextDir = 'asc';
      } else {
        if (sortDir === 'asc') nextDir = 'desc';
        else if (sortDir === 'desc') nextDir = null;
        else nextDir = 'asc';
      }
      set({ sortBy: field, sortDir: nextDir });
      void persistConfig(SORTBY_KEY, field);
      void persistConfig(SORTDIR_KEY, nextDir);
    },

    toggleShowHidden: () => {
      const v = !get().showHidden;
      set({ showHidden: v });
      void persistConfig(HIDDEN_KEY, v);
    },

    toggleShowExtensions: () => {
      const v = !get().showExtensions;
      set({ showExtensions: v });
      void persistConfig(EXT_KEY, v);
    },

    hydrateFromConfig: async () => {
      try {
        const all = await window.tabula.config.all();
        set({
          sortBy: (all.sortBy ?? 'name') as SortField,
          sortDir: (all.sortDir !== undefined ? all.sortDir : 'asc') as SortDir,
          showHidden: all.showHidden ?? false,
          showExtensions: all.showExtensions ?? true,
          thumbnailSize: Math.max(40, Math.min(160, all.thumbnailSize ?? 64)),
        });
      } catch (e) {
        console.warn('[file-store] hydrate failed', e);
      }
    },

    ...createSelectionSlice(set, get, store),

    // ============ 重命名 ============
    beginRename: (paneId, path) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: path },
        },
      }));
    },

    endRename: (paneId) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: null },
        },
      }));
    },

    renameEntry: async (paneId, oldPath, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) {
        const msg = '重命名失败: 名称不能为空';
        get().showToast(msg, 'error', 4000);
        return { ok: false, error: msg };
      }
      const oldName = basename(oldPath);
      if (trimmed === oldName) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: null },
          },
        }));
        return { ok: true };
      }
      const data = get().panes[paneId];
      const parent = parentPath(oldPath);
      const newPath = joinPath(parent, trimmed);
      // POSIX rename(2) 在目标已存在时静默覆盖 — 必须 stat 预检
      // 注意:排除"自己改自己名"的情况(trimmed === oldName 已上面拦截,但 basename
      // 大小写敏感的 FS 上 case-only rename 是允许的,这里也放过)
      if (newPath !== oldPath) {
        const exists = await window.tabula.fs.stat(newPath);
        if (exists.ok) {
          const msg = `重命名失败: 已存在同名项 "${trimmed}"`;
          get().showToast(msg, 'error', 4000);
          return { ok: false, error: msg };
        }
      }
      const res = await window.tabula.fs.rename(oldPath, newPath);
      if (!res.ok) {
        const msg = `重命名失败: ${res.error.message}`;
        get().showToast(msg, 'error', 4000);
        return { ok: false, error: msg };
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: null },
        },
      }));
      if (data?.currentPath) {
        await get().refresh(paneId);
      }
      return { ok: true };
    },

    // ============ 删除 ============
    deleteSelected: async (paneId) => {
      const data = get().panes[paneId];
      if (!data) return { ok: true, count: 0 };
      const { selectedPaths, currentPath } = data;
      if (selectedPaths.size === 0) return { ok: true, count: 0 };
      const paths = Array.from(selectedPaths);
      const filtered = paths.filter((p) => p !== currentPath);
      if (filtered.length === 0) return { ok: false, error: '不能删除当前目录', count: 0 };
      const res = await window.tabula.fs.delete(filtered, true);
      if (!res.ok) {
        return { ok: false, error: res.error.message, count: filtered.length };
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(), cursorPath: null },
        },
      }));
      await get().refresh(paneId);
      return { ok: true, count: filtered.length };
    },

    // ============ P3: 永久删除(不走回收站)============
    permanentDelete: async (paneId, paths) => {
      if (!paths || paths.length === 0) return { ok: true, count: 0 };
      const data = get().panes[paneId];
      const currentPath = data?.currentPath ?? '';
      const filtered = paths.filter((p) => p !== currentPath);
      if (filtered.length === 0) return { ok: false, error: '不能删除当前目录', count: 0 };
      // useTrash = false 永久删除
      const res = await window.tabula.fs.delete(filtered, false);
      if (!res.ok) {
        get().showToast(`永久删除失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message, count: filtered.length };
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(), cursorPath: null },
        },
      }));
      await get().refresh(paneId);
      get().showToast(`已永久删除 ${filtered.length} 项`, 'success', 2500);
      return { ok: true, count: filtered.length };
    },

    // ============ 路径栏 ============
    openPathBar: (paneId, initial) => {
      const data = get().panes[paneId];
      set({
        pathBarOpen: true,
        pathBarTargetPaneId: paneId,
        pathBarValue: initial ?? data?.currentPath ?? '',
        pathBarError: null,
        pathBarCompletions: [],
      });
    },

    closePathBar: () => {
      set({ pathBarOpen: false, pathBarValue: '', pathBarError: null, pathBarCompletions: [] });
    },

    setPathBarValue: (value) => {
      set({ pathBarValue: value, pathBarError: null, pathBarCompletions: [] });
    },

    completePathBar: () => {
      const { pathBarValue, pathBarTargetPaneId } = get();
      if (!pathBarValue) return;
      const m = pathBarValue.match(/^(.*[\\/])([^\\/]*)$/);
      let base: string;
      let prefix: string;
      if (m) {
        base = m[1]!;
        prefix = m[2]!.toLowerCase();
      } else {
        if (/^[a-zA-Z]:$/.test(pathBarValue)) {
          base = pathBarValue + '\\';
          prefix = '';
        } else {
          const cur = pathBarTargetPaneId ? get().panes[pathBarTargetPaneId]?.currentPath : '';
          base = cur ?? '';
          prefix = pathBarValue.toLowerCase();
        }
      }
      void (async () => {
        const res = await window.tabula.fs.listDir(base);
        if (!res.ok) {
          set({ pathBarError: res.error.message, pathBarCompletions: [] });
          return;
        }
        const dirs = res.data.entries
          .filter((e) => e.isDirectory && (prefix === '' || e.name.toLowerCase().startsWith(prefix)))
          .map((e) => joinPath(base, e.name));
        if (dirs.length === 0) {
          set({ pathBarError: '没有匹配的目录', pathBarCompletions: [] });
          return;
        }
        if (dirs.length === 1) {
          set({ pathBarValue: dirs[0] + '\\', pathBarCompletions: dirs, pathBarError: null });
          return;
        }
        const names = dirs.map((p) => basename(p));
        const minLen = Math.min(...names.map((n) => n.length));
        let common = '';
        for (let i = 0; i < minLen; i++) {
          const c = names[0]![i]!.toLowerCase();
          if (names.every((n) => n[i]!.toLowerCase() === c)) common += names[0]![i];
          else break;
        }
        const newValue =
          common.length > prefix.length ? joinPath(base, common) : pathBarValue;
        set({
          pathBarValue: newValue,
          pathBarCompletions: dirs,
          pathBarError: common.length > prefix.length ? null : `候选 ${dirs.length} 项(再次 Tab 切换)`,
        });
      })();
    },

    submitPathBar: async () => {
      const { pathBarValue, pathBarCompletions, pathBarTargetPaneId } = get();
      let target = pathBarValue.trim();
      if (!target) {
        set({ pathBarError: '路径不能为空' });
        return;
      }
      if (pathBarCompletions.length > 0 && target.endsWith('\\') === false && target.endsWith('/') === false) {
        const first = pathBarCompletions[0];
        if (first?.toLowerCase().startsWith(target.toLowerCase())) {
          target = first;
        }
      }
      const res = await window.tabula.fs.listDir(target);
      if (!res.ok) {
        set({ pathBarError: res.error.message });
        return;
      }
      set({ pathBarOpen: false, pathBarValue: '', pathBarError: null, pathBarCompletions: [] });
      if (pathBarTargetPaneId) {
        await useLayoutStore.getState().pane.navigate(pathBarTargetPaneId, target);
      }
    },

    // ============ 过滤+排序输出 ============
    getFilteredSortedEntries: (paneId) => {
      const data = get().panes[paneId];
      if (!data) return [];
      const { sortBy, sortDir, showHidden } = get();
      return displayEntries(data, { sortBy, sortDir, showHidden });
    },

    // ============ P3: 工具 - 取 pane 路径 ============
    getPanePath: (paneId) => {
      return get().panes[paneId]?.currentPath ?? '';
    },

    getPanePathByLayout: (paneId) => {
      // 走 file-store 缓存的 currentPath(loadDir 同步)
      // 不再回退 layout-store(避免循环 import)
      return get().panes[paneId]?.currentPath ?? null;
    },

    // ============ P3: 剪贴板 ============
    copySelected: (paneId) => {
      const data = get().panes[paneId];
      if (!data || data.selectedPaths.size === 0) {
        get().showToast('未选中任何项', 'warn');
        return;
      }
      const paths = Array.from(data.selectedPaths);
      set({ clipboard: { mode: 'copy', paths, sourcePaneId: paneId } });
      // 顺便写系统剪贴板(纯文本,每行一个路径)
      void navigator.clipboard?.writeText(paths.join('\n')).catch(() => null);
      get().showToast(`已复制 ${paths.length} 项(可粘贴)`, 'info', 2000);
    },

    cutSelected: (paneId) => {
      const data = get().panes[paneId];
      if (!data || data.selectedPaths.size === 0) {
        get().showToast('未选中任何项', 'warn');
        return;
      }
      const paths = Array.from(data.selectedPaths);
      set({ clipboard: { mode: 'cut', paths, sourcePaneId: paneId } });
      void navigator.clipboard?.writeText(paths.join('\n')).catch(() => null);
      get().showToast(`已剪切 ${paths.length} 项(Ctrl+V 粘贴)`, 'info', 2000);
    },

    clearClipboard: () => {
      set({ clipboard: null });
    },

    // ============ P3: 粘贴 ============
    pasteToPane: async (paneId) => {
      const cb = get().clipboard;
      if (!cb || cb.paths.length === 0) {
        get().showToast('剪贴板为空', 'warn');
        return;
      }
      const destDir = get().getPanePath(paneId) || get().getPanePathByLayout(paneId) || '';
      if (!destDir) {
        get().showToast('无法确定目标目录', 'error');
        return;
      }
      const mode: 'copy' | 'move' = cb.mode === 'cut' ? 'move' : 'copy';
      await get().performBulk(cb.paths, destDir, mode, paneId);
    },

    // ============ P3: 拖放 ============
    startDrag: (paths, sourcePaneId) => {
      set({
        dragState: { paths, sourcePaneId, effect: 'move', targetPath: null, targetKind: null },
      });
    },

    setDragTarget: (targetPath, targetKind, effect) => {
      const cur = get().dragState;
      if (!cur) return;
      set({
        dragState: { ...cur, targetPath, targetKind, effect: effect ?? cur.effect },
      });
    },

    updateDragEffect: (effect) => {
      const cur = get().dragState;
      if (!cur) return;
      set({ dragState: { ...cur, effect } });
    },

    endDrag: () => {
      set({ dragState: null });
    },

    // ============ P3: 新建 / 批量打开 ============
    createFolder: async (paneId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: '名称不能为空' };
      const destDir = get().getPanePath(paneId);
      if (!destDir) return { ok: false, error: '当前目录未加载' };
      // 目标已存在 → 拒绝(POSIX mkdir 目录已存在会返回 EEXIST,但写文件式的 fs.mkdir
      // 实现可能直接当 OK 处理;统一用 stat 预检避免覆盖/歧义)
      const target = joinPath(destDir, trimmed);
      const exists = await window.tabula.fs.stat(target);
      if (exists.ok) {
        const msg = `已存在同名项: ${trimmed}`;
        get().showToast(msg, 'error', 4000);
        return { ok: false, error: msg };
      }
      const res = await window.tabula.fs.mkdir(destDir, trimmed);
      if (!res.ok) {
        get().showToast(`新建文件夹失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message };
      }
      get().showToast(`已新建文件夹: ${trimmed}`, 'success', 2000);
      await get().refresh(paneId);
      return { ok: true, path: res.data };
    },

    createFile: async (paneId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: '名称不能为空' };
      const destDir = get().getPanePath(paneId);
      if (!destDir) return { ok: false, error: '当前目录未加载' };
      const target = joinPath(destDir, trimmed);
      // writeFile('') 会直接覆盖已存在文件(文件内容清空)→ 必须先 stat 拦截
      const exists = await window.tabula.fs.stat(target);
      if (exists.ok) {
        const msg = `已存在同名文件: ${trimmed}`;
        get().showToast(msg, 'error', 4000);
        return { ok: false, error: msg };
      }
      const res = await window.tabula.fs.writeFile(target, '');
      if (!res.ok) {
        get().showToast(`新建文件失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message };
      }
      get().showToast(`已新建文件: ${trimmed}`, 'success', 2000);
      await get().refresh(paneId);
      return { ok: true, path: target };
    },

    openSelected: async (paneId) => {
      const data = get().panes[paneId];
      if (!data || data.selectedPaths.size === 0) return;
      const entries = data.entries;
      for (const p of data.selectedPaths) {
        const e = entries.find((x) => x.path === p);
        if (!e) continue;
        if (e.isDirectory) {
          // 目录:在当前 pane 加载(P3 简化:不新开 tab;v2 可加 openInNewTab 选项)
          await useLayoutStore.getState().pane.navigate(paneId, e.path);
          break; // 一次只切一个(选中多目录只切第一个)
        } else {
          void window.tabula.fs.openPath(e.path);
        }
      }
    },

    // ============ P3: Toast / Progress ============
    showToast: (message, kind = 'info', durationMs = 3000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      set((s) => ({
        toasts: [...s.toasts, { id, message, kind, duration: durationMs, createdAt: Date.now() }],
      }));
      if (durationMs > 0) {
        setTimeout(() => get().dismissToast(id), durationMs);
      }
      return id;
    },

    dismissToast: (id) => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    setProgress: (p) => {
      set({ progress: p });
    },

    // ============ P3: 冲突解决 ============
    resolveConflict: async (resolution, newName) => {
      const pc = get().pendingConflicts;
      if (!pc) return;
      if (resolution === 'cancelAll') {
        set({ pendingConflicts: null });
        get().showToast('已取消粘贴', 'info', 2000);
        return;
      }
      const head = pc.queue[0];
      if (!head) return;

      // 处理当前冲突
      if (resolution === 'skip') {
        pc.queue.shift();
      } else if (resolution === 'overwrite') {
        pc.resolved.push({ source: head.sourcePath, dest: head.destPath, overwrite: true });
        pc.queue.shift();
      } else if (resolution === 'rename') {
        const name = newName?.trim() ?? '';
        if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
          get().showToast('请输入有效的文件名', 'error');
          return;
        }
        const dest = joinPath(head.destDir, name);
        const reserved = [...pc.autoResolved, ...pc.resolved].some((op) => op.dest.toLowerCase() === dest.toLowerCase());
        if (reserved || await window.tabula.fs.exists(dest)) {
          get().showToast(`已存在同名项: ${name}`, 'error');
          return;
        }
        pc.resolved.push({ source: head.sourcePath, dest, overwrite: false });
        pc.queue.shift();
      }

      // 没有更多冲突,执行批量
      if (pc.queue.length === 0) {
        const allOps = [...pc.autoResolved, ...pc.resolved];
        set({ pendingConflicts: null });
        if (allOps.length === 0) {
          get().showToast('无文件需要处理', 'info', 1500);
          return;
        }
        const verb = pc.mode === 'copy' ? '复制' : '移动';
        get().setProgress({
          operation: pc.mode,
          count: allOps.length,
          message: `正在${verb} ${allOps.length} 项…`,
        });
        try {
          let success = 0;
          let firstError: string | null = null;
          const operations = allOps.filter((op) => op.dest !== op.source);
          const request = {
            sources: operations.map((op) => op.source),
            destination: pc.destinationDir,
            destinations: operations.map((op) => op.dest),
            overwrites: operations.map((op) => op.overwrite),
          };
          const result = await window.tabula.fs[pc.mode === 'copy' ? 'copy' : 'move'](request);
          if (result.ok) success = operations.length;
          else firstError = result.error.message;
          get().setProgress(null);
          if (pc.mode === 'move') {
            const cb = get().clipboard;
            if (!firstError && cb?.mode === 'cut' && cb.paths.every((path) => pc.sources.includes(path))) set({ clipboard: null });
          }
          if (firstError) {
            get().showToast(
              `${verb}失败: ${firstError} (成功 ${success}/${allOps.length})`,
              'error',
              4000,
            );
          } else {
            get().showToast(`已${verb} ${success} 项`, 'success', 2500);
          }
          await refreshAffected(pc.sources, pc.destinationDir);
        } catch (e) {
          get().setProgress(null);
          get().showToast(`${verb}失败: ${String(e)}`, 'error', 4000);
        }
        return;
      }
      // 有更多冲突,更新队列继续处理
      set({ pendingConflicts: { ...pc } });
    },

    ...createTrashSlice(set, get, store),

    // ============ P4: 当前目录过滤 (Ctrl+F) ============
    openSearch: (paneId) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchOpen: true },
        },
      }));
    },
    closeSearch: (paneId) => {
      // Esc 退出 / 清空:折叠面板,但保留 query(用户可以再 Ctrl+F 出来)
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchOpen: false },
        },
      }));
    },
    setSearchQuery: (paneId, q) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchQuery: q },
        },
      }));
    },
    clearSearch: (paneId) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchQuery: '', searchOpen: false },
        },
      }));
    },

    ...createPreviewSlice(set, get, store),

    ...createSearchSlice(set, get, store),

    // ============ P3: 批量 copy / move 入口 ============
    performBulk: async (sources, destDir, mode, paneId) => {
      if (sources.length === 0) return { ok: true, moved: 0 };
      // 不能把目录粘贴到自己或子目录(简单防呆:检测 destDir 是否在 sources 之下)
      // v1:不防呆,交给用户
      // 先扫冲突
      const conflicts: ConflictItem[] = [];
      const autoResolved: { source: string; dest: string; overwrite: boolean; }[] = [];
      for (const src of sources) {
        if (!src) continue;
        if (mode === 'move' && sameFilePath(src, destDir)) continue;
        const srcName = basename(src);
        if (!srcName) {
          continue;
        }
        const dest = joinPath(destDir, srcName);
        if (sameFilePath(dest, src)) {
          // 同源同目标:move 直接跳过;copy 在同目录需生成新名(加 -copy)
          if (mode === 'move') {
            continue;
          }
          // copy:在同目录生成带序号的副本名
          const dotIdx = srcName.lastIndexOf('.');
          const base = dotIdx > 0 ? srcName.slice(0, dotIdx) : srcName;
          const ext = dotIdx > 0 ? srcName.slice(dotIdx) : '';
          let copyName = base + ' - 副本' + ext;
          let copyDest = joinPath(destDir, copyName);
          let counter = 2;
          while ((await window.tabula.fs.exists(copyDest)) && counter <= 99) {
            copyName = base + ' - 副本 (' + counter + ')' + ext;
            copyDest = joinPath(destDir, copyName);
            counter++;
          }
          const exists = await window.tabula.fs.exists(copyDest);
          if (exists) {
            get().showToast('无法生成不重名的副本', 'error', 3000);
            continue;
          }
          autoResolved.push({ source: src, dest: copyDest, overwrite: false });
          continue;
        }
        const exists = await window.tabula.fs.exists(dest);
        if (exists) {
          // 收集 stat
          const stat = await window.tabula.fs.stat(dest);
          conflicts.push({
            sourcePath: src,
            sourceName: srcName,
            destPath: dest,
            destDir,
            destName: srcName,
            isDirectory: stat.ok ? stat.data.isDirectory : false,
          });
        } else {
          autoResolved.push({ source: src, dest, overwrite: false });
        }
      }
      if (conflicts.length > 0) {
        set({
          pendingConflicts: {
            paneId: paneId ?? '',
            sources,
            destinationDir: destDir,
            mode,
            resolved: [],
            queue: conflicts,
            autoResolved,
          },
        });
        return { ok: true, moved: 0 }; // 等待用户解决
      }
      // Every item already resides in the destination: don't issue an empty
      // move or present a conflict/success message for an operation that did nothing.
      if (autoResolved.length === 0) return { ok: true, moved: 0 };
      // 无冲突,直接执行
      const verb = mode === 'copy' ? '复制' : '移动';
      get().setProgress({ operation: mode, count: autoResolved.length, message: `正在${verb} ${autoResolved.length} 项…` });
      try {
        let success = 0;
        let firstError: string | null = null;
        const request = {
          sources: autoResolved.map((op) => op.source),
          destination: destDir,
          // 透传 op.dest, including generated keep-both names. One batch creates one undo entry.
          destinations: autoResolved.map((op) => op.dest),
          overwrites: autoResolved.map((op) => op.overwrite),
        };
        const result = await window.tabula.fs[mode === 'copy' ? 'copy' : 'move'](request);
        if (result.ok) success = autoResolved.length;
        else firstError = result.error.message;
        get().setProgress(null);
        if (firstError) {
          get().showToast(`${verb}失败: ${firstError} (成功 ${success}/${autoResolved.length})`, 'error', 4000);
          return { ok: false, moved: success, error: firstError };
        } else {
          get().showToast(`已${verb} ${success} 项`, 'success', 2500);
          if (mode === 'move') {
            const cb = get().clipboard;
            if (cb?.mode === 'cut' && cb.paths.every((path) => sources.includes(path))) set({ clipboard: null });
          }
          await refreshAffected(sources, destDir);
          return { ok: true, moved: success };
        }
      } catch (e) {
        get().setProgress(null);
        get().showToast(`${verb}失败: ${String(e)}`, 'error', 4000);
        return { ok: false, moved: 0, error: String(e) };
      }
    },

    ...createThumbnailSlice(set, get, store),

    ...createArchiveSlice(set, get, store),
  };
});
