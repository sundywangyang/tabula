import type { FsEntry, FileTypeCategory } from '@tabula/bridge';
import { matchesCategory } from '@tabula/core/file-rules';
import type { SortField, SortDir, GroupByMode, GroupSection, PaneFileData } from './types';

export function compareEntries(a: FsEntry, b: FsEntry, field: SortField, dir: SortDir): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  let cmp = 0;
  switch (field) {
    case 'name':
      cmp = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
      break;
    case 'size':
      cmp = a.size - b.size;
      break;
    case 'mtime':
      cmp = a.mtime - b.mtime;
      break;
    case 'type':
      cmp = (a.ext || '').localeCompare(b.ext || '', 'en', { sensitivity: 'base' });
      if (cmp === 0) cmp = a.name.localeCompare(b.name, 'zh-CN');
      break;
  }
  return dir === 'desc' ? -cmp : cmp;
}

export function computeFilteredSorted(
  entries: FsEntry[],
  opts: { sortBy: SortField; sortDir: SortDir; showHidden: boolean; searchQuery?: string; fileType?: FileTypeCategory; },
): FsEntry[] {
  let list = entries;
  if (opts.fileType && opts.fileType !== 'all') list = list.filter(entry => matchesCategory(entry, opts.fileType));
  if (!opts.showHidden) {
    list = list.filter((e) => !e.name.startsWith('.'));
  }
  if (opts.searchQuery) {
    const q = opts.searchQuery.toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(q));
  }
  if (opts.sortDir === null) {
    return [...list].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return 0;
    });
  }
  return [...list].sort((a, b) => compareEntries(a, b, opts.sortBy, opts.sortDir));
}

// =================== G007: 分组 helper ===================

/** G007: 大小桶阈值(字节)。包含顺序:逐桶往上,落到第一个命中区间。 */
export const SIZE_BUCKETS: ReadonlyArray<{ header: string; min: number; max: number; }> = [
  { header: 'Tiny (< 1 KB)', min: 0, max: 1024 },
  { header: 'Small (1 KB – 1 MB)', min: 1024, max: 1024 * 1024 },
  { header: 'Medium (1 MB – 100 MB)', min: 1024 * 1024, max: 100 * 1024 * 1024 },
  { header: 'Large (100 MB – 1 GB)', min: 100 * 1024 * 1024, max: 1024 * 1024 * 1024 },
  { header: 'Huge (> 1 GB)', min: 1024 * 1024 * 1024, max: Number.POSITIVE_INFINITY },
];

/** G007: 日期桶 — 给一个 mtime 返回可读 bucket header。 */
export function dateBucketLabel(mtime: number, now: number): string {
  if (!mtime) return 'Unknown';
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((now - mtime) / ONE_DAY);
  if (diffDays < 1) return 'Today';
  if (diffDays < 2) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  if (diffDays < 30) return 'This Month';
  if (diffDays < 365) return 'This Year';
  return 'Older';
}

/**
 * G007: 把 entries 按 mode 分组。
 *
 * - 'none'  → 单段(空 header + 全部 entries)
 * - 'type'  → 目录先一段('Folders'),然后按 ext(.js/.ts/...)分组,无 ext 一段('No Extension')
 * - 'date'  → 按 mtime 相对今天的 bucket 分组(Today / Yesterday / This Week / ...)
 * - 'size'  → 按 SIZE_BUCKETS 分组
 *
 * 各组内 entries 保持输入顺序(已排好序再传入更佳)。
 */
export function groupEntries(entries: FsEntry[], mode: GroupByMode): GroupSection[] {
  if (mode === 'none') return [{ header: '', entries: [...entries] }];

  // 用 Map 维持首次插入顺序,这样组顺序确定且稳定
  const groups = new Map<string, FsEntry[]>();
  const dirs: FsEntry[] = [];

  if (mode === 'type') {
    for (const e of entries) {
      if (e.isDirectory) {
        dirs.push(e);
      } else {
        const key = e.ext ? e.ext : '(no extension)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(e);
      }
    }
  } else if (mode === 'date') {
    const now = Date.now();
    for (const e of entries) {
      if (e.isDirectory) {
        dirs.push(e);
        continue;
      }
      const key = dateBucketLabel(e.mtime, now);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
  } else if (mode === 'size') {
    for (const e of entries) {
      if (e.isDirectory) {
        dirs.push(e);
        continue;
      }
      const bucket = SIZE_BUCKETS.find((b) => e.size >= b.min && e.size < b.max);
      const key = bucket ? bucket.header : 'Unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
  }

  const sections: GroupSection[] = [];
  if (dirs.length > 0) sections.push({ header: 'Folders', entries: dirs });
  for (const [header, items] of groups) {
    sections.push({ header, entries: items });
  }
  return sections;
}

export function displayEntries(data: PaneFileData, opts: { sortBy: SortField; sortDir: SortDir; showHidden: boolean; }): FsEntry[] {
  return groupEntries(computeFilteredSorted(data.entries, { ...opts, searchQuery: data.searchQuery, fileType: data.fileType }), data.groupBy ?? 'none').flatMap(section => section.entries);
}
