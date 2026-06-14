/**
 * 状态栏
 *
 * P1: 当前路径、选中数、排序方式、视图模式
 * P2: 加 layout 提示(active pane index / total panes)
 * P3: 加 clipboard 状态(copy / cut 模式 + 计数)+ 进度提示
 * P4: 加搜索过滤提示 + 全局搜索快捷键提示(Ctrl+P)
 */
import './StatusBar.css';
import type { SortField } from '../stores/file-store';
import { useFileStore } from '../stores/file-store';
import { useLayoutStore } from '../stores/layout-store';
import { ThemeToggle } from './ThemeToggle';
import { PanelLeft, PanelLeftClose, Settings, Terminal } from 'lucide-react';

const SORT_LABELS: Record<SortField, string> = {
  name: '名称',
  size: '大小',
  mtime: '修改时间',
  type: '类型',
};

const VIEW_LABELS = {
  list: '列表',
  grid: '网格',
  details: '详情',
};

export function StatusBar({
  path,
  count,
  version,
  selectedCount,
  sortBy,
  sortDir,
  paneCount,
  activePaneIndex,
  sidebarVisible,
  onToggleSidebar,
  onSettingsOpen,
}: {
  path: string;
  count: number;
  version: string;
  selectedCount: number;
  sortBy: SortField;
  sortDir: 'asc' | 'desc' | null;
  paneCount: number;
  activePaneIndex: number;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onSettingsOpen?: () => void;
}) {
  const sortDirText = sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '(无)';
  const clipboard = useFileStore((s) => s.clipboard);
  const progress = useFileStore((s) => s.progress);
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const viewMode = useFileStore((s) => s.panes[activePaneId]?.viewMode ?? 'details');
  const searchQuery = useFileStore((s) => s.panes[activePaneId]?.searchQuery ?? '');
  const clearSearch = useFileStore((s) => s.clearSearch);
  return (
    <div className="status-bar">
      <div className="status-left">
        <div className="status-logo">
          <span className="logo-mark">▣</span>
          <span className="logo-text">Tabula</span>
          {version && <span className="logo-version">v{version}</span>}
        </div>
        <button
          type="button"
          className="status-sidebar-toggle"
          onClick={onToggleSidebar}
          title={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
          aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
        >
          {sidebarVisible ? <PanelLeftClose size={13} /> : <PanelLeft size={13} />}
        </button>
        <span className="status-divider">·</span>
        <span className="status-item" title={path}>📁 {path || '—'}</span>
        <span className="status-divider">·</span>
        <span className="status-item">
          {count} 项{selectedCount > 0 ? <strong className="status-selected"> · 已选 {selectedCount}</strong> : null}
        </span>
        {searchQuery && (
          <>
            <span className="status-divider">·</span>
            <span
              className="status-item status-filter"
              title={`当前目录过滤: ${searchQuery}`}
            >
              🔍 过滤: <strong>{searchQuery}</strong>
              <button
                className="status-filter-clear"
                onClick={() => clearSearch(activePaneId)}
                title="清空过滤"
              >
                ✕
              </button>
            </span>
          </>
        )}
        {clipboard && clipboard.paths.length > 0 && (
          <>
            <span className="status-divider">·</span>
            <span
              className={`status-item status-clipboard ${
                clipboard.mode === 'cut' ? 'status-clipboard-cut' : ''
              }`}
              title={
                clipboard.mode === 'cut'
                  ? `将粘贴 ${clipboard.paths.length} 项(按 Ctrl+V 粘贴到当前目录)`
                  : `已复制 ${clipboard.paths.length} 项(可粘贴)`
              }
            >
              {clipboard.mode === 'cut' ? '✂ 将粘贴' : '⎘ 已复制'} {clipboard.paths.length} 项
            </span>
          </>
        )}
        {progress && (
          <>
            <span className="status-divider">·</span>
            <span className="status-item status-progress" title={progress.message}>
              ⏳ {progress.message}
            </span>
          </>
        )}
      </div>
      <div className="status-right">
        <span
          className="status-item status-hint"
          title="按 Ctrl+P 打开全局模糊搜索"
        >
          <kbd>Ctrl</kbd>+<kbd>P</kbd> 全局搜索
        </span>
        <span className="status-divider">·</span>
        <span className="status-item" title={`视图:${VIEW_LABELS[viewMode]}`}>
          👁 {VIEW_LABELS[viewMode]}
        </span>
        <span className="status-divider">·</span>
        <span className="status-item" title={`排序:${SORT_LABELS[sortBy]} ${sortDirText}`}>
          排序: {SORT_LABELS[sortBy]} {sortDirText}
        </span>
        <span className="status-divider">·</span>
        <span
          className="status-item"
          title={`active pane #${activePaneIndex} / ${paneCount} panes`}
        >
          layout: [{activePaneIndex}] / [{paneCount}]
        </span>
        <span className="status-divider">·</span>
        <span className="status-item">Tabula v{version}</span>
        <span className="status-divider">·</span>
        <button
          className="status-icon-btn"
          onClick={onSettingsOpen}
          title="设置 (Ctrl+,)"
        >
          <Settings size={12} />
        </button>
        <button
          className="status-icon-btn"
          onClick={() => window.tabula.app.openDevTools()}
          title="DevTools"
        >
          <Terminal size={12} />
        </button>
        <span className="status-divider">·</span>
        <ThemeToggle />
      </div>
    </div>
  );
}
