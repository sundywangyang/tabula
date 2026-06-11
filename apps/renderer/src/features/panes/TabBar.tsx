/**
 * 标签栏
 *
 * 一个 pane 顶部一条 tab chip:
 * - active 高亮
 * - pinned 显示 📌
 * - hover 显示 × 关闭
 * - 中键关闭
 * - P3: 文件拖到 tab = 移动/复制文件到 tab.path(沿用 P3 的 mime: application/x-tabula-paths)
 * - P2 v2: tab 拖动
 *   - 自身可拖(draggable=true,普通 tab;pinned/placeholder 不可拖)
 *   - 拖到另一 tab chip = 重排/跨 pane
 *   - 拖到 pane 边缘 = 新建窗口
 *   - dataTransfer mime: application/x-tabula-tab
 */
import { type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, useState, useCallback } from 'react';
import type { LayoutNode, Tab } from '@tabula/bridge';
import { useFileStore } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import './TabBar.css';

/** HTML5 DnD mime 标识:跟 P3 文件拖放(application/x-tabula-paths)区分 */
export const TAB_DND_MIME = 'application/x-tabula-tab';

/** 拖动时携带的元信息(跨 chip 共享) */
export interface TabDragPayload {
  paneId: string;
  tabId: string;
  index: number;
}

export function TabBar({
  paneId,
  pane,
}: {
  paneId: string;
  pane: Extract<LayoutNode, { type: 'pane' }>;
}) {
  const activateTab = useLayoutStore((s) => s.pane.activateTab);
  const closeTab = useLayoutStore((s) => s.pane.closeTab);
  const mergePane = useLayoutStore((s) => s.pane.mergePane);
  const countPanes = useLayoutStore((s) => s.countPanes);
  const focusPane = useLayoutStore((s) => s.pane.focusPane);
  const moveTab = useLayoutStore((s) => s.pane.moveTab);
  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const tabDragStart = useLayoutStore((s) => s.tabDragOps.start);
  const tabDragEnd = useLayoutStore((s) => s.tabDragOps.end);
  const setDropTarget = useLayoutStore((s) => s.tabDragOps.setDropTarget);
  const pinTab = useLayoutStore((s) => s.pane.pinTab);
  const unpinTab = useLayoutStore((s) => s.pane.unpinTab);

  // =================== 右键菜单 ===================
  const [ctxMenu, setCtxMenu] = useState<{
    tab: Tab;
    x: number;
    y: number;
  } | null>(null);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const onTabCtxMenu = (tab: Tab, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ tab, x: e.clientX, y: e.clientY });
  };

  // 点击其他地方关闭菜单
  const handleClick = useCallback(() => {
    if (ctxMenu) closeCtxMenu();
  }, [ctxMenu, closeCtxMenu]);

  const fileDragState = useFileStore((s) => s.dragState);
  const setFileDragTarget = useFileStore((s) => s.setDragTarget);
  const endFileDrag = useFileStore((s) => s.endDrag);
  const performBulk = useFileStore((s) => s.performBulk);

  // 拖动期间禁止 close(关闭按钮禁用 + 中键忽略)
  const isTabDragging = tabDrag !== null;

  const onClickTab = (tab: Tab, e: ReactMouseEvent) => {
    e.stopPropagation();
    focusPane(paneId);
    activateTab(paneId, tab.id);
  };

  const onClose = (tab: Tab, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (isTabDragging) return;
    if (!tab.closable || tab.pinned) return;
    closeTab(paneId, tab.id);
  };

  const onAuxClick = (tab: Tab, e: ReactMouseEvent) => {
    if (e.button === 1) {
      e.stopPropagation();
      if (isTabDragging) return;
      if (!tab.closable || tab.pinned) return;
      closeTab(paneId, tab.id);
    }
  };

  // =================== P2 v2: tab 拖动 ===================

  /** 一个 tab 是否可拖(pinned/placeholder 不可拖) */
  const isDraggableTab = (tab: Tab): boolean => {
    if (!tab.closable && tab.id.startsWith('tab-placeholder-')) return false; // placeholder
    if (tab.pinned) return false; // pinned 不参与重排(避免误拖动)
    return true;
  };

  const onTabDragStart = (e: ReactDragEvent<HTMLDivElement>, tab: Tab, index: number) => {
    if (!isDraggableTab(tab)) {
      e.preventDefault();
      return;
    }
    const payload: TabDragPayload = { paneId, tabId: tab.id, index };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TAB_DND_MIME, JSON.stringify(payload));
    // 写一个 fallback 文本 mime(部分浏览器需要非空 dataTransfer 才能拖动)
    e.dataTransfer.setData('text/plain', tab.path ?? tab.title);
    tabDragStart(paneId, tab.id, index);
  };

  const onTabDragEnd = () => {
    // drop 成功后会清状态;这里也兜底:cancel/异常退出时清理
    tabDragEnd();
  };

  /**
   * tab chip 上 dragover:决定插入位置(左/右)
   * 注意:必须先识别 mime,如果是文件拖(P3)走老的逻辑,tab 拖走新逻辑
   */
  const onTabDragOver = (e: ReactDragEvent<HTMLDivElement>, tab: Tab, index: number) => {
    // 优先识别 tab 拖动
    if (e.dataTransfer.types.includes(TAB_DND_MIME)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      // 决定插入方向:鼠标在 chip 左半 → before(在 tab 左侧显示指示线),右半 → after
      if (!tabDrag || tabDrag.tabId !== tab.id) {
        const rect = e.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const side: 'left' | 'right' = e.clientX < midX ? 'left' : 'right';
        setDropTarget({ paneId, index, side });
      }
      return;
    }
    // 文件拖放(P3) — 老的逻辑
    if (fileDragState && tab.path) {
      e.preventDefault();
      e.stopPropagation();
      const effect: 'move' | 'copy' = e.ctrlKey || e.metaKey ? 'copy' : 'move';
      e.dataTransfer.dropEffect = effect;
      setFileDragTarget(tab.path, 'tab', effect);
    }
  };

  const onTabDragLeave = (_e: ReactDragEvent<HTMLDivElement>, _tab: Tab, index: number) => {
    // 鼠标离开 chip 到非 drop 区:清掉自己这块的 dropTarget
    if (tabDrag && tabDrag.dropTarget && tabDrag.dropTarget.paneId === paneId) {
      // 只有当 dropTarget 指向这个 tab 时才清(避免相邻 chip dragleave 抖动)
      if (tabDrag.dropTarget.index === index) {
        setDropTarget(null);
      }
    }
  };

  const onTabDrop = (e: ReactDragEvent<HTMLDivElement>, tab: Tab, index: number) => {
    // 优先处理 tab 拖放
    const tabPayload = e.dataTransfer.getData(TAB_DND_MIME);
    if (tabPayload) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const payload = JSON.parse(tabPayload) as TabDragPayload;
        // 落到自己身上 → no-op(防止 reorderTabs 把源 tab 误移到相邻位置)
        if (payload.paneId === paneId && payload.tabId === tab.id) {
          return;
        }
        // 决定插入索引:before → 目标 index;after → 目标 index + 1
        // 同 pane 时 fromIndex < toIndex 的修正由 reorderTabs 内部处理
        const rect = e.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const before = e.clientX < midX;
        const toIndex = before ? index : index + 1;
        moveTab(payload.paneId, payload.tabId, paneId, toIndex);
      } catch (err) {
        console.warn('[TabBar] invalid tab drag payload', err);
      } finally {
        tabDragEnd();
      }
      return;
    }
    // 文件拖放(P3)
    e.preventDefault();
    e.stopPropagation();
    const state = useFileStore.getState().dragState;
    if (!state || !tab.path) {
      endFileDrag();
      return;
    }
    const mode: 'copy' | 'move' = state.effect === 'copy' ? 'copy' : 'move';
    void performBulk(state.paths, tab.path, mode, state.sourcePaneId);
    endFileDrag();
  };

  // =================== 渲染 ===================

  return (
    <div
      className="tab-bar"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={handleClick}
    >
      {pane.tabs.map((tab, index) => {
        const active = tab.id === pane.activeTabId;
        const isSource = tabDrag?.tabId === tab.id;
        const dropSide =
          tabDrag?.dropTarget &&
          tabDrag.dropTarget.paneId === paneId &&
          tabDrag.dropTarget.index === index
            ? tabDrag.dropTarget.side
            : null;
        const isFileDropOver =
          fileDragState &&
          fileDragState.targetKind === 'tab' &&
          fileDragState.targetPath === tab.path;
        const className = [
          'tab-chip',
          active ? 'tab-active' : '',
          tab.pinned ? 'tab-pinned' : '',
          isSource ? 'tab-dragging' : '',
          dropSide === 'left' ? 'drop-before' : '',
          dropSide === 'right' ? 'drop-after' : '',
          isFileDropOver ? 'drag-over' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={tab.id}
            className={className}
            title={tab.path ?? tab.title}
            onClick={(e) => onClickTab(tab, e)}
            onAuxClick={(e) => onAuxClick(tab, e)}
            onContextMenu={(e) => onTabCtxMenu(tab, e)}
            draggable={isDraggableTab(tab) && !isTabDragging}
            onDragStart={(e) => onTabDragStart(e, tab, index)}
            onDragEnd={onTabDragEnd}
            onDragOver={(e) => onTabDragOver(e, tab, index)}
            onDragLeave={(e) => onTabDragLeave(e, tab, index)}
            onDrop={(e) => onTabDrop(e, tab, index)}
          >
            <span className="tab-icon" aria-hidden>
              {tab.pinned ? '📌' : tab.type === 'preview' ? '👁' : '📁'}
            </span>
            <span className="tab-title">{tab.title || '空'}</span>
            {tab.closable && (
              <button
                type="button"
                className="tab-close"
                onClick={(e) => onClose(tab, e)}
                onMouseDown={(e) => e.stopPropagation()}
                title="关闭 (Ctrl+W)"
                aria-label="关闭标签"
                disabled={isTabDragging}
              >
                ×
                           </button>
            )}
          </div>
        );
      })}

      {/* 关闭当前窗格按钮 — 多窗格时显示 */}
      {countPanes() > 1 && (
        <button
          type="button"
          className="tab-close pane-close-btn"
          onClick={() => mergePane(paneId)}
          title="关闭当前窗格 (Ctrl+Alt+Shift+\)"
          aria-label="关闭当前窗格"
        >
          ✕
        </button>
      )}

      {/* 标签右键菜单 */}
      {ctxMenu && (
        <div
          className="tab-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.tab.pinned ? (
            <button
              className="tab-ctx-item"
              onClick={() => {
                unpinTab(paneId, ctxMenu.tab.id);
                closeCtxMenu();
              }}
            >
              <span className="tab-ctx-icon">📌</span>
              <span>取消固定</span>
            </button>
          ) : (
            <button
              className="tab-ctx-item"
              onClick={() => {
                pinTab(paneId, ctxMenu.tab.id);
                closeCtxMenu();
              }}
            >
              <span className="tab-ctx-icon">📌</span>
              <span>固定标签</span>
            </button>
          )}
          <div className="tab-ctx-divider" />
          <button
            className="tab-ctx-item danger"
            disabled={!ctxMenu.tab.closable || ctxMenu.tab.pinned}
            onClick={() => {
              if (ctxMenu.tab.closable && !ctxMenu.tab.pinned) {
                closeTab(paneId, ctxMenu.tab.id);
              }
              closeCtxMenu();
            }}
          >
            <span className="tab-ctx-icon">✕</span>
            <span>关闭标签</span>
          </button>
        </div>
      )}
    </div>
  );
}
