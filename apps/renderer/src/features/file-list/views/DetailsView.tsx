import { useMemo, useRef } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { FsEntry } from '@tabula/bridge';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getCachedTags } from '../../../components/context-menu/tags';
import { FileThumb } from './FileThumb';
import { RenameInput } from './RenameInput';
import {
  buildGroupedRows,
  computeOverlayStyle,
  displayName,
  formatSize,
  formatDate,
  type FileViewProps,
} from './shared';

export function DetailsView({
  entries,
  groupBy,
  showExtensions,
  selectedPaths,
  cursorPath,
  renameTarget,
  dropTargetPath,
  onRowClick,
  onRowDoubleClick,
  onRenameSubmit,
  onRenameCancel,
  onRowDragStart,
  onRowDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  bodyRef,
  onBodyMouseDown,
  rubberBand,
}: FileViewProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  // G007: 用 groupEntries 把 entries 拆成分组,渲染 header 行
  const rows = useMemo(() => buildGroupedRows(entries, groupBy), [entries, groupBy]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  // rubber-band overlay 几何:与 FileList.tsx 里 computeEntriesInRect 同样的转换逻辑
  const overlayStyle = rubberBand
    ? computeOverlayStyle(parentRef.current, rubberBand)
    : null;

  return (
    <div
      ref={(el) => {
        parentRef.current = el;
        if (bodyRef) bodyRef.current = el;
      }}
      className="details-view file-list-body file-list-body-virtual"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseDown={onBodyMouseDown}
    >
      {overlayStyle && <div className="rubber-band-rect" style={overlayStyle} />}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          if (row.kind === 'header') {
            return (
              <div
                key={row.key}
                className="file-list-group-header"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                }}
              >
                <span className="group-header-label">{row.header}</span>
              </div>
            );
          }
          return (
            <DetailsRow
              key={row.key}
              entry={row.entry}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
              showExtensions={showExtensions}
              selected={selectedPaths.has(row.entry.path)}
              cursor={cursorPath === row.entry.path}
              renaming={renameTarget === row.entry.path}
              dropTarget={dropTargetPath === row.entry.path}
              onClick={onRowClick}
              onDoubleClick={onRowDoubleClick}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onDragStart={onRowDragStart}
              onDragEnd={onRowDragEnd}
            />
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  entry: FsEntry;
  style?: React.CSSProperties;
  showExtensions: boolean;
  selected: boolean;
  cursor: boolean;
  renaming: boolean;
  dropTarget: boolean;
  onClick: (entry: FsEntry, e: ReactMouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (entry: FsEntry) => void;
  onRenameSubmit: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string; }>;
  onRenameCancel: () => void;
  onDragStart: (entry: FsEntry, e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

function DetailsRow({
  entry,
  style,
  showExtensions,
  selected,
  cursor,
  renaming,
  dropTarget,
  onClick,
  onDoubleClick,
  onRenameSubmit,
  onRenameCancel,
  onDragStart,
  onDragEnd,
}: RowProps) {
  return (
    <div
      style={style}
      className={`file-list-row ${dropTarget ? 'file-drop-target' : ''} ${selected ? 'selected' : ''} ${cursor ? 'cursor' : ''}`}
      onClick={(e) => onClick(entry, e)}
      onDoubleClick={() => onDoubleClick(entry)}
      draggable={!renaming}
      onDragStart={(e) => onDragStart(entry, e)}
      onDragEnd={onDragEnd}
      data-entry-path={entry.path}
    >
      <div className="col col-name">
        <FileThumb entry={entry} variant="row" />
        {(() => {
          const tags = getCachedTags(entry.path);
          if (tags.length === 0) return null;
          return (
            <span className="row-tags">
              {tags.map((t) => (
                <span key={t} className="row-tag-chip">{t}</span>
              ))}
            </span>
          );
        })()}
        {renaming ? (
          <RenameInput
            entry={entry}
            showExtensions={showExtensions}
            onSubmit={(name) => onRenameSubmit(entry.path, name)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="row-name" title={entry.path}>
            {displayName(entry, showExtensions)}
          </span>
        )}
      </div>
      <div className="col col-size">
        {entry.isDirectory ? '—' : formatSize(entry.size)}
      </div>
      <div className="col col-mtime">{formatDate(entry.mtime)}</div>
      <div className="col col-type">{entry.isDirectory ? '文件夹' : entry.ext || '文件'}</div>
    </div>
  );
}
