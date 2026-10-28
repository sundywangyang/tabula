import type { FileSlice } from './types';

type Actions =
  | 'loadTrash'
  | 'restoreTrashItems'
  | 'permanentDeleteItems'
  | 'emptyTrash'
  | 'trashSelectOne'
  | 'trashToggleSelect'
  | 'trashRangeSelect'
  | 'trashClearSelection'
  | 'trashSelectAll'
  | 'getTrashCount';

export const createTrashSlice: FileSlice<Actions> = (set, get) => ({
  // ============ P3: 回收站 ============
  loadTrash: async () => {
    set({ trashLoading: true, trashError: null });
    const result = await window.tabula.fs.trashList();
    if (result.ok) {
      set({ trashItems: result.data.entries, trashLoading: false });
    } else {
      set({ trashLoading: false, trashError: result.error.message });
    }
  },

  restoreTrashItems: async (itemPaths) => {
    if (!itemPaths.length) return { ok: true };
    const items = get().trashItems;
    let failed = 0;
    for (const itemPath of itemPaths) {
      const item = items.find((x) => x.itemPath === itemPath);
      const res = await window.tabula.fs.trashRestore(itemPath, item?.originalPath ?? undefined);
      if (!res.ok) failed++;
    }
    if (failed > 0) {
      get().showToast(`恢复完成，${failed} 项失败`, 'warn', 3000);
    } else {
      get().showToast(`已恢复 ${itemPaths.length} 项`, 'success', 2000);
    }
    await get().loadTrash();
    return { ok: failed === 0 };
  },

  permanentDeleteItems: async (itemPaths) => {
    if (!itemPaths.length) return { ok: true };
    const res = await window.tabula.fs.delete(itemPaths, false);
    if (!res.ok) {
      get().showToast(`永久删除失败: ${res.error.message}`, 'error', 4000);
      return { ok: false, error: res.error.message };
    }
    get().showToast(`已永久删除 ${itemPaths.length} 项`, 'success', 2500);
    const remaining = get().trashItems.filter((x) => !itemPaths.includes(x.itemPath));
    set({ trashItems: remaining, trashSelectedPaths: new Set() });
    return { ok: true };
  },

  emptyTrash: async () => {
    const res = await window.tabula.fs.trashEmpty();
    if (!res.ok) {
      get().showToast(`清空回收站失败: ${res.error.message}`, 'error', 4000);
      return { ok: false, error: res.error.message };
    }
    get().showToast('回收站已清空', 'success', 2500);
    set({ trashItems: [], trashSelectedPaths: new Set() });
    return { ok: true };
  },

  trashSelectOne: (itemPath) => {
    set({ trashSelectedPaths: new Set([itemPath]) });
  },

  trashToggleSelect: (itemPath) => {
    const sel = new Set(get().trashSelectedPaths);
    if (sel.has(itemPath)) sel.delete(itemPath);
    else sel.add(itemPath);
    set({ trashSelectedPaths: sel });
  },

  trashRangeSelect: (itemPath) => {
    const items = get().trashItems;
    const endIdx = items.findIndex((x) => x.itemPath === itemPath);
    if (endIdx < 0) return;
    const sel = new Set(get().trashSelectedPaths);
    for (let i = 0; i <= endIdx; i++) sel.add(items[i]!.itemPath);
    set({ trashSelectedPaths: sel });
  },

  trashClearSelection: () => {
    set({ trashSelectedPaths: new Set() });
  },

  trashSelectAll: () => {
    const all = get().trashItems.map((x) => x.itemPath);
    set({ trashSelectedPaths: new Set(all) });
  },

  getTrashCount: () => get().trashItems.length
});
