import { useFileStore } from '../../stores/file-store';

/** G008: 缓存 entry → tags 的内存映射(避免每次右键都打 IPC) */
const tagsCache = new Map<string, string[]>();

/** Tag changes notify both the menu and file-list views. */
const tagsCacheListeners = new Set<() => void>();

let tagsCacheLoaded = false;

let tagsCacheLoading: Promise<void> | null = null;

export async function ensureTagsCacheLoaded(): Promise<void> {
  if (tagsCacheLoaded) return;
  if (tagsCacheLoading) return tagsCacheLoading;
  tagsCacheLoading = (async () => {
    try {
      // getAllTags 是主进程的导出;渲染端没有,改为逐项读取
      // 渲染端走 window.tabula.tags.get(path) — 缓存机制:右键时拉一次
      // 这里我们不在每次右键前主动拉所有 — ContextMenu 内会按需拉
      tagsCacheLoaded = true;
    } finally {
      tagsCacheLoading = null;
    }
  })();
  return tagsCacheLoading;
}

/** 取某路径当前的 tags(从缓存;无则返回空) */
export function getCachedTags(path: string): string[] {
  return tagsCache.get(path) ?? [];
}

/** 设置某路径的 tags(主进程返回后调用) */
export function setCachedTags(path: string, tags: string[]): void {
  tagsCache.set(path, tags);
  tagsCacheListeners.forEach((fn) => fn());
}

/** 订阅 tags 变化(ContextMenu 在打开时刷新会用到) */
export function subscribeTagsCache(fn: () => void): () => void {
  tagsCacheListeners.add(fn);
  return () => tagsCacheListeners.delete(fn);
}

/** 给路径添加 tag(IPC + 写缓存) */
export async function addTagForPath(path: string, tag: string): Promise<void> {
  const result = await window.tabula.tags.add(path, tag);
  if (!result.ok) { useFileStore.getState().showToast(result.error.message, 'error'); return; }
  const cur = tagsCache.get(path) ?? [];
  if (!cur.includes(tag)) {
    tagsCache.set(path, [...cur, tag]);
    tagsCacheListeners.forEach((fn) => fn());
  }
}

/** 给路径移除 tag(IPC + 写缓存) */
export async function removeTagForPath(path: string, tag: string): Promise<void> {
  const result = await window.tabula.tags.remove(path, tag);
  if (!result.ok) { useFileStore.getState().showToast(result.error.message, 'error'); return; }
  const cur = tagsCache.get(path) ?? [];
  tagsCache.set(path, cur.filter((t) => t !== tag));
  tagsCacheListeners.forEach((fn) => fn());
}

/** 主进程拉一次 path 的 tags(并写缓存) */
export async function loadTagsForPath(path: string): Promise<string[]> {
  const result = await window.tabula.tags.get(path);
  if (!result.ok) return getCachedTags(path);
  setCachedTags(path, result.data);
  return result.data;
}
