/**
 * 窗格视图(叶子节点)
 *
 * 结构:
 * - TabBar(一条 tab chips)
 * - PaneContent(包 Toolbar + Breadcrumb + FileList)
 *
 * 焦点 pane 视觉上有 accent 边框。
 * activeTab.path 变化会触发 file-store.loadDir(用 useEffect 监听)。
 *
 * P2 v2: 拖动 tab 到 pane 边缘 = 「拖出新建窗口」。
 *  - 右边缘(右侧 80px 列)→ 右侧「拖出新建窗口」虚线占位
 *  - 下边缘(底部 80px 行)→ 底部「拖出新建窗口」虚线占位
 *  - drop → 调 window.tabula.windows.openWithTab + 从源 pane 移除 tab
 */
import { useEffect, useRef, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { FsEntry, LayoutNode, Tab } from '@tabula/bridge';
import { Breadcrumb } from '../../components/Breadcrumb';
import { Toolbar } from '../../components/Toolbar';
import { FileList } from '../file-list/FileList';
import { SearchBar } from '../file-list/SearchBar';
import { TrashPane } from '../trash/TrashPane';
import { useFileStore, type BreadcrumbSegment } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import { TabBar, TAB_DND_MIME, type TabDragPayload } from './TabBar';
import './PaneView.css';

const TRASH_PATH = 'trash:///';

const isTrashPane = (path?: string): boolean => path === TRASH_PATH;

const EDGE_THRESHOLD = 80; // px

export function PaneView({
  paneId,
  pane,
}: {
  paneId: string;
  pane: Extract<LayoutNode, { type: 'pane' }>;
}) {
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const focusPane = useLayoutStore((s) => s.pane.focusPane);
  const replaceTabPath = useLayoutStore((s) => s.pane.replaceTabPath);
  const closeTab = useLayoutStore((s) => s.pane.closeTab);
  const ensurePane = useFileStore((s) => s.ensurePane);

  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const setDropEdge = useLayoutStore((s) => s.tabDragOps.setDropEdge);
  const tabDragEnd = useLayoutStore((s) => s.tabDragOps.end);

  const paneData = useFileStore((s) => s.panes[paneId]);
  const loadDir = useFileStore((s) => s.loadDir);

  const isFocused = activePaneId === paneId;
  const containerRef = useRef<HTMLDivElement>(null);

  // 挂载时确保 file-store 有 pane 数据空壳
  useEffect(() => {
    void ensurePane(paneId);
  }, [paneId, ensurePane]);

  // 监听 active tab path 变化:触发 loadDir(初始/切换 tab / goBack / goForward)
  // 非焦点 pane 不主动加载,节省启动时间和网络,等用户聚焦时再加载。
  const activeTab: Tab | undefined = pane.tabs.find((t) => t.id === pane.activeTabId);
  const activeTabPath = activeTab?.path;
  const isTrash = isTrashPane(activeTabPath);
  useEffect(() => {
    if (!activeTab) return;
    if (!isFocused) return;
    if (!activeTabPath) return;
    if (isTrash) return; // 回收站由 TrashPane 自己加载
    const cur = useFileStore.getState().panes[paneId];
    if (cur?.currentPath !== activeTabPath) {
      void loadDir(paneId, activeTabPath);
    }
  }, [paneId, activeTab, activeTabPath, loadDir, isFocused, isTrash]);

  // 全局兜底:监听 tab 拖动期间的 window dragend,确保清理(HTML5 dragend 在
  // source 上触发,但有时快速拖出浏览器外会丢失)。挂一次即可。
  useEffect(() => {
    if (!tabDrag) return;
    const handler = () => tabDragEnd();
    window.addEventListener('dragend', handler, true);
    window.addEventListener('drop', handler, true);
    return () => {
      window.removeEventListener('dragend', handler, true);
      window.removeEventListener('drop', handler, true);
    };
  }, [tabDrag, tabDragEnd]);

  const onFocusPane = () => {
    if (!isFocused) focusPane(paneId);
  };

  const handleOpen = async () => {
    const p = await window.tabula.fs.pickDirectory();
    if (p) {
      if (activeTab) {
        replaceTabPath(paneId, activeTab.id, p);
      } else {
        void loadDir(paneId, p);
      }
    }
  };

  // 面包屑
  const breadcrumb: BreadcrumbSegment[] = paneData?.breadcrumb ?? [];

  // =================== P2 v2: pane 边缘拖出 ===================

  /** 根据鼠标位置判断在哪条边缘(right/bottom/null) */
  const detectEdge = (
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ): 'right' | 'bottom' | null => {
    const distRight = rect.right - clientX;
    const distBottom = rect.bottom - clientY;
    // 在右边缘带 且 比下边缘带近
    if (distRight <= EDGE_THRESHOLD && distRight <= distBottom) return 'right';
    if (distBottom <= EDGE_THRESHOLD) return 'bottom';
    return null;
  };

  const onContainerDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!tabDrag) return;
    if (!e.dataTransfer.types.includes(TAB_DND_MIME)) return;
    // 文件拖放(FileList 会处理)+ tab 拖动 但光标在 tab chip 上(chip 自己会处理)
    // 都不要在这接。我们只在「光标在边缘带」时介入。
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = detectEdge(e.clientX, e.clientY, rect);
    if (!edge) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (tabDrag.dropEdge !== edge) {
      setDropEdge(edge);
    }
  };

  const onContainerDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!tabDrag) return;
    // 简单粗暴:leave 到 pane 外部时清掉(因为嵌套元素 dragleave 会抖动,这里只清 edge)
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (tabDrag.dropEdge) {
      setDropEdge(null);
    }
  };

  const onContainerDrop = async (e: ReactDragEvent<HTMLDivElement>) => {
    if (!tabDrag) return;
    const payloadStr = e.dataTransfer.getData(TAB_DND_MIME);
    if (!payloadStr) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = detectEdge(e.clientX, e.clientY, rect);
    if (!edge) {
      // 不在边缘,不该在这 drop(可能由 tab chip 抢走了);忽略
      tabDragEnd();
      return;
    }
    let payload: TabDragPayload;
    try {
      payload = JSON.parse(payloadStr) as TabDragPayload;
    } catch {
      tabDragEnd();
      return;
    }
    // 在源 pane 找到这个 tab,取 path
    const layout = useLayoutStore.getState().rootLayout;
    let movedTab: Tab | null = null;
    const walk = (n: LayoutNode): boolean => {
      if (n.type === 'pane') {
        if (n.id === payload.paneId) {
          movedTab = n.tabs.find((t) => t.id === payload.tabId) ?? null;
          return movedTab !== null;
        }
        return false;
      }
      return n.children.some(walk);
    };
    walk(layout);
    if (!movedTab) {
      tabDragEnd();
      return;
    }
    const tab = movedTab as Tab;
    const initialPath = tab.path ?? '';
    const title = tab.title;

    // 从源 pane 移除
    closeTab(payload.paneId, payload.tabId);

    // 开新窗口
    try {
      if (initialPath) {
        await window.tabula.windows.openWithTab({ initialPath, title });
      } else {
        // 没有 path(预览 tab 等),退化为普通开窗
        await window.tabula.windows.open();
      }
    } catch (err) {
      console.warn('[PaneView] openWithTab failed', err);
      useFileStore.getState().showToast(`拖出到新窗口失败: ${String(err)}`, 'error', 4000);
    } finally {
      tabDragEnd();
    }
  };

  const showRightZone = tabDrag?.dropEdge === 'right';
  const showBottomZone = tabDrag?.dropEdge === 'bottom';

  // 禁用 chrome 区域(tabs/breadcrumb/toolbar)上的右键 context menu
  // 这些是 UI 布局区,不需要原生右键菜单
  const blockContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      className={`pane-view ${isFocused ? 'pane-focused' : 'pane-unfocused'} ${
        tabDrag ? 'pane-drag-active' : ''
      }`}
      onMouseDown={onFocusPane}
      data-pane-id={paneId}
      onDragOver={onContainerDragOver}
      onDragLeave={onContainerDragLeave}
      onDrop={onContainerDrop}
    >
      <div
        className={`tab-bar-wrap ${tabDrag ? 'is-dragging' : ''}`}
        data-no-context-menu
        onContextMenu={blockContextMenu}
      >
        <TabBar paneId={paneId} pane={pane} />
      </div>

      {!isTrash && (
        <>
          <div className="pane-toolbar" data-no-context-menu onContextMenu={blockContextMenu}>
            <Breadcrumb
              segments={breadcrumb}
              onNavigate={(p) => {
                if (activeTab) replaceTabPath(paneId, activeTab.id, p);
                else void loadDir(paneId, p);
              }}
              onOpenPicker={handleOpen}
            />
          </div>
          <Toolbar paneId={paneId} />
          <SearchBar paneId={paneId} />
        </>
      )}

      <div className="pane-content">
        {/* 空窗格(无 tabs):显示引导提示 */}
        {pane.activeTabId === null ? (
          <div className="pane-empty-state">
            <div className="pane-empty-icon">📂</div>
            <div className="pane-empty-title">暂无打开的文件夹</div>
            <div className="pane-empty-hint">双击任意文件夹或在地址栏输入路径开始浏览</div>
          </div>
        ) : isTrash ? (
          <TrashPane paneId={paneId} />
        ) : (
          <>
            <FileList
              paneId={paneId}
              onOpenEntry={(e: FsEntry) => {
                if (e.isDirectory) {
                  if (activeTab) replaceTabPath(paneId, activeTab.id, e.path);
                  else void loadDir(paneId, e.path);
                } else {
                  void window.tabula.fs.openPath(e.path);
                }
              }}
            />
            {/* P3 右键菜单已上移至 App 顶层(全局单例) */}
          </>
        )}
      </div>

      {/* P2 v2: 拖出新建窗口的虚线占位 */}
      {showRightZone && (
        <div className="pane-drop-zone pane-drop-zone-right" aria-hidden>
          <div className="drop-zone-label">拖出新建窗口</div>
        </div>
      )}
      {showBottomZone && (
        <div className="pane-drop-zone pane-drop-zone-bottom" aria-hidden>
          <div className="drop-zone-label">拖出新建窗口</div>
        </div>
      )}
    </div>
  );
}
