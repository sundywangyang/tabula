/**
 * 侧边栏 (P5 完整版)
 *
 * Sections:
 * - 快速访问:favorites(可点跳转,右键菜单:重命名/删除;顶部 + 按钮加当前目录)
 * - 历史:history(最近 50 条,可点跳转;右键可清除)
 * - 此电脑:drives(从 fs.listDrives 拉;可点跳到根)
 * - 当前:当前路径只读显示
 *
 * 拖放:P3 已支持 — favorites / drives / 当前 都作为 drop target。
 */
import { type DragEvent as ReactDragEvent, useEffect, useState } from 'react';
import type { DriveInfo } from '@tabula/bridge';
import { useFileStore } from '../stores/file-store';
import { useFavoritesStore } from '../stores/favorites-store';
import './Sidebar.css';

function formatBytes(n: number): string {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

type ContextMenuState =
  | { kind: 'favorite'; path: string; x: number; y: number }
  | { kind: 'history'; path: string; x: number; y: number }
  | { kind: 'trash'; x: number; y: number }
  | null;

const TRASH_PATH = 'trash:///';

export function Sidebar({
  currentPath,
  onOpenPath,
}: {
  currentPath: string;
  onOpenPath: (path: string) => void;
}) {
  const dragState = useFileStore((s) => s.dragState);
  const setDragTarget = useFileStore((s) => s.setDragTarget);
  const endDrag = useFileStore((s) => s.endDrag);
  const performBulk = useFileStore((s) => s.performBulk);
  const showToast = useFileStore((s) => s.showToast);

  // P3: 回收站状态
  const trashItems = useFileStore((s) => s.trashItems);
  const trashLoading = useFileStore((s) => s.trashLoading);
  const loadTrash = useFileStore((s) => s.loadTrash);
  const emptyTrash = useFileStore((s) => s.emptyTrash);

  const favorites = useFavoritesStore((s) => s.favorites);
  const history = useFavoritesStore((s) => s.history);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);
  const renameFavorite = useFavoritesStore((s) => s.renameFavorite);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const clearHistory = useFavoritesStore((s) => s.clearHistory);

  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  // 拉驱动器列表(组件挂载时一次 + 手动刷新按钮)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await window.tabula.fs.listDrives();
        if (!cancelled) setDrives(Array.isArray(list) ? list : []);
      } catch (e) {
        console.warn('[Sidebar] listDrives failed', e);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 全局点击关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu(null);
        setRenamingPath(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const handleItemDragOver = (
    e: ReactDragEvent<HTMLButtonElement>,
    targetPath: string,
  ) => {
    if (!dragState || !targetPath) return;
    e.preventDefault();
    e.stopPropagation();
    const effect: 'move' | 'copy' = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    e.dataTransfer.dropEffect = effect;
    setDragTarget(targetPath, 'sidebar', effect);
  };

  const handleItemDrop = async (
    e: ReactDragEvent<HTMLButtonElement>,
    targetPath: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const state = useFileStore.getState().dragState;
    if (!state || !targetPath) {
      endDrag();
      return;
    }
    const mode: 'copy' | 'move' = state.effect === 'copy' ? 'copy' : 'move';
    await performBulk(state.paths, targetPath, mode);
    endDrag();
  };

  // 右键菜单:favorite
  const openFavoriteCtx = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: 'favorite', path, x: e.clientX, y: e.clientY });
  };

  const openHistoryCtx = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: 'history', path, x: e.clientX, y: e.clientY });
  };

  const handleAddCurrent = () => {
    if (!currentPath) {
      showToast('当前未选择目录,无法收藏', 'warn', 2000);
      return;
    }
    if (favorites.some((f) => f.path === currentPath)) {
      showToast('已在收藏中', 'info', 1500);
      return;
    }
    addFavorite(currentPath);
    showToast(`已收藏: ${currentPath}`, 'success', 1800);
  };

  const commitRename = () => {
    if (renamingPath && renameValue.trim()) {
      renameFavorite(renamingPath, renameValue);
    }
    setRenamingPath(null);
  };

  return (
    <aside className="sidebar">
      {/* 快速访问 */}
      <div className="sidebar-section">
        <div className="sidebar-header-row">
          <span className="sidebar-header">快速访问</span>
          <button
            className="sidebar-header-btn"
            onClick={handleAddCurrent}
            title={`收藏当前目录${currentPath ? `: ${currentPath}` : ''}`}
          >
            ＋
          </button>
        </div>
        {favorites.length === 0 ? (
          <div className="sidebar-empty">右键当前目录或点 ＋ 收藏</div>
        ) : (
          favorites.map((f) => {
            const isOver =
              dragState &&
              dragState.targetKind === 'sidebar' &&
              dragState.targetPath === f.path;
            const isRenaming = renamingPath === f.path;
            return (
              <button
                key={f.id}
                className={`sidebar-item ${currentPath === f.path ? 'active' : ''} ${
                  isOver ? 'drag-over' : ''
                }`}
                onClick={() => onOpenPath(f.path)}
                onContextMenu={(e) => openFavoriteCtx(e, f.path)}
                onDragOver={(e) => handleItemDragOver(e, f.path)}
                onDragLeave={() => setDragTarget(null, null, dragState?.effect ?? 'move')}
                onDrop={(e) => void handleItemDrop(e, f.path)}
                title={f.path}
              >
                <span className="sidebar-icon">★</span>
                {isRenaming ? (
                  <input
                    className="sidebar-rename-input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingPath(null);
                    }}
                  />
                ) : (
                  <span className="sidebar-name">{f.label}</span>
                )}
                <button
                  className="sidebar-remove-btn"
                  title={`移除 "${f.label}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    removeFavorite(f.path);
                    showToast('已从收藏移除', 'info', 1500);
                  }}
                >
                  ✕
                </button>
              </button>
            );
          })
        )}
      </div>

      {/* 历史 */}
      <div className="sidebar-section">
        <div className="sidebar-header-row">
          <span className="sidebar-header">历史</span>
          {history.length > 0 && (
            <button
              className="sidebar-header-btn"
              onClick={clearHistory}
              title="清空历史"
            >
              ✕
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="sidebar-empty">暂无历史</div>
        ) : (
          history.slice(0, 20).map((h, idx) => {
            const isOver =
              dragState &&
              dragState.targetKind === 'sidebar' &&
              dragState.targetPath === h.path;
            const segs = h.path.split(/[\\/]/).filter(Boolean);
            const display = segs[segs.length - 1] || h.path;
            return (
              <button
                key={`${h.path}-${idx}`}
                className={`sidebar-item ${currentPath === h.path ? 'active' : ''} ${
                  isOver ? 'drag-over' : ''
                }`}
                onClick={() => onOpenPath(h.path)}
                onContextMenu={(e) => openHistoryCtx(e, h.path)}
                onDragOver={(e) => handleItemDragOver(e, h.path)}
                onDragLeave={() => setDragTarget(null, null, dragState?.effect ?? 'move')}
                onDrop={(e) => void handleItemDrop(e, h.path)}
                title={h.path}
              >
                <span className="sidebar-icon">↩</span>
                <span className="sidebar-name">{display}</span>
              </button>
            );
          })
        )}
      </div>

      {/* 回收站 (P3) */}
      <div className="sidebar-section">
        <div className="sidebar-header-row">
          <span className="sidebar-header">系统</span>
        </div>
        <button
          className={`sidebar-item ${currentPath === TRASH_PATH ? 'active' : ''}`}
          onClick={() => onOpenPath(TRASH_PATH)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ kind: 'trash', x: e.clientX, y: e.clientY });
          }}
          title="回收站"
        >
          <span className="sidebar-icon">🗑</span>
          <span className="sidebar-name">回收站</span>
          {trashItems.length > 0 && (
            <span className="sidebar-badge">{trashItems.length}</span>
          )}
        </button>
      </div>

      {/* 此电脑 / 驱动器 */}
      <div className="sidebar-section">
        <div className="sidebar-header-row">
          <span className="sidebar-header">此电脑</span>
          <button
            className="sidebar-header-btn"
            onClick={async () => {
              try {
                const list = await window.tabula.fs.listDrives();
                setDrives(Array.isArray(list) ? list : []);
              } catch (e) {
                console.warn('[Sidebar] refresh drives failed', e);
              }
            }}
            title="刷新驱动器列表"
          >
            ⟳
          </button>
        </div>
        {drives.length === 0 ? (
          <div className="sidebar-empty">未检测到驱动器</div>
        ) : (
          drives.map((d) => {
            const isOver =
              dragState &&
              dragState.targetKind === 'sidebar' &&
              dragState.targetPath === d.mount;
            const sizeText =
              d.totalBytes > 0
                ? ` (${formatBytes(d.freeBytes)} 可用 / ${formatBytes(d.totalBytes)})`
                : '';
            const display = d.mount.endsWith('\\') || d.mount.endsWith('/') ? d.mount : d.mount;
            const labelDisplay = d.label && d.label !== d.mount ? `${display} ${d.label}` : display;
            return (
              <button
                key={d.mount}
                className={`sidebar-item ${currentPath === d.mount ? 'active' : ''} ${
                  isOver ? 'drag-over' : ''
                }`}
                onClick={() => onOpenPath(d.mount)}
                onDragOver={(e) => handleItemDragOver(e, d.mount)}
                onDragLeave={() => setDragTarget(null, null, dragState?.effect ?? 'move')}
                onDrop={(e) => void handleItemDrop(e, d.mount)}
                title={d.mount}
              >
                <span className="sidebar-icon">💾</span>
                <span className="sidebar-name">
                  {labelDisplay}
                  {sizeText && <span className="sidebar-meta">{sizeText}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* 当前路径 */}
      {currentPath && (
        <div className="sidebar-section">
          <div className="sidebar-header">当前</div>
          <div
            className={`sidebar-current-path ${
              dragState && dragState.targetKind === 'sidebar' && dragState.targetPath === currentPath
                ? 'drag-over'
                : ''
            }`}
            title={currentPath}
            onDragOver={(e) => handleItemDragOver(e as unknown as ReactDragEvent<HTMLButtonElement>, currentPath)}
            onDragLeave={() => setDragTarget(null, null, dragState?.effect ?? 'move')}
            onDrop={(e) => void handleItemDrop(e as unknown as ReactDragEvent<HTMLButtonElement>, currentPath)}
          >
            {currentPath}
          </div>
        </div>
      )}

      {/* 右键菜单(自定义渲染,不走浏览器默认) */}
      {ctxMenu && (
        <div
          className="sidebar-ctxmenu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.kind === 'favorite' && (
            <>
              <button
                className="sidebar-ctxmenu-item"
                onClick={() => {
                  setRenamingPath(ctxMenu.path);
                  const f = favorites.find((x) => x.path === ctxMenu.path);
                  setRenameValue(f?.label ?? '');
                  setCtxMenu(null);
                }}
              >
                重命名
              </button>
              <button
                className="sidebar-ctxmenu-item danger"
                onClick={() => {
                  removeFavorite(ctxMenu.path);
                  showToast('已从收藏移除', 'info', 1500);
                  setCtxMenu(null);
                }}
              >
                删除
              </button>
            </>
          )}
          {ctxMenu.kind === 'history' && (
            <button
              className="sidebar-ctxmenu-item"
              onClick={() => {
                onOpenPath(ctxMenu.path);
                setCtxMenu(null);
              }}
            >
              打开
            </button>
          )}
          {ctxMenu.kind === 'trash' && (
            <>
              <button
                className="sidebar-ctxmenu-item"
                onClick={() => {
                  void loadTrash();
                  setCtxMenu(null);
                }}
              >
                刷新
              </button>
              <button
                className="sidebar-ctxmenu-item danger"
                onClick={async () => {
                  setCtxMenu(null);
                  if (trashItems.length === 0) {
                    showToast('回收站已经是空的', 'info', 2000);
                    return;
                  }
                  await emptyTrash();
                }}
              >
                清空回收站
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
