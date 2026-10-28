import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getCachedTags } from '../../../components/context-menu/tags';
import { FileThumb } from './FileThumb';
import { RenameInput } from './RenameInput';
import { buildGroupedRows, computeOverlayStyle, displayName, type FileViewProps } from './shared';

// =================== 列表视图(简版,只显示名字)===================

export function ListView({
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

  // G007: 分组 — 与 DetailsView 同样的 header 行
  const rows = useMemo(() => buildGroupedRows(entries, groupBy), [entries, groupBy]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  const overlayStyle = rubberBand
    ? computeOverlayStyle(parentRef.current, rubberBand)
    : null;

  return (
    <div
      ref={(el) => {
        parentRef.current = el;
        if (bodyRef) bodyRef.current = el;
      }}
      className="list-view file-list-body file-list-body-virtual"
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
          const entry = row.entry;
          return (
            <div
              key={row.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
              className={`file-list-row row-list ${dropTargetPath === entry.path ? 'file-drop-target' : ''} ${selectedPaths.has(entry.path) ? 'selected' : ''} ${cursorPath === entry.path ? 'cursor' : ''
                }`}
              onClick={(e) => onRowClick(entry, e)}
              onDoubleClick={() => onRowDoubleClick(entry)}
              draggable={renameTarget !== entry.path}
              onDragStart={(e) => onRowDragStart(entry, e)}
              onDragEnd={onRowDragEnd}
              data-entry-path={entry.path}
            >
              <div className="col col-name-full">
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
                {renameTarget === entry.path ? (
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
