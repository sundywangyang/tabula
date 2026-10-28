import type { FileSlice } from './types';
import { useLayoutStore } from '../layout-store';

type Actions =
  | 'openPreview'
  | 'closePreview'
  | 'setPreviewLoading'
  | 'setPreviewData'
  | 'setPreviewError'
  | 'previewNavigate';

export const createPreviewSlice: FileSlice<Actions> = (set, get) => ({
  // ============ P4: 预览 (Space) ============
  openPreview: (entry) => {
    // 关闭上一个的 blobUrl(避免内存泄漏)
    const prev = get().previewState;
    if (prev?.blobUrl) {
      try { URL.revokeObjectURL(prev.blobUrl); } catch { /* noop */ }
    }
    set({
      previewState: {
        entry,
        blobUrl: null,
        text: null,
        loading: true,
        error: null,
        truncated: false,
        totalLines: 0,
      },
    });
  },

  closePreview: () => {
    const cur = get().previewState;
    if (cur?.blobUrl) {
      try { URL.revokeObjectURL(cur.blobUrl); } catch { /* noop */ }
    }
    set({ previewState: null });
  },

  setPreviewLoading: (loading) => {
    const cur = get().previewState;
    if (!cur) return;
    set({ previewState: { ...cur, loading } });
  },

  setPreviewData: (data) => {
    const cur = get().previewState;
    if (!cur) return;
    set({
      previewState: {
        ...cur,
        loading: false,
        error: null,
        blobUrl: data.blobUrl !== undefined ? data.blobUrl : cur.blobUrl,
        text: data.text !== undefined ? data.text : cur.text,
        truncated: data.truncated ?? cur.truncated,
        totalLines: data.totalLines ?? cur.totalLines,
      },
    });
  },

  setPreviewError: (msg) => {
    const cur = get().previewState;
    if (!cur) return;
    set({
      previewState: { ...cur, loading: false, error: msg },
    });
  },

  previewNavigate: (delta) => {
    const cur = get().previewState;
    if (!cur) return false;
    // 走当前 active pane(预览是从那里打开的)
    const activePaneId = useLayoutStore.getState().activePaneId;
    if (!activePaneId) return false;
    const entries = get().getFilteredSortedEntries(activePaneId);
    if (entries.length === 0) return false;
    const curIdx = entries.findIndex((e) => e.path === cur.entry.path);
    if (curIdx < 0) return false;
    // 沿 delta 方向找第一个非目录条目;到边界就停
    let nextIdx = curIdx;
    for (let step = 0; step < entries.length; step += 1) {
      nextIdx += delta;
      if (nextIdx < 0 || nextIdx >= entries.length) {
        // 越界:停在边界(不循环)
        return false;
      }
      const candidate = entries[nextIdx];
      if (candidate.isDirectory) continue; // 跳过目录
      get().openPreview(candidate);
      return true;
    }
    return false;
  }
});
