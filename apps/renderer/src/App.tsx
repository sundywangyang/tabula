/**
 * 应用根组件
 *
 * P0: TitleBar + Sidebar + Main(单 pane)
 * P1: 主区域里塞 Toolbar / PathBar / StatusBar
 * P2: 主区域渲染 <LayoutView node={rootLayout}/> 树,根节点包含 PathBar(全局模态)
 * P3: 加 Toast / ConflictDialog / NewFolder Dialog / 批量删除确认 Dialog
 * P4: 加 PreviewPanel(单文件 Space 预览)+ GlobalSearch(Ctrl+P)+ 当前目录搜索(Ctrl+F)
 * P7: 加 PerfPanel(Ctrl+Shift+P)+ 首屏 paint 埋点 + 内存订阅
 * P7: 关键路径只 import TitleBar/Sidebar/PathBar/StatusBar/Toast/Conflict/Input/Confirm/PaneContainer
 *     重组件(Settings/PreviewPanel/GlobalSearch)走 React.lazy + Suspense 懒加载
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { PathBar } from './components/PathBar';
import { StatusBar } from './components/StatusBar';
import { ToastHost } from './components/Toast';
import { ConflictDialog } from './components/ConflictDialog';
import { InputDialog } from './components/InputDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PropertiesPanel } from './features/file-list/PropertiesPanel';
import { BatchRenameDialog } from './features/file-list/BatchRenameDialog';
import { ContextMenu } from './components/ContextMenu';
import { ExtensionPanelView } from './components/ExtensionPanelView';
import {
  CommandPalette,
  openCommandPalette,
  closeCommandPalette,
  isCommandPaletteOpen,
} from './features/command-palette/CommandPalette';
import { runCommandById } from './command-dispatcher';
import { IpcChannels } from '@tabula/bridge';
import { LayoutView } from './features/panes/PaneContainer';
import { PerfPanel } from './features/perf/PerfPanel';
import { UpdateNotification } from './features/update/UpdateNotification';
import { useFileStore } from './stores/file-store';
import { useLayoutStore } from './stores/layout-store';
import { useFavoritesStore } from './stores/favorites-store';
import { useThemeStore, type ThemeMode } from './stores/theme-store';
import { useSettingsStore } from './stores/settings-store';
import { useKeymapStore } from './stores/keymap-store';
import { useUiDialogsStore } from './stores/ui-dialogs-store';
import { makeFolderTab } from './stores/file-store';
import { usePerfStore } from './stores/perf-store';
import { reportFirstPaint, pullStartupTimings } from './perf/perf-client';
import { initPlatformCache, getCachedRootPath } from './platform-cache';
import './styles/app.css';

// P7:重组件懒加载(仅在用户首次触发时下载对应的 chunk)
// - PreviewPanel 引入 marked + highlight.js(~200KB),仅 Space 预览时加载
// - GlobalSearch 仅 Ctrl+P 时加载
// - Settings 仅 Ctrl+, 时加载
const PreviewPanel = lazy(() =>
  import('./features/preview/PreviewPanel').then((m) => ({ default: m.PreviewPanel })),
);
const GlobalSearch = lazy(() =>
  import('./features/search/GlobalSearch').then((m) => ({ default: m.GlobalSearch })),
);
const Settings = lazy(() =>
  import('./features/settings/Settings').then((m) => ({ default: m.Settings })),
);

export function App() {
  const [version, setVersion] = useState<string>('');
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // P3: dialog state — 集中到 ui-dialogs-store(P7 v1 收口),
  // 这样命令面板(runCommandById)也能直接驱动 dialog 开关,
  // 不用走 custom event 绕一圈。
  const newFolderOpen = useUiDialogsStore((s) => s.newFolderOpen);
  const setNewFolder = useUiDialogsStore((s) => s.setNewFolder);
  const newFileOpen = useUiDialogsStore((s) => s.newFileOpen);
  const setNewFile = useUiDialogsStore((s) => s.setNewFile);
  const newTargetPane = useUiDialogsStore((s) => s.newFolderTargetPane);
  const confirmDeleteOpen = useUiDialogsStore((s) => s.confirmDeleteOpen);
  const confirmDeleteData = useUiDialogsStore((s) => s.confirmDeleteData);
  const setConfirmDelete = useUiDialogsStore((s) => s.setConfirmDelete);
  const confirmPermanentDeleteOpen = useUiDialogsStore(
    (s) => s.confirmPermanentDeleteOpen,
  );
  const confirmPermanentDeleteData = useUiDialogsStore(
    (s) => s.confirmPermanentDeleteData,
  );
  const setConfirmPermanentDelete = useUiDialogsStore(
    (s) => s.setConfirmPermanentDelete,
  );
  const settingsOpen = useUiDialogsStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiDialogsStore((s) => s.setSettingsOpen);

  // P3: 属性面板
  const propertiesPanel = useUiDialogsStore((s) => s.propertiesPanel);
  const closePropertiesPanel = useUiDialogsStore((s) => s.closePropertiesPanel);

  // P3: 批量重命名
  const batchRename = useUiDialogsStore((s) => s.batchRename);
  const closeBatchRename = useUiDialogsStore((s) => s.closeBatchRename);

  // file-store
  const hydrateFromConfig = useFileStore((s) => s.hydrateFromConfig);
  const loadDir = useFileStore((s) => s.loadDir);
  const openPathBar = useFileStore((s) => s.openPathBar);
  const refresh = useFileStore((s) => s.refresh);
  const selectAll = useFileStore((s) => s.selectAll);
  const clearSelection = useFileStore((s) => s.clearSelection);
  const ensurePane = useFileStore((s) => s.ensurePane);
  const pathBarOpen = useFileStore((s) => s.pathBarOpen);

  // P3
  const copySelected = useFileStore((s) => s.copySelected);
  const cutSelected = useFileStore((s) => s.cutSelected);
  const pasteToPane = useFileStore((s) => s.pasteToPane);
  const createFolder = useFileStore((s) => s.createFolder);
  const createFile = useFileStore((s) => s.createFile);
  const permanentDelete = useFileStore((s) => s.permanentDelete);

  // P4
  const openGlobalSearch = useFileStore((s) => s.openGlobalSearch);

  // P3: 重命名/复制
  const beginRename = useFileStore((s) => s.beginRename);
  const performBulk = useFileStore((s) => s.performBulk);
  const clipboard = useFileStore((s) => s.clipboard);
  const deleteSelected = useFileStore((s) => s.deleteSelected);
  const getPanePath = useFileStore((s) => s.getPanePath);
  const showToast = useFileStore((s) => s.showToast);

  // P5
  const hydrateFavorites = useFavoritesStore((s) => s.hydrate);
  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const recordVisit = useFavoritesStore((s) => s.recordVisit);
  const themeSetEffective = useThemeStore((s) => s.setEffective);

  // P7 v1: 快捷键(从主进程拉命令 + 绑定)
  const hydrateKeymap = useKeymapStore((s) => s.hydrate);

  // layout-store
  const rootLayout = useLayoutStore((s) => s.rootLayout);
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const hydrated = useLayoutStore((s) => s.hydrated);
  const hydrateLayout = useLayoutStore((s) => s.hydrateFromConfig);

  // 视图设置(从 file-store 全局取,用于 StatusBar)
  const sortBy = useFileStore((s) => s.sortBy);
  const sortDir = useFileStore((s) => s.sortDir);

  // StatusBar 数据:从 active pane 拉
  const activePaneData = useFileStore((s) => s.panes[activePaneId]);
  const activePath = activePaneData?.currentPath ?? '';
  const activeEntries = activePaneData?.entries ?? [];
  const activeSelected = activePaneData?.selectedPaths ?? new Set<string>();

  // 所有 paneId(用于 StatusBar 提示)
  const paneCount = useLayoutStore((s) => s.countPanes());
  const activePaneIndex = useMemo(() => {
    const ids = useLayoutStore.getState().getAllPaneIds();
    const idx = ids.indexOf(activePaneId);
    return idx < 0 ? 1 : idx + 1;
  }, [activePaneId, rootLayout]);

  // 启动:加载配置 + 布局
  useEffect(() => {
    void window.tabula.app.version().then(setVersion);

    // P7 v1:订阅主进程推过来的内存采样;拉取启动计时
    const offMem = window.tabula.perf.onMemorySample((sample) => {
      usePerfStore.getState().setMemory(sample);
    });
    void pullStartupTimings().then(usePerfStore.getState().setStartupTimings).catch(() => undefined);

    void (async () => {
      // 平台信息缓存 (同步供 onKey handler 使用)
      await initPlatformCache();
      // P5: 先 hydrate 主题(影响整体样式),再 hydrate favorites / settings / file-config / layout
      await hydrateTheme();
      await hydrateSettings();
      await hydrateFavorites();
      await hydrateFromConfig();
      await hydrateLayout();
      // P7 v1: 拉快捷键配置(electron-store 持久化的用户覆盖)
      await hydrateKeymap();

      // P2 v2: 检查 boot 路径(由 win:open-with-tab 注入的开窗初始路径)
      // 如果有,说明这个窗口是被「拖出 tab」开的,把 boot 路径记下来
      // 并写入当前 pane 的 path。
      let bootPath: string | null = null;
      try {
        bootPath = await window.tabula.windows.getBootPath();
      } catch {
        bootPath = null;
      }

      const layout = useLayoutStore.getState().rootLayout;
      const active = useLayoutStore.getState().activePaneId;
      const ids = useLayoutStore.getState().getAllPaneIds();
      await Promise.all(ids.map((id) => ensurePane(id)));
      const activePane = findPaneInLayout(layout, active);
      let initPath = '';
      if (activePane && activePane.type === 'pane' && activePane.activeTabId) {
        const tab = activePane.tabs.find((t) => t.id === activePane.activeTabId);
        if (tab?.path) {
          initPath = tab.path;
          await loadDir(active, initPath);
        }
      }
      // P2 v2: boot 路径优先(被「拖出」开的窗口,默认 tab 替换为 boot 路径)
      if (bootPath) {
        // 找到当前 active pane + active tab,replace 它的 path
        const replaceable = findPaneInLayout(useLayoutStore.getState().rootLayout, active);
        if (replaceable?.type === 'pane' && replaceable.activeTabId) {
          useLayoutStore
            .getState()
            .pane.replaceTabPath(active, replaceable.activeTabId, bootPath);
          await loadDir(active, bootPath);
        }
        initPath = bootPath;
      } else if (!initPath) {
        initPath = getCachedRootPath();
        await loadDir(active, initPath);
        const newTab = makeFolderTab(initPath, '主页');
        useLayoutStore.getState().pane.openTab(active, newTab);
      }
      // 记录首次访问到 history
      if (initPath) recordVisit(initPath);
    })();

    // P7 v1:首次 paint 后上报(用双 rAF 等到下一帧 commit 完)
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        reportFirstPaint({ url: window.location.pathname });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      offMem();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P5: 跟随系统主题(mode === 'system' 时,监听 OS 主题变化)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const mode = useThemeStore.getState().mode;
      if (mode === 'system') {
        themeSetEffective(mq.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themeSetEffective]);

  // P7 v1: Ctrl+Shift+P 切换命令面板(独立 effect,捕获阶段,
  // 即便焦点在 path bar / dialog input 里也能触发 — 沿用 VS Code 行为)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;
      if (isMeta && e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        if (isCommandPaletteOpen()) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // P5: 监听 active pane 路径变化 → 记录到 history
  useEffect(() => {
    if (!activePath) return;
    recordVisit(activePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // P3: 监听 toolbar 触发的"新建文件夹/文件"事件
  useEffect(() => {
    const onNewFolder = (e: Event) => {
      const detail = (e as CustomEvent).detail as { paneId: string };
      setNewFolder(true, detail.paneId);
    };
    const onNewFile = (e: Event) => {
      const detail = (e as CustomEvent).detail as { paneId: string };
      setNewFile(true, detail.paneId);
    };
    const onConfirmDelete = (e: Event) => {
      const detail = (e as CustomEvent).detail as { paneId: string; count: number };
      setConfirmDelete({ paneId: detail.paneId, count: detail.count });
    };
    // P7 v1 收口:主进程 `commands:run-command` 事件回推后,统一派发到
    // 命令执行器(与 App.tsx keydown handler 走同一条路径)。
    // 这里走 IPC 事件(`window.tabula.events.on` 订阅主进程 webContents.send),
    // 不是 window custom event。
    const offRunCommand = window.tabula.events.on<{ commandId: string }>(
      IpcChannels.COMMANDS_RUN_COMMAND,
      (payload) => {
        if (payload && typeof payload.commandId === 'string') {
          runCommandById(payload.commandId);
        }
      },
    );
    window.addEventListener('tabula:new-folder', onNewFolder);
    window.addEventListener('tabula:new-file', onNewFile);
    window.addEventListener('tabula:confirm-delete', onConfirmDelete);

    // P3: 属性面板
    const onShowProperties = (e: Event) => {
      const detail = (e as CustomEvent<{ paneId: string; entry: import('@tabula/bridge').FsEntry }>).detail;
      useUiDialogsStore.getState().openPropertiesPanel(detail.paneId, detail.entry);
    };
    window.addEventListener('tabula:show-properties', onShowProperties);

    // P3: 批量重命名
    const onBatchRename = (e: Event) => {
      const detail = (e as CustomEvent<{ paneId: string; paths: string[]; names: string[] }>).detail;
      useUiDialogsStore.getState().openBatchRename(detail.paneId, detail.paths, detail.names);
    };
    window.addEventListener('tabula:batch-rename', onBatchRename);

    // Archive (压缩 / 解压) 进度推送
    const offArchiveUpdate = window.tabula.archive.onJobUpdate((progress) => {
      useFileStore.getState().updateArchiveJob(progress);
    });

    return () => {
      window.removeEventListener('tabula:new-folder', onNewFolder);
      window.removeEventListener('tabula:new-file', onNewFile);
      window.removeEventListener('tabula:confirm-delete', onConfirmDelete);
      window.removeEventListener('tabula:show-properties', onShowProperties);
      window.removeEventListener('tabula:batch-rename', onBatchRename);
      offRunCommand();
      offArchiveUpdate();
    };
  }, []);

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (pathBarOpen) return;
      if (isInField) return;

      const isMeta = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;
      const isShift = e.shiftKey;
      const key = e.key;

      // Ctrl+L:打开路径栏
      if (isMeta && !isAlt && !isShift && (key === 'l' || key === 'L')) {
        e.preventDefault();
        openPathBar(activePaneId);
        return;
      }

      // P5: Ctrl+, 打开设置
      if (isMeta && !isAlt && !isShift && key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // F5:刷新
      if (key === 'F5') {
        e.preventDefault();
        void refresh(activePaneId);
        return;
      }

      // Ctrl+A:全选
      if (isMeta && !isAlt && !isShift && (key === 'a' || key === 'A')) {
        e.preventDefault();
        selectAll(activePaneId);
        return;
      }

      // Esc:清空选择 / 关闭 dialog
      if (key === 'Escape') {
        // dialog 优先(它们自己处理)
        if (newFolderOpen) { setNewFolder(false, null); return; }
        if (newFileOpen) { setNewFile(false, null); return; }
        if (confirmDeleteOpen) { setConfirmDelete(null); return; }
        // G006: 预览面板打开时,Esc 优先关闭预览
        if (useFileStore.getState().previewState) {
          e.preventDefault();
          useFileStore.getState().closePreview();
          return;
        }
        if ((activeSelected?.size ?? 0) > 0) {
          e.preventDefault();
          clearSelection(activePaneId);
        }
        return;
      }

      // G006: Space 打开/关闭当前选中/光标文件的预览(quick-look)
      if (key === ' ' && !isMeta && !isAlt && !isShift) {
        e.preventDefault();
        const fileState = useFileStore.getState();
        const data = fileState.panes[activePaneId];
        if (!data) return;
        // 目标条目:1 选中 → 那个;否则用光标
        let target: import('@tabula/bridge').FsEntry | null = null;
        if (data.selectedPaths.size === 1) {
          const p = Array.from(data.selectedPaths)[0]!;
          target = data.entries.find((x) => x.path === p) ?? null;
        }
        if (!target && data.cursorPath) {
          target = data.entries.find((x) => x.path === data.cursorPath) ?? null;
        }
        if (!target) return;
        // 目录不预览
        if (target.isDirectory) return;
        // 再次按 Space → 关闭;否则打开
        const current = fileState.previewState;
        if (current && current.entry.path === target.path) {
          fileState.closePreview();
        } else {
          fileState.openPreview(target);
        }
        return;
      }

      // Ctrl+T:在 active pane 新开 tab
      if (isMeta && !isAlt && !isShift && (key === 't' || key === 'T')) {
        e.preventDefault();
        const initPath = getCachedRootPath();
        const tab = makeFolderTab(initPath, '新标签');
        useLayoutStore.getState().pane.openTab(activePaneId, tab);
        return;
      }

      // Ctrl+W:关闭 active tab
      if (isMeta && !isAlt && !isShift && (key === 'w' || key === 'W')) {
        e.preventDefault();
        const layout = useLayoutStore.getState().rootLayout;
        const pane = findPaneInLayout(layout, activePaneId);
        if (pane?.type === 'pane' && pane.activeTabId) {
          useLayoutStore.getState().pane.closeTab(activePaneId, pane.activeTabId);
        }
        return;
      }

      // Ctrl+N:新建文件夹(全局)
      if (isMeta && !isAlt && !isShift && (key === 'n' || key === 'N')) {
        e.preventDefault();
        setNewFolder(true, activePaneId);
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab:循环切 active tab
      if (isMeta && !isAlt && key === 'Tab') {
        e.preventDefault();
        const layout = useLayoutStore.getState().rootLayout;
        const pane = findPaneInLayout(layout, activePaneId);
        if (pane?.type === 'pane' && pane.tabs.length > 1 && pane.activeTabId) {
          const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
          const nextIdx = isShift
            ? (idx - 1 + pane.tabs.length) % pane.tabs.length
            : (idx + 1) % pane.tabs.length;
          const next = pane.tabs[nextIdx];
          if (next) useLayoutStore.getState().pane.activateTab(activePaneId, next.id);
        }
        return;
      }

      // Ctrl+1~9:切到第 N 个 tab
      if (isMeta && !isAlt && !isShift && /^[1-9]$/.test(key)) {
        e.preventDefault();
        const n = parseInt(key, 10);
        const layout = useLayoutStore.getState().rootLayout;
        const pane = findPaneInLayout(layout, activePaneId);
        if (pane?.type === 'pane') {
          const target = pane.tabs[n - 1];
          if (target) useLayoutStore.getState().pane.activateTab(activePaneId, target.id);
        }
        return;
      }

      // Ctrl+\:横向拆分
      if (isMeta && !isAlt && !isShift && (key === '\\' || key === '|')) {
        e.preventDefault();
        useLayoutStore.getState().pane.splitPane(activePaneId, 'horizontal');
        return;
      }
      // Ctrl+Shift+\:纵向拆分
      if (isMeta && !isAlt && isShift && (key === '\\' || key === '|')) {
        e.preventDefault();
        useLayoutStore.getState().pane.splitPane(activePaneId, 'vertical');
        return;
      }

      // Ctrl+Alt+方向键:焦点 pane 切换
      if (isMeta && isAlt && !isShift) {
        let dir: 'left' | 'right' | 'up' | 'down' | null = null;
        if (key === 'ArrowLeft') dir = 'left';
        else if (key === 'ArrowRight') dir = 'right';
        else if (key === 'ArrowUp') dir = 'up';
        else if (key === 'ArrowDown') dir = 'down';
        if (dir) {
          e.preventDefault();
          const layout = useLayoutStore.getState().rootLayout;
          const neighbor = findNeighborPane(layout, activePaneId, dir);
          if (neighbor) useLayoutStore.getState().pane.focusPane(neighbor);
          return;
        }
      }

      // Ctrl+Alt+Shift+\:关闭当前 pane(合并到兄弟后关闭)
      if (isMeta && isAlt && isShift && (key === '\\' || key === '|')) {
        e.preventDefault();
        useLayoutStore.getState().pane.mergePane(activePaneId);
        return;
      }

      // P2 v2 收口:Alt+方向键(单独按 Alt)调整 split 大小,步长 20px。
      // - 命中方向后,沿 layout 树找焦点 pane 的最近祖先 split 节点;
      // - 从 DOM 上的 [data-split-id] 读取容器实际 px 尺寸,调 setSplitSizes。
      // - setSplitSizes 内部已有 MIN_SIZE=60 的 clamp 逻辑,这里只传 px delta。
      if (isAlt && !isMeta && !isShift) {
        let dir: 'left' | 'right' | 'up' | 'down' | null = null;
        if (key === 'ArrowLeft') dir = 'left';
        else if (key === 'ArrowRight') dir = 'right';
        else if (key === 'ArrowUp') dir = 'up';
        else if (key === 'ArrowDown') dir = 'down';
        if (dir) {
          e.preventDefault();
          const layout = useLayoutStore.getState().rootLayout;
          const split = findClosestSplitAncestor(layout, activePaneId);
          if (!split || !split.id) return;
          // 方向轴与 split 轴一致才允许调;否则不响应
          const wantAxis = dir === 'left' || dir === 'right' ? 'horizontal' : 'vertical';
          if (split.dir !== wantAxis) return;
          const el = document.querySelector<HTMLElement>(`[data-split-id="${split.id}"]`);
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const totalPx = split.dir === 'horizontal' ? rect.width : rect.height;
          // 左/上:第一个 child 变小(负 delta);右/下:第一个 child 变大(正 delta)
          const sign = dir === 'left' || dir === 'up' ? -1 : 1;
          useLayoutStore.getState().pane.setSplitSizes(split.id, sign * 20, totalPx);
          return;
        }
      }

      // P4: Ctrl+P 全局搜索(在任意位置打开)
      if (isMeta && !isAlt && !isShift && (key === 'p' || key === 'P')) {
        e.preventDefault();
        void openGlobalSearch();
        return;
      }

      // P4 v1: Ctrl+Shift+F 全局递归搜索(在任意位置打开)
      if (isMeta && !isAlt && isShift && (key === 'f' || key === 'F')) {
        e.preventDefault();
        void openGlobalSearch();
        return;
      }

      // P3: Ctrl+C 复制
      if (isMeta && !isAlt && !isShift && (key === 'c' || key === 'C')) {
        e.preventDefault();
        copySelected(activePaneId);
        return;
      }

      // P3: Ctrl+X 剪切
      if (isMeta && !isAlt && !isShift && (key === 'x' || key === 'X')) {
        e.preventDefault();
        cutSelected(activePaneId);
        return;
      }

      // P3: Ctrl+V 粘贴
      if (isMeta && !isAlt && !isShift && (key === 'v' || key === 'V')) {
        e.preventDefault();
        void pasteToPane(activePaneId);
        return;
      }

      // P5: Ctrl+Shift+T 切换主题(ligh/dark/system 循环)
      if (isMeta && !isAlt && isShift && (key === 't' || key === 'T')) {
        e.preventDefault();
        const modes: ThemeMode[] = ['light', 'dark', 'system'];
        const cur = useThemeStore.getState().mode;
        const next = modes[(modes.indexOf(cur) + 1) % modes.length];
        useThemeStore.getState().setMode(next);
        useSettingsStore.getState().setTheme(next);
        return;
      }

      // G002: Ctrl+Shift+I 反选
      if (isMeta && !isAlt && isShift && (key === 'i' || key === 'I')) {
        e.preventDefault();
        runCommandById('file.invert-selection');
        return;
      }

      // P7: F12 打开开发者工具
      if (key === 'F12') {
        e.preventDefault();
        void window.tabula.app.openDevTools();
        return;
      }

      // P3: Ctrl+D 复制到当前 pane 同级目录(duplicate)
      if (isMeta && !isAlt && !isShift && (key === 'd' || key === 'D')) {
        e.preventDefault();
        const data = useFileStore.getState().panes[activePaneId];
        const selected = data?.selectedPaths ?? new Set<string>();
        if (selected.size === 0) {
          showToast('未选中任何项', 'warn', 1500);
          return;
        }
        if (selected.size > 1) {
          showToast('复制到同级目录仅支持单选', 'warn', 1500);
          return;
        }
        const srcPath = Array.from(selected)[0]!;
        const destDir = parentPath(srcPath);
        if (!destDir) {
          showToast('无法确定目标目录', 'error', 1500);
          return;
        }
        void performBulk([srcPath], destDir, 'copy', activePaneId);
        return;
      }

      // P3: F2 重命名
      if (key === 'F2') {
        e.preventDefault();
        const data = useFileStore.getState().panes[activePaneId];
        const selected = data?.selectedPaths ?? new Set<string>();
        const cursor = data?.cursorPath ?? null;
        if (selected.size === 0 && !cursor) return;
        if (selected.size > 1) {
          showToast('重命名仅支持单选', 'warn', 2000);
          return;
        }
        const target = cursor ?? Array.from(selected)[0];
        if (target) beginRename(activePaneId, target);
        return;
      }

      // P3: Delete 删除到回收站
      if (key === 'Delete' && !isShift) {
        e.preventDefault();
        const data = useFileStore.getState().panes[activePaneId];
        const selected = data?.selectedPaths ?? new Set<string>();
        if (selected.size === 0) return;
        window.dispatchEvent(
          new CustomEvent('tabula:confirm-delete', {
            detail: { paneId: activePaneId, count: selected.size },
          }),
        );
        return;
      }

      // P3: Shift+Delete 永久删除(确认)
      if (isShift && key === 'Delete') {
        e.preventDefault();
        const data = useFileStore.getState().panes[activePaneId];
        const selected = data?.selectedPaths ?? new Set<string>();
        if (selected.size === 0) return;
        setConfirmPermanentDelete({
          paneId: activePaneId,
          count: selected.size,
          paths: Array.from(selected),
        });
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    pathBarOpen,
    openPathBar,
    refresh,
    selectAll,
    clearSelection,
    activePaneId,
    activeSelected,
    newFolderOpen,
    newFileOpen,
    confirmDeleteOpen,
    openGlobalSearch,
  ]);

  const renderLayout = useMemo(() => {
    if (!hydrated) return null;
    return rootLayout;
  }, [hydrated, rootLayout]);

  return (
    <div className="app-root">
      <TitleBar />

      <div className="app-body">
        {sidebarVisible && (
          <Sidebar currentPath={activePath} onOpenPath={(p) => useLayoutStore.getState().pane.navigate(activePaneId, p)} />
        )}

        <div className="app-main">
          {renderLayout ? (
            <LayoutView node={renderLayout} />
          ) : (
            <div className="layout-loading">加载布局…</div>
          )}
          <PathBar />
        </div>
      </div>

      <StatusBar
        path={activePath}
        count={activeEntries.length}
        version={version}
        selectedCount={activeSelected?.size ?? 0}
        sortBy={sortBy}
        sortDir={sortDir}
        paneCount={paneCount}
        activePaneIndex={activePaneIndex}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      {/* P3: 全局 dialog / toast */}
      <ToastHost />
      <ConflictDialog />

      {/* P3: 全局右键菜单(单例,挂在 App 顶层,从 data-pane-id 推断目标 pane) */}
      <ContextMenu />

      {/* P6: 扩展面板浮层(订阅 ext:panel-data 推送,渲染 ext-host 推过来的数据) */}
      <ExtensionPanelView />

      {/* P7 v1: 快捷命令面板(单例,Ctrl+Shift+P 打开) */}
      <CommandPalette />

      {/* P4: 预览 / 全局搜索 — 懒加载(Suspense 兜底) */}
      <Suspense fallback={null}>
        <PreviewPanel />
        <GlobalSearch />
      </Suspense>

      {/* P7: 性能面板 (Ctrl+Shift+P) */}
      <PerfPanel />

      {/* P7: 自动更新通知(右上角) */}
      <UpdateNotification />

      <InputDialog
        open={newFolderOpen}
        title="新建文件夹"
        placeholder="新文件夹名称"
        defaultValue=""
        okLabel="创建"
        onSubmit={(name) => {
          if (newTargetPane) void createFolder(newTargetPane, name);
          setNewFolder(false, null);
        }}
        onCancel={() => setNewFolder(false, null)}
      />
      <InputDialog
        open={newFileOpen}
        title="新建文件"
        placeholder="新文件名称(例如 new.txt)"
        defaultValue="new.txt"
        okLabel="创建"
        onSubmit={(name) => {
          if (newTargetPane) void createFile(newTargetPane, name);
          setNewFile(false, null);
        }}
        onCancel={() => setNewFile(false, null)}
      />
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="确认删除"
        message={
          confirmDeleteData
            ? `确认将 ${confirmDeleteData.count} 个项目移到回收站?\n(可在回收站恢复)`
            : ''
        }
        warning="删除到回收站后可在「回收站」中恢复,不会立即永久删除。"
        okLabel="移到回收站"
        cancelLabel="取消"
        danger
        onOk={async () => {
          if (confirmDeleteData) {
            await deleteSelected(confirmDeleteData.paneId);
          }
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
      {/* P3: 永久删除确认对话框 */}
      <ConfirmDialog
        open={confirmPermanentDeleteOpen}
        title="确认永久删除"
        message={
          confirmPermanentDeleteData
            ? `确认永久删除 ${confirmPermanentDeleteData.count} 个项目?\n此操作不可恢复!`
            : ''
        }
        warning="⚠ 永久删除后无法恢复,请谨慎操作!"
        okLabel="永久删除"
        cancelLabel="取消"
        danger
        onOk={async () => {
          if (confirmPermanentDeleteData) {
            await permanentDelete(
              confirmPermanentDeleteData.paneId,
              confirmPermanentDeleteData.paths,
            );
          }
          setConfirmPermanentDelete(null);
        }}
        onCancel={() => setConfirmPermanentDelete(null)}
      />
      {/* P5: 设置页 — 懒加载(Suspense 兜底) */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <Settings onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}

      {/* P3: 属性详情面板 */}
      {propertiesPanel.open && propertiesPanel.entry && (
        <PropertiesPanel
          paneId={propertiesPanel.paneId!}
          entry={propertiesPanel.entry}
          onClose={closePropertiesPanel}
        />
      )}

      {/* P3: 批量重命名对话框 */}
      {batchRename.open && (
        <BatchRenameDialog
          paneId={batchRename.paneId ?? activePaneId}
          paths={batchRename.paths}
          names={batchRename.names}
          onClose={closeBatchRename}
          onRenamed={() => {
            if (batchRename.paneId) void refresh(batchRename.paneId);
          }}
        />
      )}
    </div>
  );
}

// =================== 工具:在 layout 树里查 pane / 邻居 ===================

import type { LayoutNode } from '@tabula/bridge';

function findPaneInLayout(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  for (const c of node.children) {
    const r = findPaneInLayout(c, paneId);
    if (r) return r;
  }
  return null;
}

function containsPane(node: LayoutNode, paneId: string): boolean {
  if (node.type === 'pane') return node.id === paneId;
  return node.children.some((c) => containsPane(c, paneId));
}

function findFirstPane(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  for (const c of node.children) {
    const r = findFirstPane(c);
    if (r) return r;
  }
  return null;
}

/** 找相邻 pane(沿 split 走,嵌套时递归) */
function findNeighborPane(
  root: LayoutNode,
  activePaneId: string,
  dir: 'left' | 'right' | 'up' | 'down',
): string | null {
  if (root.type === 'pane') return null;
  const idx = root.children.findIndex((c) => containsPane(c, activePaneId));
  if (idx < 0) return null;
  const isHoriz = dir === 'left' || dir === 'right';
  const wantAxis: 'horizontal' | 'vertical' = isHoriz ? 'horizontal' : 'vertical';
  if (root.dir !== wantAxis) {
    return findNeighborPane(root.children[idx]!, activePaneId, dir);
  }
  let targetIdx = -1;
  if (dir === 'left' || dir === 'up') targetIdx = idx - 1;
  else targetIdx = idx + 1;
  if (targetIdx < 0 || targetIdx >= root.children.length) return null;
  return findFirstPane(root.children[targetIdx]!);
}

/**
 * 找焦点 pane 的「最近 split 祖先」(直接父节点就是 split 时返回,否则继续往上)。
 * - 顶层就是单个 pane 时返回 null(没有可调的 split 容器)
 * - 用于 Alt+方向键 调整 split 大小
 */
function findClosestSplitAncestor(
  root: LayoutNode,
  paneId: string,
): Extract<LayoutNode, { type: 'split' }> | null {
  if (root.type === 'pane') return null;
  // 直接子节点里包含 paneId → 当前 root 就是最近 split 祖先
  const directHit = root.children.some(
    (c) => c.type === 'pane' && c.id === paneId,
  );
  if (directHit) return root;
  // 否则递归到每个 child 子树
  for (const c of root.children) {
    if (c.type === 'pane') continue;
    const r = findClosestSplitAncestor(c, paneId);
    if (r) return r;
  }
  return null;
}

/** 工具:取父路径 */
function parentPath(p: string): string {
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
