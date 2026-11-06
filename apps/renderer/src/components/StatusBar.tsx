/**
 * 状态栏
 *
 * P1: 项目数、选中数、排序方式、视图模式
 * P2: 加 layout 提示(active pane index / total panes)
 * P3: 加 clipboard 状态(copy / cut 模式 + 计数)+ 进度提示
 * P4: 加搜索过滤提示 + 全局搜索快捷键提示(Ctrl+P)
 */
import './StatusBar.css';
import type { SortField } from '../stores/file-store';
import { useFileStore } from '../stores/file-store';
import { useLayoutStore } from '../stores/layout-store';
import { ThemeToggle } from './ThemeToggle';
import { Copy, Scissors, Search, LoaderCircle, Terminal, X } from 'lucide-react';

const SORT_LABELS: Record<SortField, string> = {
  name: '名称',
  size: '大小',
  mtime: '修改时间',
  type: '类型',
};

export function StatusBar({
  count,
  version,
  selectedCount,
  sortBy,
  sortDir,
  paneCount,
  activePaneIndex,
}: {
  count: number;
  version: string;
  selectedCount: number;
  sortBy: SortField;
  sortDir: 'asc' | 'desc' | null;
  paneCount: number;
  activePaneIndex: number;
}) {
  const sortDirText = sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '(无)';
  const clipboard = useFileStore((s) => s.clipboard);
  const progress = useFileStore((s) => s.progress);
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const searchQuery = useFileStore((s) => s.panes[activePaneId]?.searchQuery ?? '');
  const clearSearch = useFileStore((s) => s.clearSearch);
  return (
    <div className="status-bar">
      <div className="status-left">
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
              <Search size={12} /> 过滤: <strong>{searchQuery}</strong>
              <button
                className="status-filter-clear"
                onClick={() => clearSearch(activePaneId)}
                title="清空过滤"
              >
                <X size={11} />
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
              {clipboard.mode === 'cut' ? <Scissors size={12} /> : <Copy size={12} />} {clipboard.mode === 'cut' ? '将粘贴' : '已复制'} {clipboard.paths.length} 项
            </span>
          </>
        )}
        {progress && (
          <>
            <span className="status-divider">·</span>
            <span className="status-item status-progress" title={progress.message}>
              <LoaderCircle size={12} /> {progress.message}
            </span>
          </>
        )}
      </div>
      <div className="status-right">
        <span className="status-item" title={`排序:${SORT_LABELS[sortBy]} ${sortDirText}`}>
          排序: {SORT_LABELS[sortBy]} {sortDirText}
        </span>
        <span className="status-divider">·</span>
        <span
          className="status-item"
          title={`active pane #${activePaneIndex} / ${paneCount} panes`}
        >
          窗格 {activePaneIndex} / {paneCount}
        </span>
        <span className="status-divider">·</span>
        <button
          className="status-icon-btn"
          onClick={() => window.tabula.app.openDevTools()}
          title="DevTools"
        >
          <Terminal size={12} />
        </button>
        <span className="status-divider">·</span>
        {version && <span className="status-version" title={`Tabula ${version}`}>v{version}</span>}
        <ThemeToggle />
      </div>
    </div>
  );
}
