import type { FsEntry } from '@tabula/bridge';
import { groupEntries, type GroupByMode } from '../../stores/file-store';
export interface VisualFileRow { header?: string; entries: FsEntry[]; top: number; height: number }
export function buildViewRows(entries: FsEntry[], group: GroupByMode, cols = 1, cellHeight = 28): VisualFileRow[] {
  const rows: VisualFileRow[] = []; let top = 0;
  for (const section of groupEntries(entries, group)) {
    if (section.header) { rows.push({ header: section.header, entries: [], top, height: 28 }); top += 28; }
    for (let i = 0; i < section.entries.length; i += cols) { rows.push({ entries: section.entries.slice(i, i + cols), top, height: cellHeight }); top += cellHeight; }
  }
  return rows;
}
export function entriesInBox(rows: VisualFileRow[], box: { left: number; right: number; top: number; bottom: number }, width: number, cols = 1): string[] {
  const paths: string[] = []; const cellWidth = cols === 1 ? width : (width - 16 - (cols - 1) * 4) / cols;
  for (const row of rows) {
    if (row.header || row.top + row.height <= box.top || row.top >= box.bottom) continue;
    row.entries.forEach((entry, index) => {
      const left = cols === 1 ? 0 : 8 + index * (cellWidth + 4);
      if (left + cellWidth > box.left && left < box.right) paths.push(entry.path);
    });
  }
  return paths;
}
