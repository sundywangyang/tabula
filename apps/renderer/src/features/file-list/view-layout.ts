import type { FsEntry } from '@tabula/bridge';
import { groupEntries, type GroupByMode } from '../../stores/file-store';
export interface VisualFileRow { header?: string; entries: FsEntry[]; top: number; height: number }
/** 与网格的左右内边距和列间距保持一致。 */
export function gridColumnCount(width: number, thumbnailSize: number): number {
  const minCellWidth = thumbnailSize + 46;
  return Math.max(1, Math.min(8, Math.floor((Math.max(0, width - 16) + 4) / (minCellWidth + 4))));
}
export function buildViewRows(entries: FsEntry[], group: GroupByMode, cols = 1, cellHeight = 28): VisualFileRow[] {
  const rows: VisualFileRow[] = []; let top = 0;
  for (const section of groupEntries(entries, group)) {
    if (section.header) { rows.push({ header: section.header, entries: [], top, height: 28 }); top += 28; }
    for (let i = 0; i < section.entries.length; i += cols) { rows.push({ entries: section.entries.slice(i, i + cols), top, height: cellHeight }); top += cellHeight; }
  }
  return rows;
}
export function entriesInBox(rows: VisualFileRow[], box: { left: number; right: number; top: number; bottom: number }, width: number, cols = 1, isGrid = cols > 1): string[] {
  const paths: string[] = []; const cellWidth = isGrid ? Math.max(0, (width - 16 - (cols - 1) * 4) / cols) : width;
  for (const row of rows) {
    if (row.header || row.top + row.height <= box.top || row.top >= box.bottom) continue;
    row.entries.forEach((entry, index) => {
      const left = isGrid ? 8 + index * (cellWidth + 4) : 0;
      if (left + cellWidth > box.left && left < box.right) paths.push(entry.path);
    });
  }
  return paths;
}
