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
import type { FsEntry } from '@tabula/bridge';
import { useFileStore } from '../../stores/file-store';
import { parentPath as parentOf, sameFilePath } from '../../stores/file/paths';
import { DetailsView } from './views/DetailsView';
import { ListView } from './views/ListView';
import { GridView } from './views/GridView';
import { SortHeader } from './views/SortHeader';
import { useLayoutStore } from '../../stores/layout-store';
import { loadTagsForPath, subscribeTagsCache } from '../../components/context-menu/tags';
import { useFileListPerfReport } from '../../perf/use-file-list-perf';
import './FileList.css';
import { buildViewRows, entriesInBox } from './view-layout';

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
  const groupBy = paneData?.groupBy ?? 'none';
  const thumbnailSize = useFileStore(s => s.thumbnailSize);
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
  const selectRect = useFileStore((s) => s.selectRect);
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
  // G006: openPreview 不再在 FileList 调用,由 App.tsx 全局 keydown handler 统一处理
  // (避免和 App.tsx 的 Space handler 冲突,导致 1 次按键被 open→close 翻转)

  // 用 entries 触发重算(getFilteredSortedEntries 不订阅 entries,需主动调用)
  const sortedEntries = useMemo(
    () => getFilteredSortedEntries(paneId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sortBy, sortDir, showHidden, paneId, paneData?.searchQuery, paneData?.fileType, groupBy],
  );

  // G008: 订阅 tags cache 变化(异步 loadTagsForPath 返回后强制 re-render)
  const [, setTick] = useState(0);
  useEffect(() => subscribeTagsCache(() => setTick((n) => n + 1)), []);

  // G008: 当 entries 变化时,批量预拉每个 entry 的 tags(填入 cache)
  useEffect(() => {
    for (const e of entries) {
      void loadTagsForPath(e.path);
    }
  }, [entries]);

  // P7 v1:file-list 渲染时间埋点(从排序完成到 React commit)
  useFileListPerfReport(viewMode, sortedEntries.length);

  // === 容器 ref & 虚拟滚动 ===
  const containerRef = useRef<HTMLDivElement>(null);
  // G004: 橡皮筋拖框 — ref 指向视图 body(滚动容器),用于坐标原点
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [gridCols, setGridCols] = useState(4);

  // G004: rubber-band 状态。当前鼠标位置 + 起点的 clientX/Y。
  // 当不为 null 时,说明正在拖框;UI 会渲染 .rubber-band-rect overlay。
  interface RubberBand {
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  }
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const rubberBandRef = useRef<RubberBand | null>(null);
  // 在哪个元素上开始拖框(记录后,在 mousemove/up 阶段保持监听,即使
  // 鼠标快速移出原始元素也不会丢事件)。用 window 监听兜底。
  const RUBBER_BAND_DRAG_THRESHOLD = 4; // px,小于这个位移视为点击,不起框

  // 监听容器宽度更新 grid 列数
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const target = thumbnailSize + 46;
      const cols = Math.max(3, Math.min(8, Math.floor((w - 24) / target)));
      setGridCols(cols);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sortedEntries.length, viewMode, gridCols, thumbnailSize]);

  // === P3: 拖放 — 行作为 source ===
  const handleRowDragStart = useCallback(
    (entry: FsEntry, e: ReactDragEvent<HTMLElement>) => {
      const selection = useFileStore.getState().panes[paneId]?.selectedPaths;
      const paths = selection?.has(entry.path) ? [entry.path, ...Array.from(selection).filter(path => path !== entry.path)] : [entry.path];
      if (!selection?.has(entry.path)) {
        selectOne(paneId, entry.path);
      }
      startDrag(paths, paneId);
      if (e.altKey) {
        // Internal drag remains a browser drag so every in-app drop target can
        // receive dragover/drop. Internal file drags only move.
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-tabula-paths', JSON.stringify({ paths, sourcePaneId: paneId }));
        return;
      }
      // Electron needs the native drag to be started from this event, with the
      // browser's text-only drag cancelled. Do not wait for the IPC response.
      e.preventDefault();
      void window.tabula.fs.startDrag(paths).then((result) => {
        if (!result.ok) showToast(`无法拖出文件: ${result.error.message}`, 'error');
      }).catch((error) => {
        showToast(`无法拖出文件: ${String(error)}`, 'error');
      }).finally(() => endDrag());
    },
    [paneId, selectOne, startDrag, showToast, endDrag],
  );

  const dropDirectory = useCallback((target: EventTarget | null): string => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-entry-path]') : null;
    const entry = entries.find((item) => item.path === element?.dataset.entryPath);
    return entry?.isDirectory ? entry.path : currentPath;
  }, [entries, currentPath]);

  const handleRowDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  // Load the shell icon before dragstart without doing work for every entry in
  // large directories. Mouse down also covers a fast drag without prior hover.
  const prepareDragIcon = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-entry-path]') : null;
    const path = target?.dataset.entryPath;
    if (path) window.tabula.fs.prepareDragIcon(path);
  }, []);

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
      // External files are copied; internal drags always move.
      const effect: 'move' | 'copy' = hasInternalDrag ? 'move' : 'copy';
      e.dataTransfer.dropEffect = effect;

      if (hasInternalDrag) {
        setDragTarget(dropDirectory(e.target), 'pane', effect);
      }
    },
    [dragState, dropDirectory, setDragTarget],
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
      const destination = dropDirectory(e.target);

      // ===== 外部文件拖入(Windows Explorer 等) =====
      if (isExternal && destination) {
        const files = e.dataTransfer.files;
        if (files.length === 0) {
          endDrag();
          return;
        }
        // 外部文件只能 copy;move 外部文件 Electron 有安全限制
        let paths: string[];
        try {
          paths = Array.from(files).map((file) => window.tabula.fs.getPathForFile(file)).filter(Boolean);
        } catch (error) {
          endDrag();
          showToast(`无法读取拖入文件: ${String(error)}`, 'error');
          return;
        }
        if (paths.length === 0) {
          endDrag();
          showToast('拖入内容没有可访问的本地文件', 'warn');
          return;
        }
        endDrag();
        await performBulk(paths, destination, 'copy', paneId);
        return;
      }

      // ===== Tabula 内部拖拽 =====
      if (!state || !destination) {
        endDrag();
        return;
      }
      const sources = state.paths;
      // 检测:同 pane 同 dir 自拖 = 无操作
      if (sources.some((p) => sameFilePath(p, destination))) {
        endDrag();
        showToast('无法拖放到选中的文件夹自身', 'warn');
        return;
      }
      if (sources.every((p) => sameFilePath(parentOf(p), destination))) {
        endDrag();
        showToast('同目录拖动无操作', 'info', 1500);
        return;
      }
      endDrag();
      await performBulk(sources, destination, 'move', paneId);
      // move 模式下刷新源 pane（可看到文件已被移走）
      if (state.sourcePaneId && state.sourcePaneId !== paneId) {
        const srcPane = useFileStore.getState().getPanePath(state.sourcePaneId);
        if (srcPane) void loadDir(state.sourcePaneId, srcPane);
      }
    },
    [dropDirectory, dragState, paneId, performBulk, endDrag, showToast, loadDir],
  );

  // === 键盘导航(组件级)===
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (renameTarget) return; // 重命名中让 input 自己处理
      const list = sortedEntries;
      if (list.length === 0) return;

      // Configurable commands are handled once by the window capture listener.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const path = e.key;

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
            if (parent) void useLayoutStore.getState().pane.navigate(paneId, parent);
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

  // === G004: 橡皮筋拖框 — 在 file-list-body 上的 mousedown 启动 ===
  // 用 useCallback + ref 拿到最新 entries / 函数,避免把 entries 放进依赖导致重启监听。
  // 关键策略:
  //  - 仅在 mousedown 目标 = 当前元素(空白处)时启动,避开 row / header / cell。
  //  - mousemove / mouseup 用 window 监听,避免快速移出元素丢事件。
  //  - 位移 < 4px 视为普通点击,让现有的"点空白清空 selection"行为保留。
  //  - 拖框动作命中 row 时,把该 row 加入 selection;释放时一次性 commit selectRect。
  const computeEntriesInRect = useCallback(
    (band: RubberBand, list: FsEntry[]): string[] => {
      const viewport = bodyRef.current;
      if (!viewport) return [];
      const rect = viewport.getBoundingClientRect();
      return entriesInBox(buildViewRows(list, groupBy, viewMode === 'grid' ? gridCols : 1, viewMode === 'grid' ? thumbnailSize + 48 : 28), {
        left: Math.min(band.startX, band.curX) - rect.left + viewport.scrollLeft,
        right: Math.max(band.startX, band.curX) - rect.left + viewport.scrollLeft,
        top: Math.min(band.startY, band.curY) - rect.top + viewport.scrollTop,
        bottom: Math.max(band.startY, band.curY) - rect.top + viewport.scrollTop,
      }, viewport.clientWidth || rect.width, viewMode === 'grid' ? gridCols : 1);

    },
    [viewMode, gridCols, groupBy, thumbnailSize],
  );

  // mousedown on the body (empty area between rows or below them)
  const handleBodyMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // 仅在左键 + 命中当前 body 元素(空白区域)时启动拖框。
      // 若点击命中 row / header / cell,这些元素自己处理,不进入拖框分支。
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-entry-path], .file-list-group-header')) return;
      // preventDefault 阻止默认文本选择。
      // 注意:不调 stopPropagation — 否则 mousedown 不会冒泡到 PaneView 的
      // onMouseDown,导致「点 body 自身空白」时 pane 无法聚焦,也无法让
      // handleBlankAreaMouseDown 拿到 mousedown(虽然现在 focus-only 不切目录,
      // 但 blank handler 仍然要负责聚焦 + clearSelection)。rows 是 body 的后代,
      // click 事件不会从 body 下行到 row,所以不需要在这里拦 stopPropagation。
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const initial: RubberBand = { startX, startY, curX: startX, curY: startY };
      rubberBandRef.current = initial;
      setRubberBand(initial);
    },
    [],
  );

  // === 点空白区域:聚焦当前 pane + 清选中;不改 currentPath ===
  // 旧实现用 `e.target === e.currentTarget` 判空白,在 .file-list 根 div 上
  // 永远成立 false(根 div 没 padding,header + body 两个 flex 子元素填满),
  // 导致 handler 第一行 return,功能失效。改用 `closest('.file-list-row')`
  // 排除 row 内点击,再 `closest('.file-list-header')` 排除 column header
  // (用户点 header 是想排序,不是切 pane)。
  //
  // **不切目录**:用户最终决定点空白仅做聚焦 + 清选中,不改 activeTab.path
  // / currentPath。之前尝试过切到另一个 pane 的目录(navigate),
  // 但语义上让用户困惑(新聚焦的 pane 内容被覆盖为另一个 pane 的内容)。
  //
  // **显式 focusPane** 防御任何上游 stopPropagation:虽然 handleBodyMouseDown
  // 已经移除 stopPropagation,显式 focusPane 仍然是更稳的契约 — 不依赖事件链完整。
  const handleBlankAreaMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // 点到了 row 内部 / column header → 不是空白,跳过
      if (target.closest('[data-entry-path]')) return;
      if (target.closest('.file-list-header')) return;
      // 显式聚焦当前 pane — 不依赖 PaneView onMouseDown 冒泡
      if (useLayoutStore.getState().activePaneId !== paneId) {
        useLayoutStore.getState().pane.focusPane(paneId);
      }
      // 单 pane / 多 pane 都清选中(避免用户点空白留下 stale selection)
      clearSelection(paneId);
    },
    [paneId, clearSelection],
  );

  // === G004: 拖框过程 — 全局 mousemove / mouseup ===
  // 用 ref 拿到最新 entries / paneId / 状态,避免反复重启监听。
  useEffect(() => {
    if (!rubberBand) return;
    const onMove = (e: MouseEvent) => {
      const cur = rubberBandRef.current;
      if (!cur) return;
      const next: RubberBand = { ...cur, curX: e.clientX, curY: e.clientY };
      rubberBandRef.current = next;
      setRubberBand(next);
    };
    const onUp = (e: MouseEvent) => {
      const cur = rubberBandRef.current;
      rubberBandRef.current = null;
      setRubberBand(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!cur) return;
      const dx = Math.abs(e.clientX - cur.startX);
      const dy = Math.abs(e.clientY - cur.startY);
      // 位移太小 → 当作普通点击(由 mousedown handler 之后会执行 clearSelection)
      if (dx < RUBBER_BAND_DRAG_THRESHOLD && dy < RUBBER_BAND_DRAG_THRESHOLD) {
        clearSelection(paneId);
        return;
      }
      const paths = computeEntriesInRect(
        { startX: cur.startX, startY: cur.startY, curX: e.clientX, curY: e.clientY },
        sortedEntries,
      );
      selectRect(paneId, paths);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubberBand !== null]);

  // 切换目录 / pane 时清掉残留的拖框状态
  useEffect(() => {
    rubberBandRef.current = null;
    setRubberBand(null);
  }, [paneId, currentPath]);

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
        onMouseDown={handleBlankAreaMouseDown}
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
      ? dragState.paths.every((p) => sameFilePath(parentOf(p), currentPath))
        ? 'file-list-dropping file-list-drop-noop'
        : 'file-list-dropping'
      : '';

  return (
    <div
      ref={containerRef}
      className={`file-list file-list-${viewMode} ${dropClass}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseOverCapture={prepareDragIcon}
      onMouseDownCapture={prepareDragIcon}
      onMouseDown={handleBlankAreaMouseDown}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
      {viewMode === 'details' && (
        <div className="file-list-header">
          <SortHeader
            field="name"
            label="名称"
            currentField={sortBy}
            currentDir={sortDir}
            onSort={cycleSort}
            className="col col-name"
          />
          <SortHeader
            field="size"
            label="大小"
            currentField={sortBy}
            currentDir={sortDir}
            onSort={cycleSort}
            className="col col-size"
          />
          <SortHeader
            field="mtime"
            label="修改时间"
            currentField={sortBy}
            currentDir={sortDir}
            onSort={cycleSort}
            className="col col-mtime"
          />
          <SortHeader
            field="type"
            label="类型"
            currentField={sortBy}
            currentDir={sortDir}
            onSort={cycleSort}
            className="col col-type"
          />
        </div>
      )}
      {viewMode === 'list' && (
        <div className="file-list-header">
          <div className="col col-name-full">名称</div>
        </div>
      )}
      {viewMode === 'details' && (
        <DetailsView
          entries={sortedEntries}
          groupBy={groupBy}
          showExtensions={showExtensions}
          selectedPaths={selectedPaths}
          cursorPath={cursorPath}
          renameTarget={renameTarget}
          dropTargetPath={dragState?.targetKind === 'pane' ? dragState.targetPath : null}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRenameSubmit={(oldPath, newName) => renameEntry(paneId, oldPath, newName)}
          onRenameCancel={() => endRename(paneId)}
          onRowDragStart={handleRowDragStart}
          onRowDragEnd={handleRowDragEnd}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleContainerDrop}
          bodyRef={bodyRef}
          onBodyMouseDown={handleBodyMouseDown}
          rubberBand={rubberBand}
        />
      )}
      {viewMode === 'list' && (
        <ListView
          entries={sortedEntries}
          groupBy={groupBy}
          showExtensions={showExtensions}
          selectedPaths={selectedPaths}
          cursorPath={cursorPath}
          renameTarget={renameTarget}
          dropTargetPath={dragState?.targetKind === 'pane' ? dragState.targetPath : null}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRenameSubmit={(oldPath, newName) => renameEntry(paneId, oldPath, newName)}
          onRenameCancel={() => endRename(paneId)}
          onRowDragStart={handleRowDragStart}
          onRowDragEnd={handleRowDragEnd}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleContainerDrop}
          bodyRef={bodyRef}
          onBodyMouseDown={handleBodyMouseDown}
          rubberBand={rubberBand}
        />
      )}
      {viewMode === 'grid' && (
        <GridView
          groupBy={groupBy}
          thumbnailSize={thumbnailSize}
          entries={sortedEntries}
          cols={gridCols}
          showExtensions={showExtensions}
          selectedPaths={selectedPaths}
          cursorPath={cursorPath}
          renameTarget={renameTarget}
          dropTargetPath={dragState?.targetKind === 'pane' ? dragState.targetPath : null}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRenameSubmit={(oldPath, newName) => renameEntry(paneId, oldPath, newName)}
          onRenameCancel={() => endRename(paneId)}
          onRowDragStart={handleRowDragStart}
          onRowDragEnd={handleRowDragEnd}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleContainerDrop}
          bodyRef={bodyRef}
          onBodyMouseDown={handleBodyMouseDown}
          rubberBand={rubberBand}
        />
      )}
    </div>
  );
}
