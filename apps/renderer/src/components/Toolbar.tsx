/**
 * 工具栏
 *
 * 视图模式切换 + 显示选项(隐藏文件 / 隐藏扩展名)
 * 路径按钮 + 刷新
 * P3: 新建文件夹/文件按钮(顶在最左)
 *
 * P2: openPathBar 需要 paneId(每个 pane 独立打开路径栏,这里取 active pane)
 */
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useFileStore, type ViewMode } from '../stores/file-store';
import { useFavoritesStore } from '../stores/favorites-store';
import { useLayoutStore } from '../stores/layout-store';
import type { Tab } from '@tabula/bridge';
import './Toolbar.css';

// 右键历史菜单最大条目数
const MAX_HISTORY_MENU_ITEMS = 20;

const VIEW_MODES: { mode: ViewMode; icon: string; label: string }[] = [
  { mode: 'list', icon: '☰', label: '列表' },
  { mode: 'grid', icon: '▦', label: '网格' },
  { mode: 'details', icon: '☷', label: '详情' },
];

// 模块级常量，避免 selector 每次渲染创建新引用
const EMPTY_PATH = '';
const EMPTY_SET = Object.freeze(new Set<string>());

/** 从 Tab 获取历史（去重，过滤 null/undefined） */
function getTabHistory(tab: Tab): string[] {
  return (tab.history ?? []).filter((p): p is string => Boolean(p));
}

export function Toolbar({ paneId }: { paneId: string }) {
  // 数据切片（值类型，不创建新引用）
  const viewMode = useFileStore((s) => s.panes[paneId]?.viewMode ?? 'details');
  const showHidden = useFileStore((s) => s.showHidden);
  const showExtensions = useFileStore((s) => s.showExtensions);
  const currentPath = useFileStore((s) => s.panes[paneId]?.currentPath ?? EMPTY_PATH);
  // selectedPaths 必须是稳定引用——用 Object.freeze 的空 Set 而非 new Set()
  const selectedPaths = useFileStore((s) => s.panes[paneId]?.selectedPaths ?? EMPTY_SET);
  const cursorPath = useFileStore((s) => s.panes[paneId]?.cursorPath ?? null);
  const clipboard = useFileStore((s) => s.clipboard);

  // 前进/后退状态：从 layout-store 取 active tab 的 history 信息
  const [historyMenuOpen, setHistoryMenuOpen] = useState<'back' | 'forward' | null>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  // 获取 active tab
  const activeTab = useMemo(() => {
    const root = useLayoutStore.getState().rootLayout;
    const paneNode = findPaneNode(root, paneId);
    if (!paneNode || paneNode.type !== 'pane' || !paneNode.activeTabId) return null;
    return paneNode.tabs.find((t) => t.id === paneNode.activeTabId) ?? null;
  }, [paneId]);

  const history = useMemo(() => activeTab ? getTabHistory(activeTab) : [], [activeTab]);
  const historyIndex = activeTab?.historyIndex ?? -1;
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  // 关闭历史菜单的 effect
  useEffect(() => {
    if (!historyMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node)) {
        setHistoryMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [historyMenuOpen]);

  // 前进/后退 handlers
  const handleGoBack = () => {
    useLayoutStore.getState().pane.goBack(paneId);
  };

  const handleGoForward = () => {
    useLayoutStore.getState().pane.goForward(paneId);
  };

  // 右键打开历史菜单
  const handleNavMouseDown = (dir: 'back' | 'forward') => (e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      setHistoryMenuOpen(dir);
    }
  };

  // 从历史菜单跳转
  const handleHistoryJump = (path: string) => {
    setHistoryMenuOpen(null);
    useLayoutStore.getState().pane.navigate(paneId, path);
  };

  // 阻止默认右键菜单
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // 历史菜单数据
  const backHistory = useMemo(() => history.slice(0, historyIndex).reverse().slice(0, MAX_HISTORY_MENU_ITEMS), [history, historyIndex]);
  const forwardHistory = useMemo(() => history.slice(historyIndex + 1).slice(0, MAX_HISTORY_MENU_ITEMS), [history, historyIndex]);
  const menuItems = historyMenuOpen === 'back' ? backHistory : forwardHistory;

  // 所有 action 用 getState() 获取（避免 selector 返回函数导致 getSnapshot 缓存失效）
  const { setViewMode, openPathBar, refresh, showToast } = useFileStore.getState();
  const toggleShowHidden = useFileStore.getState().toggleShowHidden;
  const toggleShowExtensions = useFileStore.getState().toggleShowExtensions;
  const copySelected = useFileStore.getState().copySelected;
  const cutSelected = useFileStore.getState().cutSelected;
  const pasteToPane = useFileStore.getState().pasteToPane;
  const beginRename = useFileStore.getState().beginRename;

  // P5: 收藏
  const isFavorite = useMemo(
    () => (currentPath ? useFavoritesStore.getState().favorites.some((f) => f.path === currentPath) : false),
    [currentPath],
  );
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const handleToggleFavorite = () => {
    if (!currentPath) {
      showToast('当前未选择目录,无法收藏', 'warn', 1800);
      return;
    }
    const nowFav = toggleFavorite(currentPath);
    showToast(
      nowFav ? `已收藏: ${currentPath}` : '已从收藏移除',
      'success',
      1500,
    );
  };

  // P3: 新建按钮
  const handleNewFolder = () => {
    // 触发 app-level 弹窗
    window.dispatchEvent(
      new CustomEvent('tabula:new-folder', { detail: { paneId } }),
    );
  };
  const handleNewFile = () => {
    window.dispatchEvent(
      new CustomEvent('tabula:new-file', { detail: { paneId } }),
    );
  };

  // P3: 文件操作按钮
  const hasSelection = selectedPaths.size > 0;
  const hasClipboard = clipboard !== null && clipboard.paths.length > 0;

  const handleCopy = () => copySelected(paneId);
  const handleCut = () => cutSelected(paneId);
  const handlePaste = () => { void pasteToPane(paneId); };
  const handleCopyPath = async () => {
    const paths = selectedPaths.size > 0 ? Array.from(selectedPaths) : (cursorPath ? [cursorPath] : []);
    if (paths.length > 0) {
      await window.tabula.fs.writeClipboard(paths.join('\n'));
      showToast('路径已复制', 'success', 1500);
    }
  };
  const handleDelete = () => {
    if (selectedPaths.size === 0) return;
    window.dispatchEvent(
      new CustomEvent('tabula:confirm-delete', {
        detail: { paneId, count: selectedPaths.size },
      }),
    );
  };
  const handleRename = () => {
    if (selectedPaths.size === 0 && !cursorPath) return;
    if (selectedPaths.size > 1) {
      showToast('重命名仅支持单选', 'warn', 1500);
      return;
    }
    const target = cursorPath ?? Array.from(selectedPaths)[0];
    if (target) beginRename(paneId, target);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  // 滚轮横滚支持（同时按住 Shift 时竖滚 = 横滚）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // 浏览器原生横滚
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // 溢出状态感知
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollState({ left: el.scrollLeft > 4, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4 });
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState]);

  const scrollBy = (delta: number) => scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  // 禁用 toolbar 滚动容器自身的右键 context menu
  // (子按钮上的右键不受影响 — 它们自己处理或冒泡)
  const handleScrollContainerContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const scrollClass = [
    'toolbar-scroll-container',
    scrollState.left ? 'has-overflow-left' : '',
    scrollState.right ? 'has-overflow-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="toolbar" onContextMenu={handleScrollContainerContextMenu}>
      {/* 左滚动按钮 */}
      {scrollState.left && (
        <button className="toolbar-scroll-btn toolbar-scroll-left" onClick={() => scrollBy(-80)} aria-label="向左滚动">
          ‹
        </button>
      )}
      {/* 横向滚动容器 */}
      <div
        className={scrollClass}
        ref={scrollRef}
        onContextMenu={handleScrollContainerContextMenu}
      >
      {/* 前进/后退按钮组 */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-nav ${canGoBack ? '' : 'disabled'}`}
          onClick={handleGoBack}
          onMouseDown={handleNavMouseDown('back')}
          onContextMenu={handleContextMenu}
          disabled={!canGoBack}
          title="后退 (Alt+←)"
        >
          <span className="toolbar-icon">◀</span>
        </button>
        <button
          className={`toolbar-btn toolbar-nav ${canGoForward ? '' : 'disabled'}`}
          onClick={handleGoForward}
          onMouseDown={handleNavMouseDown('forward')}
          onContextMenu={handleContextMenu}
          disabled={!canGoForward}
          title="前进 (Alt+→)"
        >
          <span className="toolbar-icon">▶</span>
        </button>
      </div>

      {/* 历史菜单下拉 */}
      {historyMenuOpen && menuItems.length > 0 && (
        <div className="toolbar-history-menu" ref={historyMenuRef}>
          {menuItems.map((path, i) => (
            <div
              key={i}
              className="toolbar-history-item"
              onClick={() => handleHistoryJump(path)}
            >
              {path}
            </div>
          ))}
        </div>
      )}

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-new"
          onClick={handleNewFolder}
          onContextMenu={(e) => {
            e.preventDefault();
            handleNewFile();
          }}
          title="新建文件夹(右键 = 新建文件)"
        >
          <span className="toolbar-icon">＋</span>
          <span className="toolbar-label">新建</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* P3: 文件操作按钮 */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={handleCopy}
          disabled={!hasSelection}
          title="复制 (Ctrl+C)"
        >
          <span className="toolbar-icon">📋</span>
          <span className="toolbar-label">复制</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleCut}
          disabled={!hasSelection}
          title="剪切 (Ctrl+X)"
        >
          <span className="toolbar-icon">✂</span>
          <span className="toolbar-label">剪切</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handlePaste}
          disabled={!hasClipboard}
          title="粘贴 (Ctrl+V)"
        >
          <span className="toolbar-icon">📄</span>
          <span className="toolbar-label">粘贴</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleCopyPath}
          disabled={!hasSelection && !cursorPath}
          title="复制路径"
        >
          <span className="toolbar-icon">🔗</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleDelete}
          disabled={!hasSelection}
          title="删除 (Delete)"
        >
          <span className="toolbar-icon">🗑</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={handleRename}
          disabled={!hasSelection && !cursorPath}
          title="重命名 (F2)"
        >
          <span className="toolbar-icon">✏</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => openPathBar(paneId)}
          title="转到路径 (Ctrl+L)"
        >
          <span className="toolbar-icon">📍</span>
          <span className="toolbar-label">路径</span>
        </button>
        <button className="toolbar-btn" onClick={() => void refresh(paneId)} title="刷新 (F5)">
          <span className="toolbar-icon">⟳</span>
        </button>
        <button
          className={`toolbar-btn toolbar-fav ${isFavorite ? 'active' : ''}`}
          onClick={handleToggleFavorite}
          disabled={!currentPath}
          title={isFavorite ? '从收藏移除' : '收藏当前目录'}
        >
          <span className="toolbar-icon">{isFavorite ? '★' : '☆'}</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        {VIEW_MODES.map((m) => (
          <button
            key={m.mode}
            className={`toolbar-btn ${viewMode === m.mode ? 'active' : ''}`}
            onClick={() => setViewMode(paneId, m.mode)}
            title={`${m.label}视图`}
          >
            <span className="toolbar-icon">{m.icon}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-divider" />

      {/* P2 v2: 分屏 — 左/右 / 上/下 */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => {
            useLayoutStore.getState().pane.splitPane(paneId, 'horizontal');
          }}
          title="左右分屏 (Ctrl+\\)"
        >
          <span className="toolbar-icon">◫</span>
          <span className="toolbar-label">分屏</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={() => {
            useLayoutStore.getState().pane.splitPane(paneId, 'vertical');
          }}
          title="上下分屏 (Ctrl+Shift+\\)"
        >
          <span className="toolbar-icon">▭</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${showHidden ? 'active' : ''}`}
          onClick={toggleShowHidden}
          title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
        >
          {showHidden ? (
            <span className="toolbar-icon">👁</span>
          ) : (
            <span className="toolbar-icon toolbar-icon-muted">👁‍🗨</span>
          )}
          <span className="toolbar-label">.{showHidden ? '已显' : '隐藏'}</span>
        </button>
        <button
          className={`toolbar-btn ${showExtensions ? 'active' : ''}`}
          onClick={toggleShowExtensions}
          title={showExtensions ? '隐藏扩展名' : '显示扩展名'}
        >
          <span className="toolbar-icon">𝝰</span>
                    <span className="toolbar-label">{showExtensions ? '扩展名:开' : '扩展名:关'}</span>
        </button>
      </div>
      </div>
      {/* 右滚动按钮 */}
      {scrollState.right && (
        <button className="toolbar-scroll-btn toolbar-scroll-right" onClick={() => scrollBy(80)} aria-label="向右滚动">
          ›
        </button>
      )}
    </div>
  );
}

// =================== 辅助函数 ===================

import type { LayoutNode } from '@tabula/bridge';

/** 在布局树中查找 pane 节点 */
function findPaneNode(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const child of node.children) {
    const hit = findPaneNode(child, paneId);
    if (hit) return hit;
  }
  return null;
}
