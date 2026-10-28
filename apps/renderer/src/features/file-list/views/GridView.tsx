import { useEffect, useMemo, useRef } from 'react';
import type { FsEntry } from '@tabula/bridge';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getCachedTags } from '../../../components/context-menu/tags';
import { FileThumb } from './FileThumb';
import { RenameInput } from './RenameInput';
import { computeOverlayStyle, displayName, type FileViewProps } from './shared';
import { buildViewRows } from '../view-layout';

// =================== 网格视图 ====================

export function GridView({
  groupBy,
  thumbnailSize,
  entries,
  cols,
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
}: FileViewProps & { thumbnailSize: number; cols: number; }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => buildViewRows(entries, groupBy, cols, thumbnailSize + 48), [entries, groupBy, cols, thumbnailSize]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: index => rows[index].height,
    overscan: 4,
  });
  useEffect(() => { rowVirtualizer.measure(); }, [thumbnailSize, groupBy, cols, entries]);

  const overlayStyle = rubberBand
    ? computeOverlayStyle(parentRef.current, rubberBand)
    : null;

  return (
    <div
      ref={(el) => {
        parentRef.current = el;
        if (bodyRef) bodyRef.current = el;
      }}
      className="grid-view file-list-body file-list-body-virtual"
      style={{ ['--grid-cols' as string]: String(cols), ['--thumbnail-size' as string]: `${thumbnailSize}px` }}
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
          if (row.header) return <div className="file-list-group-header" key={`header-${row.header}`} style={{ position: 'absolute', transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size, width: '100%' }}>{row.header}</div>;
          const rowItems = row.entries;
          return (
            <div
              key={virtualRow.index}
              className="grid-row"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            >
              {rowItems.map((entry) => (
                <div
                  key={entry.path}
                  className={`grid-cell ${dropTargetPath === entry.path ? 'file-drop-target' : ''} ${selectedPaths.has(entry.path) ? 'selected' : ''} ${cursorPath === entry.path ? 'cursor' : ''
                    }`}
                  title="普通拖动可拖出应用；按住 Alt 拖动到应用内移动"
                  onClick={(e) => onRowClick(entry, e)}
                  onDoubleClick={() => onDoubleClickGrid(onRowDoubleClick, entry)}
                  draggable={renameTarget !== entry.path}
                  onDragStart={(e) => onRowDragStart(entry, e)}
                  onDragEnd={onRowDragEnd}
                  data-entry-path={entry.path}
                >
                  <FileThumb entry={entry} variant="grid" />
                  {(() => {
                    const tags = getCachedTags(entry.path);
                    if (tags.length === 0) return null;
                    return (
                      <span className="row-tags row-tags-grid">
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
                      variant="grid"
                    />
                  ) : (
                    <div className="grid-name" title={`${entry.path}\n普通拖动可拖出应用；按住 Alt 拖动到应用内移动`}>
                      {displayName(entry, showExtensions)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function onDoubleClickGrid(
  handler: (entry: FsEntry) => void,
  entry: FsEntry,
) {
  handler(entry);
}
