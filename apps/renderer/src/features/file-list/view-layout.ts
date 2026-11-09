/** 文件视图的尺寸、虚拟行和框选几何，供 DOM 与键盘导航共用。 */
import type { FsEntry } from '@tabula/bridge';
import type { GroupByMode } from '../../stores/file/types';
import { groupEntries } from '../../stores/file/view-selectors';

export const FILE_VIEW_METRICS = {
  rowHeight: 32,
  groupHeaderHeight: 28,
  gridInlinePadding: 8,
  gridColumnGap: 4,
  gridCellExtraWidth: 46,
  gridRowExtraHeight: 48,
  maxGridColumns: 8,
} as const;

export interface VisualFileRow {
  header?: string;
  entries: FsEntry[];
  top: number;
  height: number;
}

export function gridRowHeight(thumbnailSize: number): number {
  return thumbnailSize + FILE_VIEW_METRICS.gridRowExtraHeight;
}

export function gridColumnCount(width: number, thumbnailSize: number): number {
  const { gridInlinePadding, gridColumnGap, gridCellExtraWidth, maxGridColumns } = FILE_VIEW_METRICS;
  const minCellWidth = thumbnailSize + gridCellExtraWidth;
  const available = Math.max(0, width - gridInlinePadding * 2);
  return Math.max(1, Math.min(maxGridColumns, Math.floor((available + gridColumnGap) / (minCellWidth + gridColumnGap))));
}

export function buildViewRows(
  entries: FsEntry[],
  group: GroupByMode,
  cols = 1,
  cellHeight: number = FILE_VIEW_METRICS.rowHeight,
): VisualFileRow[] {
  const rows: VisualFileRow[] = [];
  let top = 0;
  for (const section of groupEntries(entries, group)) {
    if (section.header) {
      rows.push({ header: section.header, entries: [], top, height: FILE_VIEW_METRICS.groupHeaderHeight });
      top += FILE_VIEW_METRICS.groupHeaderHeight;
    }
    for (let i = 0; i < section.entries.length; i += cols) {
      rows.push({ entries: section.entries.slice(i, i + cols), top, height: cellHeight });
      top += cellHeight;
    }
  }
  return rows;
}

export function entriesInBox(
  rows: VisualFileRow[],
  box: { left: number; right: number; top: number; bottom: number },
  width: number,
  cols = 1,
  isGrid = cols > 1,
): string[] {
  const { gridInlinePadding, gridColumnGap } = FILE_VIEW_METRICS;
  const paths: string[] = [];
  const cellWidth = isGrid ? Math.max(0, (width - gridInlinePadding * 2 - (cols - 1) * gridColumnGap) / cols) : width;
  for (const row of rows) {
    if (row.header || row.top + row.height <= box.top || row.top >= box.bottom) continue;
    row.entries.forEach((entry, index) => {
      const left = isGrid ? gridInlinePadding + index * (cellWidth + gridColumnGap) : 0;
      if (left + cellWidth > box.left && left < box.right) paths.push(entry.path);
    });
  }
  return paths;
}
