/** Finder 风格窗格工具栏：常用操作直达，其余操作通过菜单访问。 */
import { useState, type ReactNode } from 'react';
import type { FileTypeCategory, LayoutNode } from '@tabula/bridge';
import {
  ArrowDownUp, ArrowLeft, ArrowRight, ArrowUp, Clipboard, Columns2, Copy, Eye,
  FilePlus2, Filter, Folder, FolderPlus, LayoutGrid, LayoutList, Link2, List,
  MapPin, MoreHorizontal, PanelTop, Pencil, Plus, RotateCw, Scissors, Search,
  Star, Terminal, Trash2, Type, Wrench,
} from 'lucide-react';
import { useFileStore, type GroupByMode, type SortField, type ViewMode } from '../stores/file-store';
import { useUiDialogsStore } from '../stores/ui-dialogs-store';
import { useFavoritesStore } from '../stores/favorites-store';
import { useLayoutStore } from '../stores/layout-store';
import { useKeymapStore } from '../stores/keymap-store';
import { getCachedPlatform } from '../platform-cache';
import { shortcutLabel } from '../shortcut-label';
import { parentPath } from '../stores/file/paths';
import { Tooltip } from './Tooltip';
import { ToolbarMenu, type ToolbarMenuEntry } from './ToolbarMenu';
import './Toolbar.css';

const EMPTY_SET = new Set<string>();
const VIEW_MODES: { mode: ViewMode; icon: ReactNode; label: string }[] = [
  { mode: 'details', icon: <LayoutList size={16} />, label: '详情' },
  { mode: 'list', icon: <List size={16} />, label: '列表' },
  { mode: 'grid', icon: <LayoutGrid size={16} />, label: '网格' },
];
const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'name', label: '名称' }, { field: 'size', label: '大小' },
  { field: 'mtime', label: '修改时间' }, { field: 'type', label: '类型' },
];
const GROUPS: { mode: GroupByMode; label: string }[] = [
  { mode: 'none', label: '不分组' }, { mode: 'type', label: '按类型分组' },
  { mode: 'date', label: '按日期分组' }, { mode: 'size', label: '按大小分组' },
];
const FILE_TYPES: { value: FileTypeCategory; label: string }[] = [
  { value: 'all', label: '全部类型' }, { value: 'folder', label: '文件夹' },
  { value: 'image', label: '图片' }, { value: 'document', label: '文档' },
  { value: 'code', label: '代码' }, { value: 'archive', label: '压缩包' },
  { value: 'audio', label: '音频' }, { value: 'video', label: '视频' },
];
type ToolMode = NonNullable<ReturnType<typeof useUiDialogsStore.getState>['toolsDialog']>['mode'];
const FILE_TOOLS: { mode: ToolMode; label: string }[] = [
  { mode: 'content', label: '全文内容搜索' }, { mode: 'duplicates', label: '查找重复文件' },
  { mode: 'history', label: '文件历史时间线' }, { mode: 'network', label: '连接服务器' },
  { mode: 'links', label: '链接管理' }, { mode: 'icons', label: '文件夹图标' },
  { mode: 'associations', label: '默认应用' },
];
type MenuKind = 'new' | 'arrange' | 'more' | 'back' | 'forward';

function findPane(node: LayoutNode, paneId: string): Extract<LayoutNode, { type: 'pane' }> | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  for (const child of node.children) {
    const pane = findPane(child, paneId);
    if (pane) return pane;
  }
  return null;
}

export function Toolbar({ paneId }: { paneId: string }) {
  const bindings = useKeymapStore((s) => s.bindings);
  const viewMode = useFileStore((s) => s.panes[paneId]?.viewMode ?? 'details');
  const groupBy = useFileStore((s) => s.panes[paneId]?.groupBy ?? 'none');
  const fileType = useFileStore((s) => s.panes[paneId]?.fileType ?? 'all');
  const showHidden = useFileStore((s) => s.showHidden);
  const showExtensions = useFileStore((s) => s.showExtensions);
  const searchOpen = useFileStore((s) => s.panes[paneId]?.searchOpen ?? false);
  const currentPath = useFileStore((s) => s.panes[paneId]?.currentPath ?? '');
  const selectedPaths = useFileStore((s) => s.panes[paneId]?.selectedPaths ?? EMPTY_SET);
  const cursorPath = useFileStore((s) => s.panes[paneId]?.cursorPath ?? null);
  const clipboard = useFileStore((s) => s.clipboard);
  const sortBy = useFileStore((s) => s.panes[paneId]?.sortBy ?? s.sortBy);
  const sortDir = useFileStore((s) => s.panes[paneId]?.sortDir !== undefined ? s.panes[paneId].sortDir : s.sortDir);
  const rootLayout = useLayoutStore((s) => s.rootLayout);
  const favorites = useFavoritesStore((s) => s.favorites);
  const pane = findPane(rootLayout, paneId);
  const activeTab = pane?.tabs.find((tab) => tab.id === pane.activeTabId);
  const history = (activeTab?.history ?? []).filter(Boolean);
  const historyIndex = activeTab?.historyIndex ?? -1;
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;
  const parent = /^\\\\[^\\/]+[\\/][^\\/]+[\\/]?$/.test(currentPath) ? '' : parentPath(currentPath);
  const isFavorite = favorites.some((favorite) => favorite.path === currentPath);
  const folderName = currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath || '文件夹';
  const hasSelection = selectedPaths.size > 0;
  const hasClipboard = Boolean(clipboard?.paths.length);
  const [openMenu, setOpenMenu] = useState<{ kind: MenuKind; anchor: HTMLButtonElement } | null>(null);
  const shortcut = (...ids: string[]) => ids.map((id) => shortcutLabel(bindings.get(id), getCachedPlatform())).filter(Boolean).join(' / ') || '无快捷键';
  const file = useFileStore.getState();
  const closeMenu = (restoreFocus = true) => {
    if (restoreFocus && openMenu?.anchor.isConnected) openMenu.anchor.focus({ preventScroll: true });
    setOpenMenu(null);
  };
  const toggleMenu = (kind: MenuKind, anchor: HTMLButtonElement) => {
    useLayoutStore.getState().pane.focusPane(paneId);
    setOpenMenu((previous) => previous?.kind === kind ? null : { kind, anchor });
  };
  const newFolder = () => window.dispatchEvent(new CustomEvent('tabula:new-folder', { detail: { paneId } }));
  const newFile = () => window.dispatchEvent(new CustomEvent('tabula:new-file', { detail: { paneId } }));
  const goBack = () => useLayoutStore.getState().pane.goBack(paneId);
  const goForward = () => useLayoutStore.getState().pane.goForward(paneId);
  const openSearch = () => file.openSearch(paneId);
  const openTools = (mode: ToolMode) => {
    const path = ['content', 'duplicates', 'history', 'network'].includes(mode)
      ? currentPath : selectedPaths.size === 1 ? [...selectedPaths][0] : currentPath;
    useUiDialogsStore.getState().openTools(mode, paneId, path);
  };
  const toggleFavorite = () => {
    const added = useFavoritesStore.getState().toggleFavorite(currentPath);
    file.showToast(added ? `已收藏: ${currentPath}` : '已从收藏移除', 'success', 1500);
  };
  const openTerminal = async () => {
    try {
      const result = await window.tabula.shell.openTerminal(currentPath);
      if (!result.ok) file.showToast(`打开终端失败: ${result.error.message}`, 'error', 2500);
    } catch (error) {
      file.showToast(`打开终端失败: ${String(error)}`, 'error', 2500);
    }
  };
  const copyPath = async () => {
    const paths = hasSelection ? [...selectedPaths] : cursorPath ? [cursorPath] : [];
    try {
      await window.tabula.fs.writeClipboard(paths.join('\n'));
      file.showToast('路径已复制', 'success', 1500);
    } catch (error) {
      file.showToast(`复制路径失败: ${String(error)}`, 'error', 2500);
    }
  };
  const rename = () => {
    if (selectedPaths.size > 1) {
      file.showToast('重命名仅支持单选', 'warn', 1500);
      return;
    }
    const target = cursorPath ?? [...selectedPaths][0];
    if (target) file.beginRename(paneId, target);
  };

  const newItems: ToolbarMenuEntry[] = [
    { id: 'new-folder', label: '新建文件夹', icon: <FolderPlus size={16} />, shortcut: shortcut('file.new-folder', 'file.new-folder-quick'), disabled: !currentPath, action: newFolder },
    { id: 'new-file', label: '新建文件', icon: <FilePlus2 size={16} />, disabled: !currentPath, action: newFile },
  ];
  const viewItems: ToolbarMenuEntry[] = VIEW_MODES.map(({ mode, label, icon }) => ({
    id: `view-${mode}`, label: `${label}视图`, icon, checked: viewMode === mode, action: () => file.setViewMode(paneId, mode),
  }));
  const arrangeItems: ToolbarMenuEntry[] = [
    { type: 'heading', id: 'sort-heading', label: '排序方式 · 再次选择切换方向' },
    ...SORT_FIELDS.map(({ field, label }) => ({
      id: `sort-${field}`, label: `${label}${sortBy === field && sortDir ? sortDir === 'asc' ? ' ↑' : ' ↓' : ''}`,
      checked: sortBy === field && sortDir !== null, action: () => file.cycleSort(field, paneId),
    })),
    { type: 'separator', id: 'group-separator' },
    ...GROUPS.map(({ mode, label }) => ({ id: `group-${mode}`, label, checked: groupBy === mode, action: () => file.setGroupBy(paneId, mode) })),
  ];
  const splitItems: ToolbarMenuEntry[] = [
    { id: 'split-horizontal', label: '左右分屏', icon: <Columns2 size={16} />, shortcut: shortcut('pane.split-horizontal'), action: () => useLayoutStore.getState().pane.splitPane(paneId, 'horizontal') },
    { id: 'split-vertical', label: '上下分屏', icon: <PanelTop size={16} />, shortcut: shortcut('pane.split-vertical'), action: () => useLayoutStore.getState().pane.splitPane(paneId, 'vertical') },
  ];
  const moreItems: ToolbarMenuEntry[] = [
    { id: 'back', label: '后退', icon: <ArrowLeft size={16} />, disabled: !canGoBack, action: goBack },
    { id: 'forward', label: '前进', icon: <ArrowRight size={16} />, disabled: !canGoForward, action: goForward },
    { type: 'separator', id: 'edit-separator' },
    { id: 'copy', label: '复制', icon: <Copy size={16} />, shortcut: shortcut('file.copy'), disabled: !hasSelection, action: () => file.copySelected(paneId) },
    { id: 'cut', label: '剪切', icon: <Scissors size={16} />, shortcut: shortcut('file.cut'), disabled: !hasSelection, action: () => file.cutSelected(paneId) },
    { id: 'paste', label: '粘贴', icon: <Clipboard size={16} />, shortcut: shortcut('file.paste'), disabled: !hasClipboard, action: () => { void file.pasteToPane(paneId); } },
    { id: 'rename', label: '重命名', icon: <Pencil size={16} />, shortcut: shortcut('file.rename'), disabled: !hasSelection && !cursorPath, action: rename },
    { id: 'copy-path', label: '复制路径', icon: <Link2 size={16} />, disabled: !hasSelection && !cursorPath, action: () => { void copyPath(); } },
    { id: 'delete', label: '移到回收站', icon: <Trash2 size={16} />, shortcut: shortcut('file.delete'), disabled: !hasSelection, danger: true, action: () => window.dispatchEvent(new CustomEvent('tabula:confirm-delete', { detail: { paneId, count: selectedPaths.size } })) },
    { type: 'separator', id: 'folder-separator' },
    { id: 'new', label: '新建', icon: <Plus size={16} />, children: newItems },
    { id: 'path', label: '转到路径', icon: <MapPin size={16} />, shortcut: shortcut('file.path-bar'), action: () => file.openPathBar(paneId) },
    { id: 'refresh', label: '刷新', icon: <RotateCw size={16} />, shortcut: shortcut('file.refresh'), disabled: !currentPath, action: () => { void file.refresh(paneId); } },
    { id: 'favorite', label: isFavorite ? '从收藏移除' : '收藏当前目录', icon: <Star size={16} />, checked: isFavorite, disabled: !currentPath, action: toggleFavorite },
    { id: 'terminal', label: '在当前目录打开终端', icon: <Terminal size={16} />, disabled: !currentPath, action: () => { void openTerminal(); } },
    { type: 'separator', id: 'display-separator' },
    { id: 'view', label: '视图', icon: <LayoutList size={16} />, children: viewItems },
    { id: 'arrange', label: '排序与分组', icon: <ArrowDownUp size={16} />, children: arrangeItems },
    { id: 'filter', label: `文件类型：${FILE_TYPES.find((item) => item.value === fileType)?.label ?? '全部类型'}`, icon: <Filter size={16} />, children: FILE_TYPES.map(({ value, label }) => ({ id: `filter-${value}`, label, checked: fileType === value, action: () => file.setFileType(paneId, value) })) },
    { id: 'hidden', label: '显示隐藏文件', icon: <Eye size={16} />, checked: showHidden, action: file.toggleShowHidden },
    { id: 'extensions', label: '显示扩展名', icon: <Type size={16} />, checked: showExtensions, action: file.toggleShowExtensions },
    { id: 'search', label: '搜索当前目录', icon: <Search size={16} />, shortcut: shortcut('search.focus'), action: openSearch },
    { id: 'split', label: '分屏', icon: <Columns2 size={16} />, children: splitItems },
    { id: 'tools', label: '文件工具', icon: <Wrench size={16} />, children: FILE_TOOLS.map(({ mode, label }) => ({ id: `tool-${mode}`, label, disabled: mode !== 'network' && !currentPath, action: () => openTools(mode) })) },
  ];
  const historyItems: ToolbarMenuEntry[] = (openMenu?.kind === 'back'
    ? history.slice(0, historyIndex).reverse()
    : history.slice(historyIndex + 1)).slice(0, 20).map((path, index) => ({
    id: `history-${index}`, label: path, action: () => useLayoutStore.getState().pane.navigate(paneId, path),
  }));
  const menuItems = openMenu?.kind === 'new' ? newItems : openMenu?.kind === 'arrange' ? arrangeItems
    : openMenu?.kind === 'more' ? moreItems : historyItems;
  const menuLabel = openMenu?.kind === 'new' ? '新建' : openMenu?.kind === 'arrange' ? '排序与分组'
    : openMenu?.kind === 'more' ? '更多操作' : '浏览历史';

  return (
    <div className="toolbar" role="toolbar" aria-label="文件夹工具栏" data-no-context-menu onContextMenu={(event) => event.preventDefault()}>
      <div className="toolbar-navigation toolbar-group">
        {([{ direction: 'back', label: '后退', icon: <ArrowLeft size={17} />, enabled: canGoBack, action: goBack },
          { direction: 'forward', label: '前进', icon: <ArrowRight size={17} />, enabled: canGoForward, action: goForward }] as const).map(({ direction, label, icon, enabled, action }) => (
          <Tooltip key={direction} label={`${label}（右键查看历史）`} shortcut="无快捷键">
            <button className="toolbar-btn" aria-label={label} disabled={!enabled} onClick={action} onContextMenu={(event) => { event.preventDefault(); if (enabled) toggleMenu(direction, event.currentTarget); }}>{icon}</button>
          </Tooltip>
        ))}
        <Tooltip label="向上一级" shortcut={shortcut('navigation.parent')}>
          <button className="toolbar-btn" aria-label="向上一级" disabled={!parent}
            onClick={() => { if (parent) void useLayoutStore.getState().pane.navigate(paneId, parent); }}>
            <ArrowUp size={17} />
          </button>
        </Tooltip>
      </div>
      <button className="toolbar-location" title={currentPath || '转到路径'} aria-label={`当前目录：${folderName}，转到路径`} onClick={() => file.openPathBar(paneId)}>
        <Folder size={17} /><span>{folderName}</span>
      </button>
      <div className="toolbar-actions toolbar-group">
        <span className="toolbar-create">
          <Tooltip label="新建文件夹或文件（右键新建文件）" shortcut={shortcut('file.new-folder', 'file.new-folder-quick')}>
            <button className="toolbar-btn" aria-label="新建" aria-haspopup="menu" aria-expanded={openMenu?.kind === 'new'} onClick={(event) => toggleMenu('new', event.currentTarget)} onContextMenu={(event) => { event.preventDefault(); if (currentPath) newFile(); }}><Plus size={18} /></button>
          </Tooltip>
        </span>
        <div className="toolbar-view-switch" role="group" aria-label="视图模式">
          {VIEW_MODES.map(({ mode, icon, label }) => <Tooltip key={mode} label={`${label}视图`}>
            <button className={`toolbar-btn ${viewMode === mode ? 'active' : ''}`} aria-label={`${label}视图`} aria-pressed={viewMode === mode} onClick={() => file.setViewMode(paneId, mode)}>{icon}</button>
          </Tooltip>)}
        </div>
        <span className="toolbar-arrange"><Tooltip label="排序与分组">
          <button className="toolbar-btn" aria-label="排序与分组" aria-haspopup="menu" aria-expanded={openMenu?.kind === 'arrange'} onClick={(event) => toggleMenu('arrange', event.currentTarget)}><ArrowDownUp size={17} /></button>
        </Tooltip></span>
        <span className="toolbar-search"><Tooltip label="搜索当前目录" shortcut={shortcut('search.focus')}>
          <button className={`toolbar-btn ${searchOpen ? 'active' : ''}`} aria-label="搜索当前目录" onClick={openSearch}><Search size={17} /></button>
        </Tooltip></span>
        <span className="toolbar-split"><Tooltip label="左右分屏" shortcut={shortcut('pane.split-horizontal')}>
          <button className="toolbar-btn" aria-label="左右分屏" onClick={() => useLayoutStore.getState().pane.splitPane(paneId, 'horizontal')}><Columns2 size={17} /></button>
        </Tooltip></span>
        <Tooltip label="更多操作">
          <button className={`toolbar-btn toolbar-more ${openMenu?.kind === 'more' ? 'active' : ''}`} aria-label="更多操作" aria-haspopup="menu" aria-expanded={openMenu?.kind === 'more'} onClick={(event) => toggleMenu('more', event.currentTarget)}><MoreHorizontal size={19} /></button>
        </Tooltip>
      </div>
      {openMenu && <ToolbarMenu key={openMenu.kind} anchor={openMenu.anchor} label={menuLabel} items={menuItems} paneId={paneId} onClose={closeMenu} />}
    </div>
  );
}
