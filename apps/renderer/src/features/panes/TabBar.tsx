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
 *   - 自身可拖(pinned/placeholder 不可拖)
 *   - 拖到另一 tab chip = 重排/跨 pane
 *   - 拖到 pane 边缘 = 新建窗口
 *
 * 实现说明: 用 Pointer Events 自己实现拖动,不用 HTML5 drag API。
 * HTML5 drag 在 Electron 33 + StrictMode + 嵌套容器下不稳定,改用 Pointer Events 可靠。
 */
import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { Eye, Folder, Pin, X } from 'lucide-react';
import type { LayoutNode, Tab } from '@tabula/bridge';
import { useFileStore, makeFolderTab } from '../../stores/file-store';
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

  // =================== P2 v2: tab 拖动 (Pointer Events 自实现) ===================

  // 拖动中跟随光标的视觉位移(像素) — Step 1: 实时同步 X 坐标
  const [dragOffsetX, setDragOffsetX] = useState(0);
  // 被拖的 tab id (用于给 .tab-chip 加 transform)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  // 被拖 tab 原始 left (px, 相对 .tab-bar 容器)
  const [dragSourceLeft, setDragSourceLeft] = useState(0);
  // 按下时鼠标在 tab 内的 X 偏移(相对 tab 左边缘) — 用于保持"抓取点"稳定
  const [grabOffsetX, setGrabOffsetX] = useState(0);
  // 固定 tab 宽度 + gap, 让位精确 (与 .tab-bar 的 --tab-w + --tab-gap 一致)
  const TAB_W = 180;
  const DRAG_W = 90; // 拖动中显示宽度(原始一半)
  const TAB_GAP = 2;
  const dropSlotWidth = TAB_W + TAB_GAP;
  const tabBarRef = useRef<HTMLDivElement | null>(null);

  /** 一个 tab 是否可拖(pinned/placeholder 不可拖) */
  const isDraggableTab = (tab: Tab): boolean => {
    if (!tab.closable && tab.id.startsWith('tab-placeholder-')) return false; // placeholder
    if (tab.pinned) return false; // pinned 不参与重排(避免误拖动)
    return true;
  };

  // Pointer Events 拖动状态(用 ref 避免重渲染)
  const pointerDragRef = useRef<{
    paneId: string;
    tabId: string;
    index: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  // 全局 pointermove / pointerup 监听 (在拖动期间挂上, 结束后清掉)
  // 关键修复: deps 不含 tabDrag / moveTab / setDropTarget 等会变化的引用
  // 这些函数会变化 → effect 反复 cleanup/挂载 → 中间丢失 pointermove
  // 用 ref 缓存函数引用,deps 永远空数组
  const effectFnsRef = useRef({ tabDragStart, tabDragEnd, setDropTarget, moveTab });
  effectFnsRef.current = { tabDragStart, tabDragEnd, setDropTarget, moveTab };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = pointerDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      // 调试: 实时打印光标位置
      console.log('[TabBar] pointermove', { dx: Math.round(dx), dy: Math.round(dy), active: d.active, x: e.clientX, y: e.clientY });
      if (!d.active && Math.hypot(dx, dy) < 4) return;
      if (!d.active) {
        d.active = true;
        effectFnsRef.current.tabDragStart(d.paneId, d.tabId, d.index);
        setDraggingTabId(d.tabId);
      }
      // Step 1: 让被拖的 tab 跟着光标水平移动
      setDragOffsetX(dx);
      // 找光标下的 tab chip (用 data-tab-index 标识)
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const chip = el?.closest<HTMLElement>('[data-tab-index]');
      if (chip) {
        const targetIndex = Number(chip.dataset.tabIndex);
        const targetPaneId = chip.dataset.paneId;
        console.log('[TabBar] hit target', { paneId: targetPaneId, index: targetIndex });
        if (targetPaneId && !isNaN(targetIndex)) {
          const rect = chip.getBoundingClientRect();
          const midX = rect.left + rect.width / 2;
          const side: 'left' | 'right' = e.clientX < midX ? 'left' : 'right';
          effectFnsRef.current.setDropTarget({ paneId: targetPaneId, index: targetIndex, side });
        }
      } else {
        console.log('[TabBar] no target under cursor');
        effectFnsRef.current.setDropTarget(null);
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = pointerDragRef.current;
      console.log('[TabBar] pointerup', { active: d?.active, x: e.clientX });
      if (!d || !d.active) {
        pointerDragRef.current = null;
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const chip = el?.closest<HTMLElement>('[data-tab-index]');
      if (chip) {
        const targetIndex = Number(chip.dataset.tabIndex);
        const targetPaneId = chip.dataset.paneId;
        const rect = chip.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const before = e.clientX < midX;
        const toIndex = before ? targetIndex : targetIndex + 1;
        if (targetPaneId === d.paneId && d.index === targetIndex) {
          // 落到自己身上 → no-op
        } else {
          console.log('[TabBar] moveTab', { from: d.index, to: toIndex, pane: targetPaneId });
          effectFnsRef.current.moveTab(d.paneId, d.tabId, targetPaneId!, toIndex);
        }
      }
      pointerDragRef.current = null;
      effectFnsRef.current.tabDragEnd();
      effectFnsRef.current.setDropTarget(null);
      setDragOffsetX(0);
      setDraggingTabId(null);
    };
    const onCancel = () => {
      pointerDragRef.current = null;
      effectFnsRef.current.tabDragEnd();
      effectFnsRef.current.setDropTarget(null);
      setDragOffsetX(0);
      setDraggingTabId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, []); // deps 永远空,只在 TabBar 挂载/卸载时跑一次

  // pointerdown 启动拖动候选(等用户拖过 4px 才认作 drag)
  const onTabPointerDown = (e: ReactPointerEvent<HTMLDivElement>, tab: Tab, index: number) => {
    console.log('[TabBar] pointerdown', { tab: tab.title, button: e.button, draggable: isDraggableTab(tab), x: e.clientX, y: e.clientY });
    if (e.button !== 0) return; // 只响应左键
    if (!isDraggableTab(tab)) return;
    // 测量被拖 tab 相对 .tab-bar 容器的 left (后续用 position: absolute 时定位)
    const tabBar = e.currentTarget.parentElement;
    if (tabBar) {
      const tabRect = e.currentTarget.getBoundingClientRect();
      const barRect = tabBar.getBoundingClientRect();
      const sourceLeft = tabRect.left - barRect.left;
      setDragSourceLeft(sourceLeft);
      // 记录鼠标按下时相对 tab 左边缘的偏移, 拖动时让"抓取点"跟随光标
      // (无论在 tab 哪个位置按下, 抓取点都是同一点, 不会突然跳到中心)
      setGrabOffsetX(e.clientX - tabRect.left);
    }
    pointerDragRef.current = {
      paneId,
      tabId: tab.id,
      index,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    // 关键: 不用 e.preventDefault() 阻止默认,因为 Chromium 33 在某些情况下
    // 会用 preventDefault 阻止后续 pointermove 事件。
    // 改用 capture phase 监听器 + setPointerCapture 来确保我们拿到所有 pointer 事件。
    if (e.currentTarget.setPointerCapture && e.pointerId !== undefined) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // 某些元素不支持 setPointerCapture,忽略
      }
    }
  };

  /**
   * tab chip 上 dragover(仅文件拖放,HTML5 drag API):
   * 注意: tab 自己拖动走 Pointer Events;这里只剩 P3 文件拖到 tab 的逻辑
   */
  const onTabDragOver = (e: ReactDragEvent<HTMLDivElement>, tab: Tab, _index: number) => {
    // 文件拖放(P3) — 老的逻辑
    if (fileDragState && tab.path) {
      e.preventDefault();
      e.stopPropagation();
      const effect: 'move' | 'copy' = e.ctrlKey || e.metaKey ? 'copy' : 'move';
      e.dataTransfer.dropEffect = effect;
      setFileDragTarget(tab.path, 'tab', effect);
    }
  };

  const onTabDrop = (e: ReactDragEvent<HTMLDivElement>, tab: Tab, _index: number) => {
    // tab 拖动走 Pointer Events 不进这里;这里只处理 P3 文件拖到 tab
    if (fileDragState && tab.path) {
      e.preventDefault();
      e.stopPropagation();
      const state = useFileStore.getState().dragState;
      if (!state) return;
      const mode: 'copy' | 'move' = state.effect === 'copy' ? 'copy' : 'move';
      void performBulk(state.paths, tab.path, mode, state.sourcePaneId);
      endFileDrag();
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
        const isBeingDragged = draggingTabId === tab.id;

        // Step 2.7: 拖动中 tab 缩到一半 (90px) + 透明度 50%, tab 中心 = 鼠标 X
        // 鼠标按下时, 鼠标在 tab 上的 X = dragSourceLeft + grabOffsetX (在 .tab-bar 坐标系)
        // 鼠标当前 X = (dragSourceLeft + grabOffsetX) + dragOffsetX
        // 期望: tab 中心 (现在宽 DRAG_W) = 鼠标当前 X
        //   → tab 左边缘 = 鼠标 X - DRAG_W/2
        // tab 现在 absolute 在 dragSourceLeft + transform
        //   → transform = (dragSourceLeft + grabOffsetX + dragOffsetX) - DRAG_W/2 - dragSourceLeft
        //   → transform = grabOffsetX + dragOffsetX - DRAG_W/2
        const halfDragW = DRAG_W / 2; // 45
        let chipStyle: React.CSSProperties | undefined;
        if (isBeingDragged) {
          chipStyle = {
            position: 'absolute',
            left: `${dragSourceLeft}px`,
            top: 4,
            zIndex: 100,
            transform: `translateX(${grabOffsetX + dragOffsetX - halfDragW}px)`,
            willChange: 'transform',
          };
        }
        // 不再做"让位 transform", 依赖 flex 流自动塌缩 (无闪烁)

        const className = [
          'tab-chip',
          active ? 'tab-active' : '',
          tab.pinned ? 'tab-pinned' : '',
          isSource ? 'tab-dragging' : '',
          dropSide === 'left' ? 'drop-before' : '',
          dropSide === 'right' ? 'drop-after' : '',
          isFileDropOver ? 'drag-over' : '',
          isBeingDragged ? 'is-dragging-active' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={tab.id}
            className={className}
            title={tab.path ?? tab.title}
            data-tab-index={index}
            data-pane-id={paneId}
            style={chipStyle}
            onClick={(e) => onClickTab(tab, e)}
            onPointerDown={(e) => onTabPointerDown(e, tab, index)}
            onAuxClick={(e) => onAuxClick(tab, e)}
            onContextMenu={(e) => onTabCtxMenu(tab, e)}
            onDragOver={(e) => onTabDragOver(e, tab, index)}
            onDrop={(e) => onTabDrop(e, tab, index)}
          >
            <span className="tab-icon" aria-hidden>
              {tab.pinned ? <Pin size={12} /> : tab.type === 'preview' ? <Eye size={12} /> : <Folder size={12} />}
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
                <X size={11} />
                           </button>
            )}
          </div>
        );
      })}

      {/* 新建标签按钮 */}
      <button
        type="button"
        className="tab-add"
        onClick={() => {
          const tab = makeFolderTab('', '新标签');
          useLayoutStore.getState().pane.openTab(paneId, tab);
        }}
        title="新建标签 (Ctrl+T)"
        aria-label="新建标签"
      >
        +
      </button>

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
              <span className="tab-ctx-icon"><Pin size={13} /></span>
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
              <span className="tab-ctx-icon"><Pin size={13} /></span>
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
