import { useEffect, useRef, useState } from 'react';
import type { FolderViewSettings } from '@tabula/bridge';
import type { SortDir, SortField } from '../../../stores/file/types';
import { SortHeader } from './SortHeader';

type Column = 'size' | 'mtime' | 'type';
const columns: { key: Column; label: string; width: number }[] = [
  { key: 'size', label: '大小', width: 100 },
  { key: 'mtime', label: '修改时间', width: 160 },
  { key: 'type', label: '类型', width: 100 },
];

export function DetailsHeader({ settings, sortBy, sortDir, onSort, onChange }: {
  settings: FolderViewSettings; sortBy: SortField; sortDir: SortDir;
  onSort: (field: SortField) => void;
  onChange: (settings: Pick<FolderViewSettings, 'columnWidths' | 'visibleColumns'>, persist?: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const resize = (e: React.PointerEvent, column: Column, width: number) => {
    e.preventDefault(); e.stopPropagation(); cleanup.current?.();
    const start = e.clientX;
    let next = width;
    const move = (event: PointerEvent) => {
      next = Math.max(60, Math.min(600, Math.round(width + start - event.clientX)));
      onChange({ columnWidths: { ...settings.columnWidths, [column]: next } }, false);
    };
    const finish = () => { cleanup.current?.(); onChange({ columnWidths: { ...settings.columnWidths, [column]: next } }); };
    cleanup.current = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); cleanup.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  };
  return <div className="file-list-header">
    <div className="detail-name-header">
      <SortHeader field="name" label="名称" currentField={sortBy} currentDir={sortDir} onSort={onSort} className="col col-name" />
      <button type="button" className="detail-columns-button" aria-label="选择显示的列" title="选择显示的列" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
      {menuOpen && <div className="detail-columns-menu">
        {columns.map(c => <label key={c.key}><input type="checkbox" checked={settings.visibleColumns?.[c.key] !== false} onChange={e => onChange({ visibleColumns: { ...settings.visibleColumns, [c.key]: e.target.checked } })} />{c.label}</label>)}
        <button type="button" onClick={() => setMenuOpen(false)}>完成</button>
      </div>}
    </div>
    {columns.filter(c => settings.visibleColumns?.[c.key] !== false).map(c => <div className="detail-column-header" key={c.key}>
      <span className="detail-column-resize" role="separator" aria-label={`调整${c.label}列宽`} onPointerDown={e => resize(e, c.key, settings.columnWidths?.[c.key] ?? c.width)} />
      <SortHeader field={c.key} label={c.label} currentField={sortBy} currentDir={sortDir} onSort={onSort} className={`col col-${c.key}`} />
    </div>)}
  </div>;
}
