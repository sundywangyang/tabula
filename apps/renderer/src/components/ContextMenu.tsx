/**
 * 右键菜单组件 (P3)
 *
 * 在 FileList 空白处右键:粘贴 / 新建文件夹
 * 在文件/文件夹上右键:完整菜单(复制/剪切/粘贴/删除/重命名/属性/打开方式)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useFileStore } from '../stores/file-store';
import { useFavoritesStore } from '../stores/favorites-store';
import type { FsEntry } from '@tabula/bridge';
import './ContextMenu.css';

interface ContextMenuProps {
  paneId: string;
}

interface MenuPosition {
  x: number;
  y: number;
}

interface MenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  action?: () => void;
}

export function ContextMenu({ paneId }: ContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [targetEntry, setTargetEntry] = useState<FsEntry | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // file-store
  const paneData = useFileStore((s) => s.panes[paneId]);
  const selectedPaths = paneData?.selectedPaths ?? new Set<string>();
  const cursorPath = paneData?.cursorPath ?? null;
  const currentPath = paneData?.currentPath ?? '';
  const clipboard = useFileStore((s) => s.clipboard);
  const entries = paneData?.entries ?? [];

  const copySelected = useFileStore((s) => s.copySelected);
  const cutSelected = useFileStore((s) => s.cutSelected);
  const pasteToPane = useFileStore((s) => s.pasteToPane);
  const beginRename = useFileStore((s) => s.beginRename);
  const deleteSelected = useFileStore((s) => s.deleteSelected);
  const showToast = useFileStore((s) => s.showToast);
  const loadDir = useFileStore((s) => s.loadDir);
  const performBulk = useFileStore((s) => s.performBulk);

  // 判断是否在空白处右键
  const isEmptySpace = !targetEntry;

  // 构建菜单项
  const buildMenuItems = useCallback((): MenuItem[] => {
    const items: MenuItem[] = [];

    if (isEmptySpace) {
      // 空白处右键菜单
      const hasClipboard = clipboard !== null && clipboard.paths.length > 0;
      items.push({
        label: '粘贴',
        icon: '📄',
        shortcut: 'Ctrl+V',
        disabled: !hasClipboard,
        action: () => { void pasteToPane(paneId); setVisible(false); },
      });
      items.push({ label: '', divider: true });
      items.push({
        label: '新建文件夹',
        icon: '📁',
        shortcut: 'Ctrl+N',
        action: () => {
          window.dispatchEvent(new CustomEvent('tabula:new-folder', { detail: { paneId } }));
          setVisible(false);
        },
      });
      items.push({
        label: '新建文件',
        icon: '📄',
        action: () => {
          window.dispatchEvent(new CustomEvent('tabula:new-file', { detail: { paneId } }));
          setVisible(false);
        },
      });
      items.push({ label: '', divider: true });
      items.push({
        label: '刷新',
        icon: '⟳',
        shortcut: 'F5',
        action: () => { void loadDir(paneId, currentPath); setVisible(false); },
      });
    } else {
      // 文件/文件夹右键菜单
      const hasSelection = selectedPaths.size > 0 || targetEntry !== null;

      items.push({
        label: '打开',
        icon: '📂',
        action: () => {
          if (targetEntry) {
            if (targetEntry.isDirectory) {
              void loadDir(paneId, targetEntry.path);
            } else {
              void window.tabula.fs.openPath(targetEntry.path);
            }
          }
          setVisible(false);
        },
      });

      if (targetEntry?.isDirectory) {
        items.push({
          label: '在新标签页打开',
          icon: '🏷',
          action: () => {
            // TODO: P2 v2 - open in new tab
            showToast('新标签页打开功能开发中', 'info', 1500);
            setVisible(false);
          },
        });
      }

      items.push({ label: '', divider: true });

      items.push({
        label: '复制',
        icon: '📋',
        shortcut: 'Ctrl+C',
        disabled: !hasSelection,
        action: () => { copySelected(paneId); setVisible(false); },
      });
      items.push({
        label: '剪切',
        icon: '✂',
        shortcut: 'Ctrl+X',
        disabled: !hasSelection,
        action: () => { cutSelected(paneId); setVisible(false); },
      });

      const hasClipboard = clipboard !== null && clipboard.paths.length > 0;
      items.push({
        label: '粘贴',
        icon: '📄',
        shortcut: 'Ctrl+V',
        disabled: !hasClipboard,
        action: () => { void pasteToPane(paneId); setVisible(false); },
      });

      items.push({ label: '', divider: true });

      items.push({
        label: '重命名',
        icon: '✏',
        shortcut: 'F2',
        disabled: selectedPaths.size !== 1 && !targetEntry,
        action: () => {
          if (targetEntry) {
            beginRename(paneId, targetEntry.path);
          }
          setVisible(false);
        },
      });

      // 复制到同级目录
      items.push({
        label: '复制到当前位置',
        icon: '📑',
        shortcut: 'Ctrl+D',
        disabled: selectedPaths.size !== 1 && !targetEntry,
        action: () => {
          const srcPath = targetEntry?.path ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
          if (srcPath && currentPath) {
            const parent = srcPath.substring(0, srcPath.lastIndexOf(srcPath.includes('\\') ? '\\' : '/'));
            if (parent !== currentPath) {
              void performBulk([srcPath], currentPath, 'copy');
            } else {
              showToast('已在当前位置', 'info', 1500);
            }
          }
          setVisible(false);
        },
      });

      // P5: 添加到收藏夹
      items.push({
        label: '添加到收藏夹',
        icon: '★',
        action: () => {
          if (targetEntry) {
            const pathToFav = targetEntry.isDirectory ? targetEntry.path : currentPath;
            if (pathToFav) {
              const { addFavorite, isFavorite } = useFavoritesStore.getState();
              if (isFavorite(pathToFav)) {
                showToast('已在收藏夹中', 'info', 1500);
              } else {
                addFavorite(pathToFav, targetEntry.isDirectory ? targetEntry.name : undefined);
                showToast(`已添加到收藏夹`, 'success', 1500);
              }
            }
          }
          setVisible(false);
        },
      });

      items.push({ label: '', divider: true });

      items.push({
        label: '删除',
        icon: '🗑',
        shortcut: 'Delete',
        danger: true,
        disabled: !hasSelection,
        action: () => {
          if (selectedPaths.size > 0) {
            window.dispatchEvent(
              new CustomEvent('tabula:confirm-delete', {
                detail: { paneId, count: selectedPaths.size },
              }),
            );
          }
          setVisible(false);
        },
      });

      items.push({ label: '', divider: true });

      items.push({
        label: '属性',
        icon: 'ℹ',
        action: () => {
          if (targetEntry) {
            showToast(
              `${targetEntry.name}\n类型: ${targetEntry.isDirectory ? '文件夹' : '文件'}\n大小: ${formatSize(targetEntry.size)}\n修改: ${formatDate(targetEntry.mtime)}`,
              'info',
              4000,
            );
          }
          setVisible(false);
        },
      });
    }

    return items;
  }, [
    isEmptySpace,
    targetEntry,
    selectedPaths,
    clipboard,
    paneId,
    currentPath,
    copySelected,
    cutSelected,
    pasteToPane,
    beginRename,
    deleteSelected,
    showToast,
    loadDir,
    performBulk,
  ]);

  // 监听右键事件
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // 检查是否点击在菜单上
      if (menuRef.current?.contains(e.target as Node)) return;

      const target = e.target as HTMLElement;
      const row = target.closest('[data-entry-path]') as HTMLElement | null;

      if (row) {
        // 点击在文件/文件夹行上
        const entryPath = row.getAttribute('data-entry-path');
        if (entryPath) {
          const entry = entries.find((e) => e.path === entryPath);
          if (entry) {
            setTargetEntry(entry);
            // 如果右键的不是选中项,则选中该项
            if (!selectedPaths.has(entryPath)) {
              useFileStore.getState().selectOne(paneId, entryPath);
            }
          }
        }
      } else {
        // 点击在空白处
        setTargetEntry(null);
      }

      // 计算菜单位置(确保不超出屏幕)
      const menuWidth = 200;
      const menuHeight = 300;
      let x = e.clientX;
      let y = e.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }

      setPosition({ x, y });
      setVisible(true);
      e.preventDefault();
    };

    const handleClick = () => {
      setVisible(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVisible(false);
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [paneId, entries, selectedPaths]);

  if (!visible) return null;

  const menuItems = buildMenuItems();

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {menuItems.map((item, index) => {
        if (item.divider) {
          return <div key={index} className="context-menu-divider" />;
        }
        return (
          <button
            key={index}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''}`}
            onClick={() => {
              if (!item.disabled && item.action) {
                item.action();
              }
            }}
            disabled={item.disabled}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
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
