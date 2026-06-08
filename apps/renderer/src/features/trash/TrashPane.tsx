/**
 * 回收站视图 (P3)
 *
 * 当 pane 的 active tab path 为 `trash:///` 时渲染此组件。
 * 显示回收站条目列表，支持排序、右键菜单、键盘快捷键。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrashEntry } from '@tabula/bridge';
import { useFileStore } from '../../stores/file-store';
import './TrashPane.css';

export type TrashSortField = 'name' | 'size' | 'deletedTime';
export type TrashSortDir = 'asc' | 'desc';

interface Props {
  paneId: string;
}

export function TrashPane({ paneId }: Props) {
  const trashItems = useFileStore((s) => s.trashItems);
  const trashLoading = useFileStore((s) => s.trashLoading);
  const trashError = useFileStore((s) => s.trashError);
  const trashSelected = useFileStore((s) => s.trashSelectedPaths);

  const loadTrash = useFileStore((s) => s.loadTrash);
  const restoreTrashItems = useFileStore((s) => s.restoreTrashItems);
  const permanentDeleteItems = useFileStore((s) => s.permanentDeleteItems);
  const emptyTrash = useFileStore((s) => s.emptyTrash);
  const trashSelectOne = useFileStore((s) => s.trashSelectOne);
  const trashToggleSelect = useFileStore((s) => s.trashToggleSelect);
  const trashRangeSelect = useFileStore((s) => s.trashRangeSelect);
  const trashClearSelection = useFileStore((s) => s.trashClearSelection);
  const trashSelectAll = useFileStore((s) => s.trashSelectAll);
  const showToast = useFileStore((s) => s.showToast);

  const [sortBy, setSortBy] = useState<TrashSortField>('deletedTime');
  const [sortDir, setSortDir] = useState<TrashSortDir>('desc');
  const [ctxMenu, setCtxMenu] = useState<{ itemPath: string; x: number; y: number } | null>(null);
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 挂载时加载
  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  // 全局点击关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  // 排序
  const sortedItems = useMemo(() => {
    const list = [...trashItems];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'deletedTime':
          cmp = a.deletedTime - b.deletedTime;
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [trashItems, sortBy, sortDir]);

  const cycleSort = (field: TrashSortField) => {
    if (sortBy !== field) { setSortBy(field); setSortDir('asc'); }
    else { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
  };

  // 行点击
  const handleRowClick = (item: TrashEntry, e: React.MouseEvent) => {
    if (e.shiftKey) { trashRangeSelect(item.itemPath); return; }
    if (e.ctrlKey || e.metaKey) { trashToggleSelect(item.itemPath); return; }
    if (trashSelected.size === 1 && trashSelected.has(item.itemPath)) {
      trashClearSelection();
    } else {
      trashSelectOne(item.itemPath);
    }
  };

  // 右键菜单
  const handleCtxMenu = (e: React.MouseEvent, item: TrashEntry) => {
    e.preventDefault();
    e.stopPropagation();
    if (!trashSelected.has(item.itemPath)) trashSelectOne(item.itemPath);
    setCtxMenu({ itemPath: item.itemPath, x: e.clientX, y: e.clientY });
  };

  // 恢复
  const handleRestore = async (itemPath: string) => {
    setCtxMenu(null);
    await restoreTrashItems([itemPath]);
  };

  // 永久删除(单条)
  const handlePermanentDelete = async (itemPath: string) => {
    setCtxMenu(null);
    await permanentDeleteItems([itemPath]);
  };

  // 清空回收站
  const handleEmptyTrash = async () => {
    setEmptyConfirm(false);
    await emptyTrash();
  };

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Delete' && !e.shiftKey) {
        if (trashSelected.size === 0) return;
        e.preventDefault();
        void permanentDeleteItems(Array.from(trashSelected));
      }
      if (e.shiftKey && (e.key === 'Delete' || e.key === 'Del')) {
        if (trashSelected.size === 0) return;
        e.preventDefault();
        void restoreTrashItems(Array.from(trashSelected));
      }
      if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        trashSelectAll();
      }
      if (e.key === 'Escape') {
        if (ctxMenu) setCtxMenu(null);
        else trashClearSelection();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        void loadTrash();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctxMenu, trashSelected, permanentDeleteItems, restoreTrashItems, loadTrash, trashSelectAll, trashClearSelection]);

  // 自动 focus
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  if (trashLoading) {
    return (
      <div className="trash-pane" ref={containerRef} tabIndex={0}>
        <div className="trash-pane-loading">
          <div className="loading-spinner" />
          <div>加载回收站…</div>
        </div>
      </div>
    );
  }

  if (trashError) {
    return (
      <div className="trash-pane" ref={containerRef} tabIndex={0}>
        <div className="trash-pane-error">
          <div className="error-icon">⚠</div>
          <div className="error-message">{trashError}</div>
          <button className="trash-retry-btn" onClick={() => void loadTrash()}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="trash-pane" ref={containerRef} tabIndex={0}>
      {/* 工具栏 */}
      <div className="trash-toolbar">
        <span className="trash-title">🗑 回收站</span>
        <span className="trash-count">{trashItems.length} 项</span>
        <div className="trash-toolbar-actions">
          <button className="trash-refresh-btn" onClick={() => void loadTrash()} title="刷新(F5)">⟳</button>
          <button
            className="trash-empty-btn"
            onClick={() => setEmptyConfirm(true)}
            disabled={trashItems.length === 0}
            title="清空回收站"
          >
            清空
          </button>
        </div>
      </div>

      {/* 表头 */}
      <div className="trash-header">
        <SortTh field="name" label="名称" sortBy={sortBy} sortDir={sortDir} onSort={cycleSort} className="col-name" />
        <SortTh field="size" label="大小" sortBy={sortBy} sortDir={sortDir} onSort={cycleSort} className="col-size" />
        <SortTh field="deletedTime" label="删除时间" sortBy={sortBy} sortDir={sortDir} onSort={cycleSort} className="col-mtime" />
        <div className="col col-orig-path">原路径</div>
      </div>

      {/* 列表 */}
      {sortedItems.length === 0 ? (
        <div className="trash-empty">
          <div className="trash-empty-icon">🗑</div>
          <div>回收站为空</div>
        </div>
      ) : (
        <div className="trash-list">
          {sortedItems.map((item) => (
            <div
              key={item.itemPath}
              className={`trash-row ${trashSelected.has(item.itemPath) ? 'selected' : ''}`}
              onClick={(e) => handleRowClick(item, e)}
              onContextMenu={(e) => handleCtxMenu(e, item)}
              onDoubleClick={() => { void restoreTrashItems([item.itemPath]); }}
              title={`原始路径: ${item.originalPath ?? '未知'}\n回收站路径: ${item.itemPath}`}
            >
              <div className="col col-name">
                <span className="row-icon">{item.isDirectory ? '📁' : '📄'}</span>
                <span className="row-name">{item.name}</span>
              </div>
              <div className="col col-size">{item.isDirectory ? '—' : formatSize(item.size)}</div>
              <div className="col col-mtime">{formatDate(item.deletedTime)}</div>
              <div className="col col-orig-path" title={item.originalPath ?? '未知'}>
                {item.originalPath ?? <span className="trash-unknown-path">未知</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          className="sidebar-ctxmenu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="sidebar-ctxmenu-item"
            onClick={() => handleRestore(ctxMenu.itemPath)}
          >
            ↩ 恢复
          </button>
          <button
            className="sidebar-ctxmenu-item danger"
            onClick={() => handlePermanentDelete(ctxMenu.itemPath)}
          >
            🗑 永久删除
          </button>
        </div>
      )}

      {/* 清空确认 */}
      {emptyConfirm && (
        <div className="confirm-overlay" onMouseDown={() => setEmptyConfirm(false)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true">
            <div className="confirm-title">⚠ 清空回收站</div>
            <div className="confirm-message">
              确定要永久删除回收站中的全部 {trashItems.length} 项吗？<br />
              此操作不可恢复。
            </div>
            <div className="confirm-warning">建议：先恢复需要保留的文件</div>
            <div className="confirm-actions">
              <button className="confirm-btn" onClick={() => setEmptyConfirm(false)}>取消</button>
              <button className="confirm-btn confirm-btn-danger" onClick={handleEmptyTrash}>清空</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =================== Sort Header ===================

function SortTh({
  field, label, sortBy, sortDir, onSort, className,
}: {
  field: TrashSortField;
  label: string;
  sortBy: TrashSortField;
  sortDir: TrashSortDir;
  onSort: (f: TrashSortField) => void;
  className: string;
}) {
  const active = sortBy === field;
  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
  return (
    <button
      type="button"
      className={`${className} sort-header ${active ? 'sort-active' : ''}`}
      onClick={() => onSort(field)}
      title={`按${label}排序`}
    >
      {label}{arrow && <span className="sort-arrow">{arrow}</span>}
    </button>
  );
}

// =================== Helpers ===================

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
