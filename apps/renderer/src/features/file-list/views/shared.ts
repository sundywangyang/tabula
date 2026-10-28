import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { FsEntry } from '@tabula/bridge';
import type { GroupByMode } from '../../../stores/file/types';
import { groupEntries } from '../../../stores/file/view-selectors';

// =================== 详情视图 ===================

/** G007: 视图内一行可能是 header 或 entry */
export type ViewRow =
  | { kind: 'header'; key: string; header: string; }
  | { kind: 'entry'; key: string; entry: FsEntry; };

export interface FileViewProps {
  entries: FsEntry[];
  /** G007: 分组模式;为 'none' 时退化为单段(不渲染任何 header) */
  groupBy: GroupByMode;
  showExtensions: boolean;
  selectedPaths: Set<string>;
  cursorPath: string | null;
  renameTarget: string | null;
  dropTargetPath?: string | null;
  onRowClick: (entry: FsEntry, e: ReactMouseEvent<HTMLDivElement>) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onRenameSubmit: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string; }>;
  onRenameCancel: () => void;
  onRowDragStart: (entry: FsEntry, e: ReactDragEvent<HTMLElement>) => void;
  onRowDragEnd: () => void;
  /** 挂到 scroll container 的 drop 处理器 */
  onDragOver?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLDivElement>) => void;
  /** G004: 用于把 body 元素 ref 上抛到父组件,作为橡皮筋坐标原点 */
  bodyRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** G004: 在 body 空白处按下鼠标时启动拖框 */
  onBodyMouseDown?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** G004: 当前 rubber-band overlay 几何(用于在 body 上画 overlay) */
  rubberBand?: { startX: number; startY: number; curX: number; curY: number; } | null;
}

export function buildGroupedRows(entries: FsEntry[], groupBy: GroupByMode): ViewRow[] {
  const sections = groupEntries(entries, groupBy);
  const out: ViewRow[] = [];
  for (const sec of sections) {
    if (sec.header) out.push({ kind: 'header', key: `h:${sec.header}`, header: sec.header });
    for (const e of sec.entries) out.push({ kind: 'entry', key: `e:${e.path}`, entry: e });
  }
  return out;
}

// =================== Helpers ===================

export function displayName(entry: FsEntry, showExtensions: boolean): string {
  if (entry.isDirectory || showExtensions) return entry.name;
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 ? entry.name.slice(0, dot) : entry.name;
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * G004: 计算橡皮筋 overlay 元素的 inline style(相对于 body 容器)。
 * body 是滚动容器,overlay 必须是 body 的 child 并用 absolute 定位,
 * 把 clientX/Y 减去 body 自身位置 + scroll offset,得到 body 内容坐标系。
 */
export function computeOverlayStyle(
  body: HTMLDivElement | null,
  band: { startX: number; startY: number; curX: number; curY: number; },
): React.CSSProperties | null {
  if (!body) return null;
  const rect = body.getBoundingClientRect();
  const scrollTop = body.scrollTop;
  const scrollLeft = body.scrollLeft;
  const x1 = Math.min(band.startX, band.curX);
  const x2 = Math.max(band.startX, band.curX);
  const y1 = Math.min(band.startY, band.curY);
  const y2 = Math.max(band.startY, band.curY);
  const left = x1 - rect.left + scrollLeft;
  const top = y1 - rect.top + scrollTop;
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);
  return {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
}
