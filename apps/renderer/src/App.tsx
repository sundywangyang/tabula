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
import { CommandPalette } from './features/command-palette/CommandPalette';
import { runCommandById } from './command-dispatcher';
import { handleShortcutKeyDown } from './keyboard-shortcuts';
import { IpcChannels } from '@tabula/bridge';
import { LayoutView } from './features/panes/PaneContainer';
import { PerfPanel } from './features/perf/PerfPanel';
import { UpdateNotification } from './features/update/UpdateNotification';
import { useFileStore } from './stores/file-store';
import { useLayoutStore } from './stores/layout-store';
import { useFavoritesStore } from './stores/favorites-store';
import { useThemeStore } from './stores/theme-store';
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
  const newFileTargetPane = useUiDialogsStore((s) => s.newFileTargetPane);
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
  const refresh = useFileStore((s) => s.refresh);
  const ensurePane = useFileStore((s) => s.ensurePane);

  // P3
  const createFolder = useFileStore((s) => s.createFolder);
  const createFile = useFileStore((s) => s.createFile);
  const permanentDelete = useFileStore((s) => s.permanentDelete);

  // P4

  // P3: 重命名/复制
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
    const offFileChange = window.tabula.events.on(IpcChannels.FS_CHANGED, () => {
      const file = useFileStore.getState();
      for (const paneId of Object.keys(file.panes)) void file.refresh(paneId);
    });

    return () => {
      window.removeEventListener('tabula:new-folder', onNewFolder);
      window.removeEventListener('tabula:new-file', onNewFile);
      window.removeEventListener('tabula:confirm-delete', onConfirmDelete);
      window.removeEventListener('tabula:show-properties', onShowProperties);
      window.removeEventListener('tabula:batch-rename', onBatchRename);
      offRunCommand();
      offArchiveUpdate();
      offFileChange();
    };
  }, []);

  // All configurable shortcuts use the current binding table, including unbound defaults.
  useEffect(() => {
    window.addEventListener('keydown', handleShortcutKeyDown, true);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown, true);
  }, []);

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
          if (newFileTargetPane) void createFile(newFileTargetPane, name);
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
