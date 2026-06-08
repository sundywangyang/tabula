/**
 * 全局搜索 (Ctrl+P / Ctrl+Shift+F)
 *
 * 类似 VS Code / Raycast:全屏 overlay,输入即搜索,↑↓ 选择,Enter 打开。
 * v1 数据源:使用 fs:search IPC 递归搜索当前 pane 目录,
 * 支持文件类型过滤和分页。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFileStore, type FileTypeFilter } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import './GlobalSearch.css';

const MAX_VISIBLE = 50;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const FILE_TYPE_LABELS: Record<FileTypeFilter, string> = {
  all: '全部',
  image: '图片',
  document: '文档',
  code: '代码',
  archive: '压缩包',
};

export function GlobalSearch() {
  const gs = useFileStore((s) => s.globalSearch);
  const close = useFileStore((s) => s.closeGlobalSearch);
  const setQuery = useFileStore((s) => s.setGlobalSearchQuery);
  const setFileType = useFileStore((s) => s.setGlobalSearchFileType);
  const setSelected = useFileStore((s) => s.setGlobalSearchSelectedIndex);
  const setPage = useFileStore((s) => s.setGlobalSearchPage);
  const runSearch = useFileStore((s) => s.runGlobalSearch);
  const loadDir = useFileStore((s) => s.loadDir);
  const showToast = useFileStore((s) => s.showToast);
  const replaceTabPath = useLayoutStore((s) => s.pane.replaceTabPath);
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时自动 focus
  useEffect(() => {
    if (gs.open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [gs.open]);

  // 滚到选中
  useEffect(() => {
    if (!gs.open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-idx="${gs.selectedIndex}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [gs.selectedIndex, gs.open]);

  // Esc 关闭
  useEffect(() => {
    if (!gs.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [gs.open, close]);

  // 分页数据
  const totalPages = useMemo(() => Math.max(1, Math.ceil(gs.results.length / gs.pageSize)), [gs.results.length, gs.pageSize]);
  const visibleResults = useMemo(() => {
    const start = gs.page * gs.pageSize;
    return gs.results.slice(start, start + gs.pageSize);
  }, [gs.results, gs.page, gs.pageSize]);

  const handleSelect = (idx: number) => {
    const actualIdx = gs.page * gs.pageSize + idx;
    if (actualIdx < 0 || actualIdx >= gs.results.length) return;
    const hit = gs.results[actualIdx];
    if (!hit) return;
    if (hit.isDirectory) {
      // 目录:跳到 active pane
      void loadDir(activePaneId, hit.path);
      // 同步 tab path(如果有 active tab)
      const layout = useLayoutStore.getState().rootLayout;
      const paneNode = findPane(layout, activePaneId);
      if (paneNode?.type === 'pane' && paneNode.activeTabId) {
        replaceTabPath(activePaneId, paneNode.activeTabId, hit.path);
      }
      showToast(`已切换到: ${hit.name}`, 'info', 1500);
    } else {
      // 文件:尝试用系统打开(走 fs.openPath 调 shell)
      void window.tabula.fs.openPath(hit.path);
      showToast(`已打开: ${hit.name}`, 'info', 1500);
    }
    close();
  };

  const handleSearch = () => {
    if (gs.query.trim()) {
      void runSearch(gs.query, gs.rootPath || 'C:\\', gs.fileType);
    }
  };

  const handleFileTypeChange = (type: FileTypeFilter) => {
    setFileType(type);
  };

  if (!gs.open) return null;

  return (
    <div
      className="gs-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="gs-panel">
        <div className="gs-header">
          <span className="gs-icon">🔍</span>
          <input
            ref={inputRef}
            className="gs-input"
            value={gs.query}
            placeholder="搜索文件名(输入后按 Enter 搜索,支持递归)"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // input 自己处理:Enter / ↑↓,App.tsx 全局 Ctrl+P 在 input 失焦后才触发
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIdx = (gs.page * gs.pageSize + gs.selectedIndex + 1) % gs.results.length;
                setSelected(nextIdx);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIdx = (gs.page * gs.pageSize + gs.selectedIndex - 1 + gs.results.length) % gs.results.length;
                setSelected(prevIdx);
              } else if (e.key === 'Tab') {
                e.preventDefault();
                const delta = e.shiftKey ? -1 : 1;
                const nextIdx = (gs.page * gs.pageSize + gs.selectedIndex + delta + gs.results.length) % gs.results.length;
                setSelected(nextIdx);
              }
            }}
          />
          {gs.scanning && (
            <span className="gs-scan-status">
              <span className="loading-spinner-small" /> 搜索中…
            </span>
          )}
        </div>

        {/* 文件类型过滤 */}
        <div className="gs-filters">
          {(Object.keys(FILE_TYPE_LABELS) as FileTypeFilter[]).map((type) => (
            <button
              key={type}
              className={`gs-filter-btn ${gs.fileType === type ? 'active' : ''}`}
              onClick={() => handleFileTypeChange(type)}
              type="button"
            >
              {FILE_TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        <div className="gs-stats">
          {gs.scanning ? (
            <span>正在递归搜索: {gs.rootPath || 'C:\\'}…</span>
          ) : (
            <span>
              {gs.query ? (
                <>
                  找到 {gs.results.length} 项
                  {gs.elapsedMs > 0 && ` (${gs.elapsedMs}ms)`}
                  {totalPages > 1 && ` · 第 ${gs.page + 1}/${totalPages} 页`}
                </>
              ) : (
                '输入关键字后按 Enter 搜索'
              )}
              {gs.scanError && <span className="gs-scan-error"> · {gs.scanError}</span>}
            </span>
          )}
        </div>

        <div className="gs-list" ref={listRef}>
          {visibleResults.length === 0 && !gs.scanning && (
            <div className="gs-empty">
              {gs.query ? '无匹配结果' : '输入关键字开始搜索'}
            </div>
          )}
          {visibleResults.map((hit, i) => (
            <div
              key={hit.path}
              data-idx={gs.page * gs.pageSize + i}
              className={`gs-row ${i === gs.selectedIndex ? 'gs-row-selected' : ''}`}
              onMouseEnter={() => setSelected(gs.page * gs.pageSize + i)}
              onClick={() => handleSelect(i)}
            >
              <span className="gs-row-icon">{hit.isDirectory ? '📁' : '📄'}</span>
              <span className="gs-row-name" title={hit.name}>
                <HighlightMatch name={hit.name} query={gs.query} />
              </span>
              <span className="gs-row-meta">
                <span className="gs-row-path" title={hit.path}>
                  {hit.path}
                </span>
                <span className="gs-row-info">
                  {hit.isDirectory ? '文件夹' : formatSize(hit.size)} · {formatDate(hit.mtime)}
                  {hit.matchType && hit.matchType !== 'exact' && (
                    <span className="gs-match-type"> ({hit.matchType})</span>
                  )}
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="gs-pagination">
            <button
              className="gs-page-btn"
              onClick={() => setPage(gs.page - 1)}
              disabled={gs.page === 0}
              type="button"
            >
              ← 上一页
            </button>
            <span className="gs-page-info">
              {gs.page + 1} / {totalPages}
            </span>
            <button
              className="gs-page-btn"
              onClick={() => setPage(gs.page + 1)}
              disabled={gs.page >= totalPages - 1}
              type="button"
            >
              下一页 →
            </button>
          </div>
        )}

        <div className="gs-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 搜索/打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <span className="gs-footer-hint">提示:<kbd>Ctrl+F</kbd> 当前目录过滤</span>
        </div>
      </div>
    </div>
  );
}

// =================== 高亮匹配组件 ===================

function HighlightMatch({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>;

  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerName.indexOf(lowerQuery);

  if (idx < 0) return <>{name}</>;

  return (
    <>
      {name.slice(0, idx)}
      <mark className="gs-highlight">{name.slice(idx, idx + query.length)}</mark>
      {name.slice(idx + query.length)}
    </>
  );
}

// =================== 工具 ===================

function findPane(
  node: import('@tabula/bridge').LayoutNode,
  paneId: string,
): import('@tabula/bridge').LayoutNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  for (const c of node.children) {
    const r = findPane(c, paneId);
    if (r) return r;
  }
  return null;
}
