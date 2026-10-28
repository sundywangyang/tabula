import type { FileSlice } from './types';
import type { ThumbnailEntry } from './types';

/** 支持缩略图的图片扩展名(与主进程 thumbnail.ts 的 IMAGE_EXTS 保持一致) */
export const THUMBNAIL_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.ico', '.heic', '.avif', '.tiff', '.tif', '.psd', '.raw',
]);

export function isThumbnailable(ext: string): boolean {
  return THUMBNAIL_EXTS.has(ext.toLowerCase());
}

// =================== 工具函数 ===================

/** 模块级 in-flight Promise 池(同 path 并发请求去重) */
const inflightThumbnails = new Map<string, Promise<ThumbnailEntry | null>>();

type Actions =
  | 'loadThumbnail'
  | 'clearThumbnails';

export const createThumbnailSlice: FileSlice<Actions> = (set, get) => ({
  // ============ P7: 缩略图 =============
  // 用模块级 Map 存 in-flight Promise(同 path 并发请求去重)
  // — 不放 store 内部是因为 store state 序列化会丢 Promise
  loadThumbnail: async (filePath, mtime) => {
    const cur = get().thumbnails.get(filePath);
    if (cur && cur.mtime === mtime) {
      return cur;
    }
    // 复用 in-flight
    const inflight = inflightThumbnails.get(filePath);
    if (inflight) {
      return inflight;
    }
    // 标 loading
    set((s) => {
      const next = new Set(s.thumbnailLoading);
      next.add(filePath);
      return { thumbnailLoading: next };
    });
    const p = (async () => {
      try {
        const res = await window.tabula.fs.getThumbnail(filePath);
        if (!res.ok) return null;
        const entry: ThumbnailEntry = {
          dataUrl: res.data.dataUrl,
          mtime: res.data.mtime,
          loadedAt: Date.now(),
        };
        set((s) => {
          const next = new Map(s.thumbnails);
          next.set(filePath, entry);
          return { thumbnails: next };
        });
        return entry;
      } catch {
        return null;
      } finally {
        inflightThumbnails.delete(filePath);
        set((s) => {
          const next = new Set(s.thumbnailLoading);
          next.delete(filePath);
          return { thumbnailLoading: next };
        });
      }
    })();
    inflightThumbnails.set(filePath, p);
    return p;
  },

  clearThumbnails: () => {
    set({ thumbnails: new Map(), thumbnailLoading: new Set() });
  }
});
