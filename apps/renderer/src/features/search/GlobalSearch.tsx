/**
 * 全局搜索 (Ctrl+P / Ctrl+Shift+F)
 *
 * 类似 VS Code / Raycast:全屏 overlay,输入即搜索,↑↓ 选择,Enter 打开。
 * v1 数据源:使用 fs:search IPC 递归搜索当前 pane 目录,
 * 支持文件类型过滤和分页。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SavedSearch, SearchRequest } from '@tabula/bridge';
import { useFileStore, type FileTypeFilter } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import { getCachedRootPath } from '../../platform-cache';
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
  const keyboardSelection = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [minMb, setMinMb] = useState('');
  const [maxMb, setMaxMb] = useState('');
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  const [recentDays, setRecentDays] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<SavedSearch[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [filterError, setFilterError] = useState('');
  useEffect(() => {
    let active = true;
    if (gs.open) {
      setMinMb(''); setMaxMb(''); setAfter(''); setBefore(''); setRecentDays('');
      setPresetName(''); setSelectedPreset(''); setFilterError(''); keyboardSelection.current = false;
      void window.tabula.config.all().then(config => { if (active) setPresets(config.savedSearches ?? []); }).catch(console.warn);
    }
    return () => { active = false; };
  }, [gs.open]);

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

  const handleSelect = (actualIdx: number) => {
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
    keyboardSelection.current = false;
    const criteria = buildCriteria();
    if (criteria) void runSearch(gs.query, gs.rootPath || getCachedRootPath(), gs.fileType, criteria);
  };

  const buildCriteria = (): Pick<SearchRequest, 'minSize' | 'maxSize' | 'modifiedAfter' | 'modifiedBefore'> | null => {
    const minSize = minMb === '' ? undefined : Number(minMb) * 1024 * 1024;
    const maxSize = maxMb === '' ? undefined : Number(maxMb) * 1024 * 1024;
    const modifiedAfter = recentDays ? Date.now() - Number(recentDays) * 86400000 : after ? new Date(`${after}T00:00:00`).getTime() : undefined;
    const endDate = before && !recentDays ? new Date(`${before}T00:00:00`) : undefined;
    if (endDate) endDate.setDate(endDate.getDate() + 1);
    const modifiedBefore = endDate?.getTime();
    if ((minSize !== undefined && (!Number.isFinite(minSize) || minSize < 0)) || (maxSize !== undefined && (!Number.isFinite(maxSize) || maxSize < 0)) ||
      (minSize !== undefined && maxSize !== undefined && minSize > maxSize) ||
      (modifiedAfter !== undefined && !Number.isFinite(modifiedAfter)) || (modifiedBefore !== undefined && !Number.isFinite(modifiedBefore)) ||
      (modifiedAfter !== undefined && modifiedBefore !== undefined && modifiedAfter >= modifiedBefore)) {
      setFilterError('请检查大小和日期范围'); return null;
    }
    setFilterError(''); return { minSize, maxSize, modifiedAfter, modifiedBefore };
  };
  const savePreset = async () => {
    const criteria = buildCriteria();
    const name = presetName.trim();
    if (!criteria || !name) { if (!name) setFilterError('请输入搜索名称'); return; }
    const preset: SavedSearch = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, query: gs.query,
      rootPath: gs.rootPath || getCachedRootPath(), fileType: gs.fileType, ...criteria,
      ...(recentDays ? { modifiedWithinDays: Number(recentDays), modifiedAfter: undefined } : {}) };
    try {
      const current = (await window.tabula.config.all()).savedSearches ?? [];
      const next = [...current, preset]; await window.tabula.config.set('savedSearches', next);
      setPresets(next); setPresetName('');
    } catch (error) { setFilterError(`保存失败: ${String(error)}`); }
  };
  const applyPreset = (preset: SavedSearch) => {
    setSelectedPreset(preset.id);
    setMinMb(preset.minSize === undefined ? '' : String(preset.minSize / 1048576));
    setMaxMb(preset.maxSize === undefined ? '' : String(preset.maxSize / 1048576));
    const dateText = (value?: number) => value === undefined ? '' : new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    setAfter(dateText(preset.modifiedAfter)); setBefore(dateText(preset.modifiedBefore === undefined ? undefined : preset.modifiedBefore - 1));
    setRecentDays(preset.modifiedWithinDays ? String(preset.modifiedWithinDays) : '');
    const criteria = { minSize: preset.minSize, maxSize: preset.maxSize,
      modifiedAfter: preset.modifiedWithinDays ? Date.now() - preset.modifiedWithinDays * 86400000 : preset.modifiedAfter,
      modifiedBefore: preset.modifiedBefore };
    useFileStore.setState(s => ({ globalSearch: { ...s.globalSearch, query: preset.query, rootPath: preset.rootPath, fileType: preset.fileType } }));
    void runSearch(preset.query, preset.rootPath, preset.fileType, criteria);
  };
  const deletePreset = async () => {
    try {
      const current = (await window.tabula.config.all()).savedSearches ?? [];
      const next = current.filter(item => item.id !== selectedPreset);
      await window.tabula.config.set('savedSearches', next); setPresets(next); setSelectedPreset('');
    } catch (error) { setFilterError(`删除失败: ${String(error)}`); }
  };

  const handleFileTypeChange = (type: FileTypeFilter) => {
    setFileType(type);
    const criteria = buildCriteria();
    if (criteria) void runSearch(gs.query, gs.rootPath || getCachedRootPath(), type, criteria);
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
            onChange={(e) => { keyboardSelection.current = false; setQuery(e.target.value); }}
            onKeyDown={(e) => {
              // input 自己处理:Enter / ↑↓,App.tsx 全局 Ctrl+P 在 input 失焦后才触发
              if (e.key === 'Enter') {
                e.preventDefault();
                if (keyboardSelection.current && gs.results.length) handleSelect(gs.selectedIndex);
                else handleSearch();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!gs.results.length) return;
                const nextIdx = (gs.selectedIndex + 1) % gs.results.length;
                keyboardSelection.current = true;
                setSelected(nextIdx);
                setPage(Math.floor(nextIdx / gs.pageSize));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!gs.results.length) return;
                const prevIdx = (gs.selectedIndex - 1 + gs.results.length) % gs.results.length;
                keyboardSelection.current = true;
                setSelected(prevIdx);
                setPage(Math.floor(prevIdx / gs.pageSize));
              }
            }}
          />
          {gs.scanning && (
            <span className="gs-scan-status">
              <span className="loading-spinner-small" /> 搜索中…
            </span>
          )}
        </div>

        <div className="gs-advanced">
          <label>最小大小 MB<input aria-label="最小大小 MB" type="number" min="0" value={minMb} onChange={e => setMinMb(e.target.value)} /></label>
          <label>最大大小 MB<input aria-label="最大大小 MB" type="number" min="0" value={maxMb} onChange={e => setMaxMb(e.target.value)} /></label>
          <label>修改时间<select aria-label="修改时间" value={recentDays} onChange={e => setRecentDays(e.target.value)}><option value="">指定日期</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></label>
          {!recentDays && <><label>起始日期<input aria-label="起始日期" type="date" value={after} onChange={e => setAfter(e.target.value)} /></label><label>结束日期<input aria-label="结束日期" type="date" value={before} onChange={e => setBefore(e.target.value)} /></label></>}
          <button type="button" onClick={handleSearch}>搜索</button>
        </div>
        <div className="gs-advanced">
          <input aria-label="搜索名称" placeholder="保存搜索名称" value={presetName} onChange={e => setPresetName(e.target.value)} />
          <button type="button" onClick={() => void savePreset()}>保存搜索</button>
          <select aria-label="已保存的搜索" value={selectedPreset} onChange={e => { const preset = presets.find(item => item.id === e.target.value); if (preset) applyPreset(preset); else setSelectedPreset(''); }}>
            <option value="">选择已保存的搜索</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
          <button type="button" disabled={!selectedPreset} onClick={() => void deletePreset()}>删除搜索</button>
          {filterError && <span role="alert">{filterError}</span>}
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
              {gs.hasSearched ? (
                <>
                  找到 {gs.results.length} 项
                  {gs.truncated && '（结果已截断，请缩小搜索范围）'}
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
              {gs.hasSearched ? '无匹配结果' : '输入关键字或选择筛选条件开始搜索'}
            </div>
          )}
          {visibleResults.map((hit, i) => (
            <div
              key={hit.path}
              data-idx={gs.page * gs.pageSize + i}
              className={`gs-row ${gs.page * gs.pageSize + i === gs.selectedIndex ? 'gs-row-selected' : ''}`}
              onMouseEnter={() => setSelected(gs.page * gs.pageSize + i)}
              onClick={() => handleSelect(gs.page * gs.pageSize + i)}
            >
              <span className="gs-row-icon">{hit.isDirectory ? '📁' : '📄'}</span>
              <button aria-label={`定位 ${hit.name}`} onClick={event => { event.stopPropagation(); void useFileStore.getState().revealInPane(activePaneId, hit.path).then(close); }}>定位</button>
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
