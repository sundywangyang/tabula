import type { FileSlice } from './types';
import { emptyPaneData } from './pane-data';
import { displayEntries } from './view-selectors';

type Actions =
  | 'selectOne'
  | 'toggleSelect'
  | 'rangeSelect'
  | 'clearSelection'
  | 'selectAll'
  | 'selectInvert'
  | 'selectRect'
  | 'setCursor'
  | 'moveCursor'
  | 'cursorToEdge';

export const createSelectionSlice: FileSlice<Actions> = (set, get) => ({
  // ============ 选择 ============
  selectOne: (paneId, path) => {
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set([path]), cursorPath: path, lastClickedPath: path },
      },
    }));
  },

  toggleSelect: (paneId, path) => {
    const data = get().panes[paneId];
    if (!data) return;
    const sel = new Set(data.selectedPaths);
    if (sel.has(path)) sel.delete(path);
    else sel.add(path);
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: sel, cursorPath: path, lastClickedPath: path },
      },
    }));
  },

  rangeSelect: (paneId, path) => {
    const data = get().panes[paneId];
    if (!data) return;
    const { entries, lastClickedPath } = data;
    const { sortBy, sortDir, showHidden } = get();
    const list = displayEntries(data, { sortBy, sortDir, showHidden });
    const endIdx = list.findIndex((e) => e.path === path);
    let startIdx = 0;
    if (lastClickedPath) {
      const s = list.findIndex((e) => e.path === lastClickedPath);
      if (s >= 0) startIdx = s;
    }
    if (endIdx < 0) {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: path, lastClickedPath: path },
        },
      }));
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const sel = new Set(data.selectedPaths);
    for (let i = lo; i <= hi; i++) sel.add(list[i]!.path);
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: sel, cursorPath: path },
      },
    }));
  },

  clearSelection: (paneId) => {
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(), cursorPath: null, lastClickedPath: null },
      },
    }));
  },

  selectAll: (paneId) => {
    const data = get().panes[paneId];
    if (!data) return;
    const { sortBy, sortDir, showHidden } = get();
    const list = displayEntries(data, { sortBy, sortDir, showHidden });
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(list.map((e) => e.path)) },
      },
    }));
  },

  // G002: 反选 — 已选中变未选中,未选中变已选中(限定当前可见/过滤后的 entries)
  selectInvert: (paneId) => {
    const data = get().panes[paneId];
    if (!data) return;
    const { sortBy, sortDir, showHidden } = get();
    const list = displayEntries(data, { sortBy, sortDir, showHidden });
    const inverted = new Set<string>();
    for (const e of list) {
      if (!data.selectedPaths.has(e.path)) inverted.add(e.path);
    }
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: inverted },
      },
    }));
  },

  // G004: 橡皮筋拖框 — 用传入的 paths 替换 selectedPaths。
  // - 未知 paneId:no-op
  // - 空数组:等价于 clearSelection(同时清掉 cursor / lastClicked)
  // - 非空:用新 Set 替换;保留 cursor/lastClicked 不动(用户通常还在框选后做后续操作)
  selectRect: (paneId, paths) => {
    const data = get().panes[paneId];
    if (!data) return;
    const next = new Set(paths);
    if (next.size === 0) {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: {
            ...(s.panes[paneId] ?? emptyPaneData()),
            selectedPaths: next,
            cursorPath: null,
            lastClickedPath: null,
          },
        },
      }));
      return;
    }
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: next },
      },
    }));
  },

  setCursor: (paneId, path) => {
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: path, lastClickedPath: path ?? s.panes[paneId]?.lastClickedPath ?? null },
      },
    }));
  },

  moveCursor: (paneId, delta, viewportSize) => {
    const data = get().panes[paneId];
    if (!data) return;
    const { sortBy, sortDir, showHidden } = get();
    const list = displayEntries(data, { sortBy, sortDir, showHidden });
    if (list.length === 0) return;
    let idx = data.cursorPath ? list.findIndex((e) => e.path === data.cursorPath) : -1;
    if (idx < 0) {
      idx = delta > 0 ? 0 : list.length - 1;
    } else {
      if (Math.abs(delta) === 1) {
        idx = Math.max(0, Math.min(list.length - 1, idx + (delta > 0 ? 1 : -1)));
      } else {
        idx = Math.max(0, Math.min(list.length - 1, idx + delta));
      }
    }
    const target = list[idx]!;
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: target.path, lastClickedPath: target.path, selectedPaths: new Set([target.path]) },
      },
    }));
  },

  cursorToEdge: (paneId, edge) => {
    const data = get().panes[paneId];
    if (!data) return;
    const { sortBy, sortDir, showHidden } = get();
    const list = displayEntries(data, { sortBy, sortDir, showHidden });
    if (list.length === 0) return;
    const target = edge === 'start' ? list[0]! : list[list.length - 1]!;
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: target.path, lastClickedPath: target.path, selectedPaths: new Set([target.path]) },
      },
    }));
  }
});
