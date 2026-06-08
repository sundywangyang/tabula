/**
 * 工具栏
 *
 * 视图模式切换 + 显示选项(隐藏文件 / 隐藏扩展名)
 * 路径按钮 + 刷新
 * P3: 新建文件夹/文件按钮(顶在最左)
 *
 * P2: openPathBar 需要 paneId(每个 pane 独立打开路径栏,这里取 active pane)
 */
import { useMemo } from 'react';
import { useFileStore, type ViewMode } from '../stores/file-store';
import { useFavoritesStore } from '../stores/favorites-store';
import { useLayoutStore } from '../stores/layout-store';
import './Toolbar.css';

const VIEW_MODES: { mode: ViewMode; icon: string; label: string }[] = [
  { mode: 'list', icon: '☰', label: '列表' },
  { mode: 'grid', icon: '▦', label: '网格' },
  { mode: 'details', icon: '☷', label: '详情' },
];

export function Toolbar({ paneId }: { paneId: string }) {
  const viewMode = useFileStore((s) => s.viewMode);
  const setViewMode = useFileStore((s) => s.setViewMode);
  const showHidden = useFileStore((s) => s.showHidden);
  const showExtensions = useFileStore((s) => s.showExtensions);
  const toggleShowHidden = useFileStore((s) => s.toggleShowHidden);
  const toggleShowExtensions = useFileStore((s) => s.toggleShowExtensions);
  const openPathBar = useFileStore((s) => s.openPathBar);
  const refresh = useFileStore((s) => s.refresh);
  const showToast = useFileStore((s) => s.showToast);

  // P5: 收藏
  const currentPath = useFileStore((s) => s.panes[paneId]?.currentPath ?? '');
  const isFavorite = useMemo(
    () => (currentPath ? useFavoritesStore.getState().favorites.some((f) => f.path === currentPath) : false),
    [currentPath],
  );
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const handleToggleFavorite = () => {
    if (!currentPath) {
      showToast('当前未选择目录,无法收藏', 'warn', 1800);
      return;
    }
    const nowFav = toggleFavorite(currentPath);
    showToast(
      nowFav ? `已收藏: ${currentPath}` : '已从收藏移除',
      'success',
      1500,
    );
  };

  // P3: 新建按钮
  const handleNewFolder = () => {
    // 触发 app-level 弹窗
    window.dispatchEvent(
      new CustomEvent('tabula:new-folder', { detail: { paneId } }),
    );
  };
  const handleNewFile = () => {
    window.dispatchEvent(
      new CustomEvent('tabula:new-file', { detail: { paneId } }),
    );
  };

  // P3: 文件操作按钮
  const selectedPaths = useFileStore((s) => s.panes[paneId]?.selectedPaths ?? new Set<string>());
  const clipboard = useFileStore((s) => s.clipboard);
  const copySelected = useFileStore((s) => s.copySelected);
  const cutSelected = useFileStore((s) => s.cutSelected);
  const pasteToPane = useFileStore((s) => s.pasteToPane);
  const beginRename = useFileStore((s) => s.beginRename);
  const cursorPath = useFileStore((s) => s.panes[paneId]?.cursorPath ?? null);
  const hasSelection = selectedPaths.size > 0;
  const hasClipboard = clipboard !== null && clipboard.paths.length > 0;

  const handleCopy = () => copySelected(paneId);
  const handleCut = () => cutSelected(paneId);
  const handlePaste = () => { void pasteToPane(paneId); };
  const handleDelete = () => {
    if (selectedPaths.size === 0) return;
    window.dispatchEvent(
      new CustomEvent('tabula:confirm-delete', {
        detail: { paneId, count: selectedPaths.size },
      }),
    );
  };
  const handleRename = () => {
    if (selectedPaths.size === 0 && !cursorPath) return;
    if (selectedPaths.size > 1) {
      showToast('重命名仅支持单选', 'warn', 1500);
      return;
    }
    const target = cursorPath ?? Array.from(selectedPaths)[0];
    if (target) beginRename(paneId, target);
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-new"
          onClick={handleNewFolder}
          onContextMenu={(e) => {
            e.preventDefault();
            handleNewFile();
          }}
          title="新建文件夹(右键 = 新建文件)"
        >
          <span className="toolbar-icon">＋</span>
          <span className="toolbar-label">新建</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* P3: 文件操作按钮 */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={handleCopy}
          disabled={!hasSelection}
          title="复制 (Ctrl+C)"
        >
          <span className="toolbar-icon">📋</span>
          <span className="toolbar-label">复制</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleCut}
          disabled={!hasSelection}
          title="剪切 (Ctrl+X)"
        >
          <span className="toolbar-icon">✂</span>
          <span className="toolbar-label">剪切</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handlePaste}
          disabled={!hasClipboard}
          title="粘贴 (Ctrl+V)"
        >
          <span className="toolbar-icon">📄</span>
          <span className="toolbar-label">粘贴</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleDelete}
          disabled={!hasSelection}
          title="删除 (Delete)"
        >
          <span className="toolbar-icon">🗑</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleRename}
          disabled={!hasSelection && !cursorPath}
          title="重命名 (F2)"
        >
          <span className="toolbar-icon">✏</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => openPathBar(paneId)}
          title="转到路径 (Ctrl+L)"
        >
          <span className="toolbar-icon">📍</span>
          <span className="toolbar-label">路径</span>
        </button>
        <button className="toolbar-btn" onClick={() => void refresh(paneId)} title="刷新 (F5)">
          <span className="toolbar-icon">⟳</span>
        </button>
        <button
          className={`toolbar-btn toolbar-fav ${isFavorite ? 'active' : ''}`}
          onClick={handleToggleFavorite}
          disabled={!currentPath}
          title={isFavorite ? '从收藏移除' : '收藏当前目录'}
        >
          <span className="toolbar-icon">{isFavorite ? '★' : '☆'}</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        {VIEW_MODES.map((m) => (
          <button
            key={m.mode}
            className={`toolbar-btn ${viewMode === m.mode ? 'active' : ''}`}
            onClick={() => setViewMode(m.mode)}
            title={`${m.label}视图`}
          >
            <span className="toolbar-icon">{m.icon}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-divider" />

      {/* P2 v2: 分屏 — 左/右 / 上/下 */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => {
            useLayoutStore.getState().pane.splitPane(paneId, 'horizontal');
          }}
          title="左右分屏 (Ctrl+\\)"
        >
          <span className="toolbar-icon">◫</span>
          <span className="toolbar-label">分屏</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={() => {
            useLayoutStore.getState().pane.splitPane(paneId, 'vertical');
          }}
          title="上下分屏 (Ctrl+Shift+\\)"
        >
          <span className="toolbar-icon">▭</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${showHidden ? 'active' : ''}`}
          onClick={toggleShowHidden}
          title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
        >
          {showHidden ? (
            <span className="toolbar-icon">👁</span>
          ) : (
            <span className="toolbar-icon toolbar-icon-muted">👁‍🗨</span>
          )}
          <span className="toolbar-label">.{showHidden ? '已显' : '隐藏'}</span>
        </button>
        <button
          className={`toolbar-btn ${showExtensions ? 'active' : ''}`}
          onClick={toggleShowExtensions}
          title={showExtensions ? '隐藏扩展名' : '显示扩展名'}
        >
          <span className="toolbar-icon">𝝰</span>
          <span className="toolbar-label">{showExtensions ? '扩展名:开' : '扩展名:关'}</span>
        </button>
      </div>
    </div>
  );
}
