/**
 * 文件列表
 *
 * P1 视图模式(list / grid / details)+ 排序 + 多选 + 键盘导航 + 重命名 + 虚拟滚动
 * P3: Ctrl+C / X / V 剪贴板,拖放源(行),批量操作,Enter 全部打开
 * P7 v1:虚拟滚动 @tanstack/react-virtual + 渲染时间埋点 + 键盘导航 Up/Down/PageUp/PageDown/Home/End
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FsEntry } from '@tabula/bridge';
import { useFileStore, isThumbnailable, type SortField } from '../../stores/file-store';
import { useFileListPerfReport } from '../../perf/use-file-list-perf';
import './FileList.css';

interface Props {
  paneId: string;
  onOpenEntry: (entry: FsEntry) => void;
}

export function FileList({ paneId, onOpenEntry }: Props) {
  // 全部状态从 store 拉
  const sortBy = useFileStore((s) => s.sortBy);
  const sortDir = useFileStore((s) => s.sortDir);
  const showHidden = useFileStore((s) => s.showHidden);
  const showExtensions = useFileStore((s) => s.showExtensions);

  const paneData = useFileStore((s) => s.panes[paneId]);
  const viewMode = paneData?.viewMode ?? 'details';
  const selectedPaths = paneData?.selectedPaths ?? new Set<string>();
  const cursorPath = paneData?.cursorPath ?? null;
  const renameTarget = paneData?.renameTarget ?? null;
  const currentPath = paneData?.currentPath ?? '';
  const entries = paneData?.entries ?? [];
  const loading = paneData?.loading ?? false;
  const error = paneData?.error ?? null;

  // P3
  const dragState = useFileStore((s) => s.dragState);
  const setDragTarget = useFileStore((s) => s.setDragTarget);
  const endDrag = useFileStore((s) => s.endDrag);
  const startDrag = useFileStore((s) => s.startDrag);

  const selectOne = useFileStore((s) => s.selectOne);
  const toggleSelect = useFileStore((s) => s.toggleSelect);
  const rangeSelect = useFileStore((s) => s.rangeSelect);
  const clearSelection = useFileStore((s) => s.clearSelection);
  const selectAll = useFileStore((s) => s.selectAll);
  const setCursor = useFileStore((s) => s.setCursor);
  const cycleSort = useFileStore((s) => s.cycleSort);
  const beginRename = useFileStore((s) => s.beginRename);
  const endRename = useFileStore((s) => s.endRename);
  const renameEntry = useFileStore((s) => s.renameEntry);
  const moveCursor = useFileStore((s) => s.moveCursor);
  const cursorToEdge = useFileStore((s) => s.cursorToEdge);
  const deleteSelected = useFileStore((s) => s.deleteSelected);
  const refresh = useFileStore((s) => s.refresh);
  const loadDir = useFileStore((s) => s.loadDir);
  const getFilteredSortedEntries = useFileStore((s) => s.getFilteredSortedEntries);

  // P3
  const copySelected = useFileStore((s) => s.copySelected);
  const cutSelected = useFileStore((s) => s.cutSelected);
  const pasteToPane = useFileStore((s) => s.pasteToPane);
  const openSelected = useFileStore((s) => s.openSelected);
  const showToast = useFileStore((s) => s.showToast);
  const performBulk = useFileStore((s) => s.performBulk);

  // P4
  const openSearch = useFileStore((s) => s.openSearch);
  const closeSearch = useFileStore((s) => s.closeSearch);
  const openPreview = useFileStore((s) => s.openPreview);

  // 用 entries 触发重算(getFilteredSortedEntries 不订阅 entries,需主动调用)
  const sortedEntries = useMemo(
    () => getFilteredSortedEntries(paneId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sortBy, sortDir, showHidden, paneId],
  );

  // P7 v1:file-list 渲染时间埋点(从排序完成到 React commit)
  useFileListPerfReport(viewMode, sortedEntries.length);

  // === 容器 ref & 虚拟滚动 ===
  const containerRef = useRef<HTMLDivElement>(null);
  const [gridCols, setGridCols] = useState(4);

  // 监听容器宽度更新 grid 列数
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const target = 110; // 每格 ~110px
      const cols = Math.max(3, Math.min(8, Math.floor((w - 24) / target)));
      setGridCols(cols);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sortedEntries.length, viewMode, gridCols]);

  // === P3: 拖放 — 行作为 source ===
  // 选择拖哪些:如果有 selected(>=1)就用 selected,否则拖光标所在项
  const getDragPaths = useCallback((): string[] => {
    if (selectedPaths.size > 0) return Array.from(selectedPaths);
    if (cursorPath) return [cursorPath];
    return [];
  }, [selectedPaths, cursorPath]);

  const handleRowDragStart = useCallback(
    (entry: FsEntry, e: ReactDragEvent<HTMLElement>) => {
      const paths = getDragPaths();
      if (paths.length === 0) {
        e.preventDefault();
        return;
      }
      // 如果拖的行不在当前 selection 里,把它加入 selection
      if (!paths.includes(entry.path)) {
        selectOne(paneId, entry.path);
        startDrag([entry.path], paneId);
      } else {
        startDrag(paths, paneId);
      }
      // HTML5 dataTransfer:写纯文本路径列表(支持外部 app 互操作)
      e.dataTransfer.effectAllowed = 'all';
      e.dataTransfer.setData('text/plain', paths.join('\n'));
      // 自定义 mime 携带 source paneId(暂未用,留给 v2 跨进程拖放)
      e.dataTransfer.setData(
        'application/x-tabula-paths',
        JSON.stringify({ paths, sourcePaneId: paneId }),
      );
    },
    [getDragPaths, paneId, selectOne, startDrag],
  );

  const handleRowDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  // === P3: 拖放 — 容器作为 target(pane 内的 drop)===
  // 支持两类拖入:
  //   1. Tabula 内部拖拽(dragState 有值)
  //   2. 外部文件(Windows Explorer 等) — dataTransfer.types 包含 'Files'
  const handleContainerDragOver = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      // 内部拖拽:必须有 dragState
      // 外部拖拽:dataTransfer.types 包含 'Files'(拖入文件时必含)
      const hasInternalDrag = !!dragState;
      const hasExternalFiles = Array.from(e.dataTransfer.types).includes('Files');
      if (!hasInternalDrag && !hasExternalFiles) return;

      e.preventDefault();
      e.stopPropagation();
      // 外部文件默认 copy;内部拖拽走 Ctrl 切换
      const effect: 'move' | 'copy' =
        hasInternalDrag ? (e.ctrlKey || e.metaKey ? 'copy' : 'move') : 'copy';
      e.dataTransfer.dropEffect = effect;

      if (hasInternalDrag) {
        setDragTarget(currentPath, 'pane', effect);
      }
    },
    [dragState, currentPath, setDragTarget],
  );

  const handleContainerDragLeave = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      // dragleave 在子元素间冒泡会触发,做简单过滤
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      if (!dragState) return;
      setDragTarget(null, null, dragState.effect);
    },
    [dragState, setDragTarget],
  );

  // 检测是否是外部文件(非 Tabula 内部拖拽)
  const isExternalDrop = (e: ReactDragEvent<HTMLDivElement>): boolean => {
    return Array.from(e.dataTransfer.types).includes('Files') && !dragState;
  };

  const handleContainerDrop = useCallback(
    async (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const state = useFileStore.getState().dragState;
      const isExternal = isExternalDrop(e);

      // ===== 外部文件拖入(Windows Explorer 等) =====
      if (isExternal && currentPath) {
        const files = e.dataTransfer.files;
        if (files.length === 0) {
          endDrag();
          return;
        }
        // 外部文件只能 copy;move 外部文件 Electron 有安全限制
        const paths = Array.from(files).map((f) => f.path);
        endDrag();
        await performBulk(paths, currentPath, 'copy', paneId);
        return;
      }

      // ===== Tabula 内部拖拽 =====
      if (!state || !currentPath) {
        endDrag();
        return;
      }
      const mode: 'copy' | 'move' = state.effect === 'copy' ? 'copy' : 'move';
      const sources = state.paths;
      // 检测:同 pane 同 dir 自拖 = 无操作
      if (state.sourcePaneId === paneId && sources.every((p) => parentOf(p) === currentPath)) {
        endDrag();
        showToast('同目录拖动无操作', 'info', 1500);
        return;
      }
      await performBulk(sources, currentPath, mode, paneId);
      endDrag();
      // move 模式下刷新源 pane（可看到文件已被移走）
      if (mode === 'move' && state.sourcePaneId && state.sourcePaneId !== paneId) {
        const srcPane = useFileStore.getState().getPanePath(state.sourcePaneId);
        if (srcPane) void loadDir(state.sourcePaneId, srcPane);
      }
    },
    [currentPath, paneId, performBulk, endDrag, showToast, loadDir],
  );

  // === 键盘导航(组件级)===
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (renameTarget) return; // 重命名中让 input 自己处理
      const list = sortedEntries;
      if (list.length === 0) return;

      const isMeta = e.ctrlKey || e.metaKey;
      const path = e.key;

      // Ctrl+C 复制选中
      if (isMeta && !e.shiftKey && !e.altKey && (path === 'c' || path === 'C')) {
        e.preventDefault();
        copySelected(paneId);
        return;
      }
      // Ctrl+X 剪切
      if (isMeta && !e.shiftKey && !e.altKey && (path === 'x' || path === 'X')) {
        e.preventDefault();
        cutSelected(paneId);
        return;
      }
      // Ctrl+V 粘贴
      if (isMeta && !e.shiftKey && !e.altKey && (path === 'v' || path === 'V')) {
        e.preventDefault();
        void pasteToPane(paneId);
        return;
      }
      // Ctrl+A 全选
      if (isMeta && (path === 'a' || path === 'A')) {
        e.preventDefault();
        selectAll(paneId);
        return;
      }
      // Esc 清空选择 / 关闭搜索栏
      if (path === 'Escape') {
        // 搜索栏打开时,Esc 优先由 SearchBar 处理;但 FileList 容器焦点
        // 拿不到事件(因为 SearchBar 的 input 在事件冒泡前会 stopPropagation)。
        // 这里再做一个兜底:如果有 selection,清空。
        e.preventDefault();
        if (selectedPaths.size > 0) clearSelection(paneId);
        else closeSearch(paneId);
        return;
      }
      // P4: Ctrl+F 打开当前目录搜索栏
      if (isMeta && !e.shiftKey && !e.altKey && (path === 'f' || path === 'F')) {
        e.preventDefault();
        openSearch(paneId);
        return;
      }
      // P4: Space 预览(仅单选 + 单文件)
      if (path === ' ' || path === 'Spacebar') {
        const target = cursorPath ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
        if (!target) return;
        const entry = list.find((x) => x.path === target);
        if (!entry || entry.isDirectory) return;
        e.preventDefault();
        openPreview(entry);
        return;
      }
      // F2 重命名 — 仅在选中 1 项或光标 1 项时启用
      if (path === 'F2') {
        e.preventDefault();
        const count = selectedPaths.size > 0 ? selectedPaths.size : (cursorPath ? 1 : 0);
        if (count === 0) return;
        if (count > 1) {
          showToast('重命名仅支持单选(请先单选一项)', 'warn', 2000);
          return;
        }
        const target = cursorPath ?? Array.from(selectedPaths)[0];
        if (target) beginRename(paneId, target);
        return;
      }
      // F5 刷新
      if (path === 'F5') {
        e.preventDefault();
        void refresh(paneId);
        return;
      }
      // Ctrl+Shift+N 新建文件夹
      if (isMeta && e.shiftKey && !e.altKey && (path === 'n' || path === 'N')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('tabula:new-folder', { detail: { paneId } }));
        return;
      }
      // Delete / Shift+Delete (前者走回收站;后者真删,P3 简化为都走回收站)
      if (path === 'Delete' || (e.shiftKey && (path === 'Delete' || path === 'Del'))) {
        e.preventDefault();
        if (selectedPaths.size === 0) return;
        // 走全局 confirm 弹窗
        window.dispatchEvent(
          new CustomEvent('tabula:confirm-delete', {
            detail: {
              paneId,
              count: selectedPaths.size,
              paths: Array.from(selectedPaths),
            },
          }),
        );
        return;
      }
      // Enter 全部打开(多选时)
      if (path === 'Enter') {
        e.preventDefault();
        if (selectedPaths.size > 1) {
          void openSelected(paneId);
          return;
        }
        const target = cursorPath ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
        if (!target) return;
        const entry = list.find((x) => x.path === target);
        if (entry) onOpenEntry(entry);
        return;
      }
      // Home/End
      if (path === 'Home') {
        e.preventDefault();
        cursorToEdge(paneId, 'start');
        return;
      }
      if (path === 'End') {
        e.preventDefault();
        cursorToEdge(paneId, 'end');
        return;
      }
      // PageUp/PageDown
      if (path === 'PageUp' || path === 'PageDown') {
        e.preventDefault();
        const dir = path === 'PageDown' ? 1 : -1;
        const rowH = viewMode === 'grid' ? 110 : 28;
        const visible = Math.max(1, Math.floor((containerRef.current?.clientHeight ?? 400) / rowH) - 1);
        const step = viewMode === 'grid' ? dir * gridCols : dir * visible;
        moveCursor(paneId, step, visible);
        return;
      }
      // 方向键
      if (path === 'ArrowUp' || path === 'ArrowDown' || path === 'ArrowLeft' || path === 'ArrowRight') {
        e.preventDefault();
        if (path === 'ArrowUp') moveCursor(paneId, -1, 1);
        else if (path === 'ArrowDown') moveCursor(paneId, 1, 1);
        else if (path === 'ArrowLeft') {
          if (currentPath) {
            const parent = parentOf(currentPath);
            if (parent) void loadDir(paneId, parent);
          }
        } else if (path === 'ArrowRight') {
          const target = cursorPath ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
          if (!target) return;
          const entry = list.find((x) => x.path === target);
          if (entry?.isDirectory) onOpenEntry(entry);
        }
        return;
      }
    },
    [
      renameTarget,
      sortedEntries,
      copySelected,
      cutSelected,
      pasteToPane,
      selectAll,
      clearSelection,
      cursorPath,
      selectedPaths,
      beginRename,
      showToast,
      refresh,
      cursorToEdge,
      viewMode,
      gridCols,
      moveCursor,
      currentPath,
      loadDir,
      onOpenEntry,
      openSelected,
      paneId,
      openSearch,
      closeSearch,
      openPreview,
    ],
  );

  // 容器 mount 后自动 focus,接收键盘事件
  useEffect(() => {
    containerRef.current?.focus();
  }, [currentPath]);

  // 当条目变化时,如果光标不在新列表里,清掉
  useEffect(() => {
    if (cursorPath && !sortedEntries.some((e) => e.path === cursorPath)) {
      setCursor(paneId, null);
    }
  }, [sortedEntries, cursorPath, setCursor, paneId]);

  // === 点击处理 ===
  const handleRowClick = useCallback(
    (entry: FsEntry, e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.shiftKey) {
        rangeSelect(paneId, entry.path);
      } else if (e.ctrlKey || e.metaKey) {
        toggleSelect(paneId, entry.path);
      } else {
        const sel = useFileStore.getState().panes[paneId]?.selectedPaths ?? new Set<string>();
        if (sel.size === 1 && sel.has(entry.path) && cursorPath === entry.path) {
          clearSelection(paneId);
        } else {
          selectOne(paneId, entry.path);
        }
      }
    },
    [rangeSelect, toggleSelect, selectOne, clearSelection, cursorPath, paneId],
  );

  const handleRowDoubleClick = useCallback(
    (entry: FsEntry) => {
      onOpenEntry(entry);
    },
    [onOpenEntry],
  );

  // === 错误 / 加载 / 空 ===
  if (error) {
    return (
      <div className="file-list-error">
        <div className="error-icon">⚠</div>
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="file-list-loading">
        <div className="loading-spinner" />
        <div>加载中…</div>
      </div>
    );
  }

  if (sortedEntries.length === 0) {
    return (
      <div
        className={`file-list file-list-${viewMode} file-list-empty-wrap ${dragState ? 'file-list-dropping' : ''}`}
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) clearSelection(paneId);
        }}
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
        onDrop={handleContainerDrop}
      >
        <div className="file-list-empty">
          <div className="empty-icon">📂</div>
          <div>{showHidden ? '此目录为空' : '此目录为空(隐藏文件已隐藏)'}</div>
        </div>
      </div>
    );
  }

  // === 视图分发 ===
  // P3: 计算 drop 高亮样式(同 pane 同 dir 不高亮,提示无操作)
  const dropClass =
    dragState && dragState.targetKind === 'pane' && dragState.targetPath === currentPath
      ? dragState.sourcePaneId === paneId &&
        dragState.paths.every((p) => parentOf(p) === currentPath)
        ? 'file-list-dropping file-list-drop-noop'
        : 'file-list-dropping'
      : '';

  return (
    <div
      ref={containerRef}
      className={`file-list file-list-${viewMode} ${dropClass}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => {
        // 点空白处清空选择
        if (e.target === e.currentTarget) clearSelection(paneId);
      }}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
      {viewMode === 'details' && (
        <DetailsView
          entries={sortedEntries}
          sortBy={sortBy}
          sortDir={sortDir}
          showExtensions={showExtensions}
          selectedPaths={selectedPaths}
          cursorPath={cursorPath}
          renameTarget={renameTarget}
          onHeaderSort={cycleSort}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRenameSubmit={(oldPath, newName) => renameEntry(paneId, oldPath, newName)}
          onRenameCancel={() => endRename(paneId)}
          onRowDragStart={handleRowDragStart}
          onRowDragEnd={handleRowDragEnd}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleContainerDrop}
        />
      )}
      {viewMode === 'list' && (
        <ListView
          entries={sortedEntries}
          showExtensions={showExtensions}
          selectedPaths={selectedPaths}
          cursorPath={cursorPath}
          renameTarget={renameTarget}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRenameSubmit={(oldPath, newName) => renameEntry(paneId, oldPath, newName)}
          onRenameCancel={() => endRename(paneId)}
          onRowDragStart={handleRowDragStart}
          onRowDragEnd={handleRowDragEnd}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleContainerDrop}
        />
      )}
      {viewMode === 'grid' && (
        <GridView
          entries={sortedEntries}
          cols={gridCols}
          showExtensions={showExtensions}
          selectedPaths={selectedPaths}
          cursorPath={cursorPath}
          renameTarget={renameTarget}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRenameSubmit={(oldPath, newName) => renameEntry(paneId, oldPath, newName)}
          onRenameCancel={() => endRename(paneId)}
          onRowDragStart={handleRowDragStart}
          onRowDragEnd={handleRowDragEnd}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleContainerDrop}
        />
      )}
    </div>
  );
}

// =================== 缩略图组件(供 row / grid 复用)===================

/**
 * 单个文件图标的渲染。
 * - 若是支持的图片:挂载时调 loadThumbnail 拿 dataURL,加载完渲染 <img>
 * - 加载中/失败/非图片:回退到 emoji
 *
 * 注意:virtualizer 会把不可见行 unmount,visible 时重新 mount。
 * loadThumbnail 命中 store 缓存会同步返回,无 IPC 开销。
 */
function FileThumb({ entry, variant }: { entry: FsEntry; variant: 'row' | 'grid' }) {
  const loadThumbnail = useFileStore((s) => s.loadThumbnail);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // 进入或 mtime/path 变化时拉一次
  useEffect(() => {
    let cancelled = false;
    if (entry.isDirectory) return; // 目录不需要
    if (!isThumbnailable(entry.ext)) return;
    // 拉一次。store 内部按 mtime 失效,无需自己比较。
    void loadThumbnail(entry.path, entry.mtime).then((result) => {
      if (cancelled) return;
      setDataUrl(result?.dataUrl ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.mtime, entry.isDirectory, entry.ext, loadThumbnail]);

  const className = variant === 'grid' ? 'grid-icon-thumb' : 'row-icon-thumb';

  if (entry.isDirectory) {
    return <span className={variant === 'grid' ? 'grid-icon' : 'row-icon'}>📁</span>;
  }
  if (isThumbnailable(entry.ext) && dataUrl) {
    return (
      <img
        className={className}
        src={dataUrl}
        alt={entry.name}
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    );
  }
  // 回退到 emoji
  return <span className={variant === 'grid' ? 'grid-icon' : 'row-icon'}>{iconFor(entry)}</span>;
}

// =================== 详情视图 ===================

interface DetailsViewProps {
  entries: FsEntry[];
  sortBy: SortField;
  sortDir: 'asc' | 'desc' | null;
  showExtensions: boolean;
  selectedPaths: Set<string>;
  cursorPath: string | null;
  renameTarget: string | null;
  onHeaderSort: (field: SortField) => void;
  onRowClick: (entry: FsEntry, e: ReactMouseEvent<HTMLDivElement>) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onRenameSubmit: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
  onRenameCancel: () => void;
  onRowDragStart: (entry: FsEntry, e: ReactDragEvent<HTMLElement>) => void;
  onRowDragEnd: () => void;
  /** 挂到 scroll container 的 drop 处理器 */
  onDragOver?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLDivElement>) => void;
}

function DetailsView({
  entries,
  sortBy,
  sortDir,
  showExtensions,
  selectedPaths,
  cursorPath,
  renameTarget,
  onHeaderSort,
  onRowClick,
  onRowDoubleClick,
  onRenameSubmit,
  onRenameCancel,
  onRowDragStart,
  onRowDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: DetailsViewProps) {
   const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  // 调试：挂载后打印滚动容器和虚拟滚动器状态
  useEffect(() => {
    const el = parentRef.current;
    console.error('[DetailsView] mounted', {
      scrollEl: el ? `${el.clientWidth}x${el.clientHeight}` : 'null',
      totalEntries: entries.length,
      totalSize: rowVirtualizer.getTotalSize(),
      virtualItems: rowVirtualizer.getVirtualItems().length,
    });
  }, []);

  return (
    <div className="details-view">
      <div className="file-list-header">
        <SortHeader
          field="name"
          label="名称"
          currentField={sortBy}
          currentDir={sortDir}
          onSort={onHeaderSort}
          className="col col-name"
        />
        <SortHeader
          field="size"
          label="大小"
          currentField={sortBy}
          currentDir={sortDir}
          onSort={onHeaderSort}
          className="col col-size"
        />
        <SortHeader
          field="mtime"
          label="修改时间"
          currentField={sortBy}
          currentDir={sortDir}
          onSort={onHeaderSort}
          className="col col-mtime"
        />
        <SortHeader
          field="type"
          label="类型"
          currentField={sortBy}
          currentDir={sortDir}
          onSort={onHeaderSort}
          className="col col-type"
        />
      </div>
      <div
        ref={parentRef}
        className="file-list-body file-list-body-virtual"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index];
            return (
              <DetailsRow
                key={entry.path}
                entry={entry}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                }}
                showExtensions={showExtensions}
                selected={selectedPaths.has(entry.path)}
                cursor={cursorPath === entry.path}
                renaming={renameTarget === entry.path}
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
    </div>
  );
}

function SortHeader({
  field,
  label,
  currentField,
  currentDir,
  onSort,
  className,
}: {
  field: SortField;
  label: string;
  currentField: SortField;
  currentDir: 'asc' | 'desc' | null;
  onSort: (f: SortField) => void;
  className: string;
}) {
  const active = currentField === field && currentDir !== null;
  const arrow = currentField === field ? (currentDir === 'asc' ? '▲' : currentDir === 'desc' ? '▼' : '') : '';
  return (
    <button
      type="button"
      className={`${className} sort-header ${active ? 'sort-active' : ''}`}
      onClick={() => onSort(field)}
      title={`按${label}排序`}
    >
      {label}
      {arrow && <span className="sort-arrow">{arrow}</span>}
    </button>
  );
}

interface RowProps {
  entry: FsEntry;
  style?: React.CSSProperties;
  showExtensions: boolean;
  selected: boolean;
  cursor: boolean;
  renaming: boolean;
  onClick: (entry: FsEntry, e: ReactMouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (entry: FsEntry) => void;
  onRenameSubmit: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
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
      className={`file-list-row ${selected ? 'selected' : ''} ${cursor ? 'cursor' : ''}`}
      onClick={(e) => onClick(entry, e)}
      onDoubleClick={() => onDoubleClick(entry)}
      draggable={!renaming}
      onDragStart={(e) => onDragStart(entry, e)}
      onDragEnd={onDragEnd}
      data-entry-path={entry.path}
    >
      <div className="col col-name">
        <FileThumb entry={entry} variant="row" />
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

// =================== 列表视图(简版,只显示名字)===================

function ListView({
  entries,
  showExtensions,
  selectedPaths,
  cursorPath,
  renameTarget,
  onRowClick,
  onRowDoubleClick,
  onRenameSubmit,
  onRenameCancel,
  onRowDragStart,
  onRowDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  entries: FsEntry[];
  showExtensions: boolean;
  selectedPaths: Set<string>;
  cursorPath: string | null;
  renameTarget: string | null;
  onRowClick: (entry: FsEntry, e: ReactMouseEvent<HTMLDivElement>) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onRenameSubmit: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
  onRenameCancel: () => void;
  onRowDragStart: (entry: FsEntry, e: ReactDragEvent<HTMLElement>) => void;
  onRowDragEnd: () => void;
  onDragOver?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLDivElement>) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  // 调试：挂载后打印滚动容器和虚拟滚动器状态
  useEffect(() => {
    const el = parentRef.current;
    console.error('[ListView] mounted', {
      scrollEl: el ? `${el.clientWidth}x${el.clientHeight}` : 'null',
      totalEntries: entries.length,
      totalSize: rowVirtualizer.getTotalSize(),
      virtualItems: rowVirtualizer.getVirtualItems().length,
    });
  }, []);

  return (
    <div className="list-view">
      <div className="file-list-header">
        <div className="col col-name-full">名称</div>
      </div>
      <div
        ref={parentRef}
        className="file-list-body file-list-body-virtual"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index];
            return (
              <div
                key={entry.path}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                }}
                className={`file-list-row row-list ${selectedPaths.has(entry.path) ? 'selected' : ''} ${
                  cursorPath === entry.path ? 'cursor' : ''
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
    </div>
  );
}

// =================== 网格视图 ====================

function GridView({
  entries,
  cols,
  showExtensions,
  selectedPaths,
  cursorPath,
  renameTarget,
  onRowClick,
  onRowDoubleClick,
  onRenameSubmit,
  onRenameCancel,
  onRowDragStart,
  onRowDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  entries: FsEntry[];
  cols: number;
  showExtensions: boolean;
  selectedPaths: Set<string>;
  cursorPath: string | null;
  renameTarget: string | null;
  onRowClick: (entry: FsEntry, e: ReactMouseEvent<HTMLDivElement>) => void;
  onRowDoubleClick: (entry: FsEntry) => void;
  onRenameSubmit: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
  onRenameCancel: () => void;
  onRowDragStart: (entry: FsEntry, e: ReactDragEvent<HTMLElement>) => void;
  onRowDragEnd: () => void;
  onDragOver?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLDivElement>) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = Math.ceil(entries.length / cols);
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 4,
  });

  // 调试：挂载后打印滚动容器和虚拟滚动器状态
  useEffect(() => {
    const el = parentRef.current;
    console.error('[GridView] mounted', {
      scrollEl: el ? `${el.clientWidth}x${el.clientHeight}` : 'null',
      totalRows: rows,
      totalEntries: entries.length,
      totalSize: rowVirtualizer.getTotalSize(),
      virtualItems: rowVirtualizer.getVirtualItems().length,
    });
  }, []);

  return (
    <div className="grid-view" style={{ ['--grid-cols' as string]: String(cols) }}>
      <div
        ref={parentRef}
        className="file-list-body file-list-body-virtual"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const start = virtualRow.index * cols;
            const rowItems = entries.slice(start, start + cols);
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
                    className={`grid-cell ${selectedPaths.has(entry.path) ? 'selected' : ''} ${
                      cursorPath === entry.path ? 'cursor' : ''
                    }`}
                    onClick={(e) => onRowClick(entry, e)}
                    onDoubleClick={() => onDoubleClickGrid(onRowDoubleClick, entry)}
                    draggable={renameTarget !== entry.path}
                    onDragStart={(e) => onRowDragStart(entry, e)}
                    onDragEnd={onRowDragEnd}
                    data-entry-path={entry.path}
                  >
                    <FileThumb entry={entry} variant="grid" />
                    {renameTarget === entry.path ? (
                      <RenameInput
                        entry={entry}
                        showExtensions={showExtensions}
                        onSubmit={(name) => onRenameSubmit(entry.path, name)}
                        onCancel={onRenameCancel}
                        variant="grid"
                      />
                    ) : (
                      <div className="grid-name" title={entry.path}>
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
    </div>
  );
}

function onDoubleClickGrid(
  handler: (entry: FsEntry) => void,
  entry: FsEntry,
) {
  handler(entry);
}

// =================== 重命名输入 ===================

function RenameInput({
  entry,
  showExtensions,
  onSubmit,
  onCancel,
  variant = 'row',
}: {
  entry: FsEntry;
  showExtensions: boolean;
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  variant?: 'row' | 'grid';
}) {
  // 默认值:不显示扩展名时,只给基本名;显示扩展名时,给完整名(用户改后保留扩展名逻辑由调用方做)
  const initial = useMemo(() => {
    if (entry.isDirectory || showExtensions) return entry.name;
    // 去掉扩展名
    const dot = entry.name.lastIndexOf('.');
    return dot > 0 ? entry.name.slice(0, dot) : entry.name;
  }, [entry, showExtensions]);

  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 选中基本名(去掉扩展名的那部分)
    const dot = initial.lastIndexOf('.');
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial]);

  const submit = async () => {
    let name = value.trim();
    if (!name) {
      setError('不能为空');
      return;
    }
    // 隐藏扩展名模式下,补回扩展名
    if (!entry.isDirectory && !showExtensions) {
      const origDot = entry.name.lastIndexOf('.');
      const origExt = origDot > 0 ? entry.name.slice(origDot) : '';
      const valDot = name.lastIndexOf('.');
      if (origExt && (valDot < 0 || name.slice(valDot).toLowerCase() !== origExt.toLowerCase())) {
        name = name + origExt;
      }
    }
    const res = await onSubmit(name);
    if (!res.ok) setError(res.error ?? '重命名失败');
  };

  return (
    <span className={`rename-input-wrap ${variant}`}>
      <input
        ref={inputRef}
        className="rename-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={async (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            await submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!error) {
            // 失焦:如果改了,提交;否则取消
            if (value !== initial) {
              void submit();
            } else {
              onCancel();
            }
          }
        }}
      />
      {error && <span className="rename-error" title={error}>⚠</span>}
    </span>
  );
}

// =================== Helpers ===================

function displayName(entry: FsEntry, showExtensions: boolean): string {
  if (entry.isDirectory || showExtensions) return entry.name;
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 ? entry.name.slice(0, dot) : entry.name;
}

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

function iconFor(entry: FsEntry): string {
  if (entry.isDirectory) return '📁';
  const ext = entry.ext;
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return '🖼';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return '🎬';
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a'].includes(ext)) return '🎵';
  if (['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) return '📦';
  if (['.exe', '.msi'].includes(ext)) return '⚙';
  if (['.md', '.markdown'].includes(ext)) return '📝';
  if (
    [
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.json',
      '.py',
      '.rs',
      '.go',
      '.java',
      '.c',
      '.cpp',
      '.h',
    ].includes(ext)
  )
    return '📜';
  if (['.txt', '.log'].includes(ext)) return '📄';
  return '📄';
}

function parentOf(p: string): string {
  if (!p) return '';
  if (/^[a-zA-Z]:[\\/]?$/.test(p)) return '';
  const m = p.match(/^(.*)[\\/]([^\\/]+)[\\/]?$/);
  if (m) {
    const parent = m[1];
    if (/^[a-zA-Z]:$/.test(parent)) return parent + '\\';
    return parent;
  }
  return '';
}
