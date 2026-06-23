/**
 * 右键菜单组件 (P3)
 *
 * 设计:全局单例。
 * - 监听 window contextmenu 事件
 * - 从 e.target 反推 paneId(closest('[data-pane-id]'))和 entryPath(closest('[data-entry-path]'))
 * - 这样即便有 split pane / 多 pane 树,也只挂一个 listener,只显示一个菜单
 *
 * 行为:
 * - 在 FileList 空白处右键:粘贴 / 新建文件夹
 * - 在文件/文件夹上右键:完整菜单(复制/剪切/粘贴/删除/重命名/属性/打开方式)
 */
import { useEffect, useRef, useState } from 'react';
import { useFileStore, makeFolderTab } from '../stores/file-store';
import { useFavoritesStore } from '../stores/favorites-store';
import { useLayoutStore } from '../stores/layout-store';
import type { FsEntry } from '@tabula/bridge';
import './ContextMenu.css';

/** 全局单例:模块级 state,所有 ContextMenu 实例共享 */
interface GlobalState {
  paneId: string | null;
  entry: FsEntry | null;
  visible: boolean;
  pos: { x: number; y: number };
}

let globalState: GlobalState = {
  paneId: null,
  entry: null,
  visible: false,
  pos: { x: 0, y: 0 },
};

let globalRegistered = false;
const globalSubscribers = new Set<() => void>();

function setGlobalState(next: GlobalState) {
  globalState = next;
  globalSubscribers.forEach((fn) => fn());
}

function hideGlobalMenu() {
  if (!globalState.visible) return;
  setGlobalState({ ...globalState, visible: false });
}

interface ContextMenuProps {
  /** 保留 prop 兼容性,但全局单例模式下被忽略 */
  paneId?: string;
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

/** buildMenuItems 提到组件外面:纯函数 + 闭包传参,避免 hooks 顺序问题 */
function buildMenuItems(args: {
  paneId: string;
  targetEntry: FsEntry | null;
  isEmptySpace: boolean;
  selectedPaths: Set<string>;
  currentPath: string;
  clipboard: ReturnType<typeof useFileStore.getState>['clipboard'];
  actions: ReturnType<typeof useFileStore.getState>;
}): MenuItem[] {
  const { paneId, targetEntry, isEmptySpace, selectedPaths, currentPath, clipboard, actions } = args;
  const items: MenuItem[] = [];

  if (isEmptySpace) {
    const hasClipboard = clipboard !== null && clipboard.paths.length > 0;
    items.push({
      label: '粘贴',
      icon: '📄',
      shortcut: 'Ctrl+V',
      disabled: !hasClipboard,
      action: () => { void actions.pasteToPane(paneId); hideGlobalMenu(); },
    });
    items.push({ label: '', divider: true });
    items.push({
      label: '新建文件夹',
      icon: '📁',
      shortcut: 'Ctrl+N',
      action: () => {
        window.dispatchEvent(new CustomEvent('tabula:new-folder', { detail: { paneId } }));
        hideGlobalMenu();
      },
    });
    items.push({
      label: '新建文件',
      icon: '📄',
      action: () => {
        window.dispatchEvent(new CustomEvent('tabula:new-file', { detail: { paneId } }));
        hideGlobalMenu();
      },
    });
    items.push({ label: '', divider: true });
    items.push({
      label: '刷新',
      icon: '⟳',
      shortcut: 'F5',
      action: () => { void actions.loadDir(paneId, currentPath); hideGlobalMenu(); },
    });
  } else {
    const hasSelection = selectedPaths.size > 0 || targetEntry !== null;

    items.push({
      label: '打开',
      icon: '📂',
      action: () => {
        if (targetEntry) {
          if (targetEntry.isDirectory) {
            void actions.loadDir(paneId, targetEntry.path);
          } else {
            void window.tabula.fs.openPath(targetEntry.path);
          }
        }
        hideGlobalMenu();
      },
    });

    if (targetEntry?.isDirectory) {
      items.push({
        label: '在新标签页打开',
        icon: '🏷',
        action: () => {
          if (targetEntry) {
            const newTab = makeFolderTab(targetEntry.path, targetEntry.name);
            useLayoutStore.getState().pane.openTab(paneId, newTab);
          }
          hideGlobalMenu();
        },
      });
    }

    items.push({ label: '', divider: true });

    items.push({
      label: '复制',
      icon: '📋',
      shortcut: 'Ctrl+C',
      disabled: !hasSelection,
      action: () => { actions.copySelected(paneId); hideGlobalMenu(); },
    });
    items.push({
      label: '剪切',
      icon: '✂',
      shortcut: 'Ctrl+X',
      disabled: !hasSelection,
      action: () => { actions.cutSelected(paneId); hideGlobalMenu(); },
    });

    const hasClipboard = clipboard !== null && clipboard.paths.length > 0;
    items.push({
      label: '粘贴',
      icon: '📄',
      shortcut: 'Ctrl+V',
      disabled: !hasClipboard,
      action: () => { void actions.pasteToPane(paneId); hideGlobalMenu(); },
    });

    items.push({ label: '', divider: true });

    // P3: 复制路径
    items.push({
      label: '复制路径',
      icon: '🔗',
      disabled: !hasSelection && !targetEntry,
      action: async () => {
        const paths: string[] = [];
        if (targetEntry) {
          paths.push(targetEntry.path);
        } else if (selectedPaths.size > 0) {
          paths.push(...selectedPaths);
        }
        if (paths.length > 0) {
          await window.tabula.fs.writeClipboard(paths.join('\n'));
          actions.showToast('路径已复制', 'success', 1500);
        }
        hideGlobalMenu();
      },
    });

    // P3: 在资源管理器中打开
    items.push({
      label: '在文件资源管理器中打开',
      icon: '📁',
      disabled: !targetEntry,
      action: () => {
        if (targetEntry) {
          void window.tabula.fs.showInFolder(targetEntry.path);
        }
        hideGlobalMenu();
      },
    });

    // P3: 在新窗口中打开（仅文件夹）
    if (targetEntry?.isDirectory) {
      items.push({
        label: '在新窗口中打开',
        icon: '🪟',
        action: () => {
          if (targetEntry) {
            void window.tabula.windows.open(targetEntry.path);
          }
          hideGlobalMenu();
        },
      });
    }

    items.push({ label: '', divider: true });

    items.push({
      label: '重命名',
      icon: '✏',
      shortcut: 'F2',
      disabled: selectedPaths.size !== 1 && !targetEntry,
      action: () => {
        if (targetEntry) {
          actions.beginRename(paneId, targetEntry.path);
        }
        hideGlobalMenu();
      },
    });

    items.push({
      label: '复制到当前位置',
      icon: '📑',
      shortcut: 'Ctrl+D',
      disabled: selectedPaths.size !== 1 && !targetEntry,
      action: () => {
        const srcPath = targetEntry?.path ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
        if (srcPath && currentPath) {
          const sep = srcPath.includes('\\') ? '\\' : '/';
          const parent = srcPath.substring(0, srcPath.lastIndexOf(sep));
          if (parent !== currentPath) {
            void actions.performBulk([srcPath], currentPath, 'copy', paneId);
          } else {
            actions.showToast('已在当前位置', 'info', 1500);
          }
        }
        hideGlobalMenu();
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
              actions.showToast('已在收藏夹中', 'info', 1500);
            } else {
              addFavorite(pathToFav, targetEntry.isDirectory ? targetEntry.name : undefined);
              actions.showToast(`已添加到收藏夹`, 'success', 1500);
            }
          }
        }
        hideGlobalMenu();
      },
    });

    // P3: 计算文件夹大小（仅文件夹）
    if (targetEntry?.isDirectory) {
      items.push({
        label: '计算文件夹大小',
        icon: '📊',
        action: () => {
          if (targetEntry) {
            const toastId = actions.showToast('正在计算…', 'info', 0);
            void window.tabula.fs.getDirSize(targetEntry.path).then((result) => {
              actions.dismissToast(toastId);
              if (result.ok) {
                const { size, fileCount, dirCount } = result.data;
                actions.showToast(`大小: ${formatSize(size)} · 文件: ${fileCount} · 目录: ${dirCount}`, 'success', 3000);
              } else {
                actions.showToast(`计算失败: ${result.error.message}`, 'error', 3000);
              }
            });
          }
          hideGlobalMenu();
        },
      });
    }

    // P3: 发送到...
    items.push({
      label: '发送到...',
      icon: '📨',
      disabled: !hasSelection && !targetEntry,
      action: async () => {
        const srcPath = targetEntry?.path ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
        if (!srcPath) {
          hideGlobalMenu();
          return;
        }
        const targetDir = await window.tabula.fs.pickDirectory();
        if (targetDir) {
          const srcPaths = selectedPaths.size > 0 ? Array.from(selectedPaths) : [srcPath];
          // 检查源和目标是否相同
          const srcDir = srcPath.substring(0, srcPath.lastIndexOf(srcPath.includes('\\') ? '\\' : '/'));
          if (srcDir === targetDir) {
            actions.showToast('已在目标位置', 'info', 1500);
          } else {
            void actions.performBulk(srcPaths, targetDir, 'copy', paneId);
          }
        }
        hideGlobalMenu();
      },
    });

    // P3: 打开方式（仅文件）
    if (targetEntry && !targetEntry.isDirectory) {
      items.push({
        label: '打开方式',
        icon: '⚡',
        action: () => {
          if (targetEntry) {
            void window.tabula.fs.openWithDialog(targetEntry.path);
          }
          hideGlobalMenu();
        },
      });
    }

    // Archive: 压缩 / 解压
    // - 选中文件 / 文件夹 → 显示「压缩为 ZIP...」
    // - 选中单个 .zip 文件 → 显示「解压到...」(合并单选 / 多选,多选时取第一个 .zip)
    if (hasSelection) {
      items.push({
        label: '压缩为 ZIP…',
        icon: '🗜',
        action: () => {
          if (selectedPaths.size > 0) {
            void useFileStore.getState().startCompress(Array.from(selectedPaths), paneId);
          }
          hideGlobalMenu();
        },
      });

      // 解压:仅当选中里包含至少一个 .zip 才显示
      const hasZip = Array.from(selectedPaths).some((p) => /\.zip(x)?$/i.test(p));
      if (hasZip && targetEntry && !targetEntry.isDirectory) {
        items.push({
          label: '解压到…',
          icon: '📦',
          action: () => {
            const zipPath = Array.from(selectedPaths).find((p) => /\.zip(x)?$/i.test(p));
            if (zipPath) {
              void useFileStore.getState().startExtract(zipPath, undefined, paneId);
            }
            hideGlobalMenu();
          },
        });
      }
    }

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
        hideGlobalMenu();
      },
    });

    items.push({ label: '', divider: true });

    items.push({
      label: '属性',
      icon: 'ℹ',
      action: () => {
        if (targetEntry) {
          actions.showToast(
            `${targetEntry.name}\n类型: ${targetEntry.isDirectory ? '文件夹' : '文件'}\n大小: ${formatSize(targetEntry.size)}\n修改: ${formatDate(targetEntry.mtime)}`,
            'info',
            4000,
          );
        }
        hideGlobalMenu();
      },
    });
  }

  return items;
}

export function ContextMenu(_props: ContextMenuProps = {}) {
  // 订阅全局单例状态
  const [, force] = useState(0);
  useEffect(() => {
    const sub = () => force((n) => n + 1);
    globalSubscribers.add(sub);
    return () => {
      globalSubscribers.delete(sub);
    };
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);

  // 第一次 mount 注册全局 listener(只挂一次,全生命周期不卸载)
  useEffect(() => {
    if (globalRegistered) return;
    globalRegistered = true;

    const onContextMenu = (e: MouseEvent) => {
      // 点在菜单上 → 让菜单自己处理
      if (menuRef.current?.contains(e.target as Node)) return;

      const target = e.target as HTMLElement;

      // 黑名单:chrome 区域(tabs/breadcrumb/toolbar/状态栏/侧边栏等)不弹菜单
      if (target.closest('[data-no-context-menu]')) {
        return;
      }

      const paneEl = target.closest('[data-pane-id]') as HTMLElement | null;
      const rowEl = target.closest('[data-entry-path]') as HTMLElement | null;

      if (!paneEl) {
        // 不在任何 pane 内(标题栏、状态栏、侧边栏、tab 栏等)→ 不弹菜单
        hideGlobalMenu();
        return;
      }

      const pickedPaneId = paneEl.getAttribute('data-pane-id') ?? null;
      let entry: FsEntry | null = null;

      if (rowEl && pickedPaneId) {
        const entryPath = rowEl.getAttribute('data-entry-path') ?? '';
        const paneData = useFileStore.getState().panes[pickedPaneId];
        const entries = paneData?.entries ?? [];
        const found = entries.find((x) => x.path === entryPath);
        if (found) {
          entry = found;
          const sel = paneData?.selectedPaths;
          if (!sel || !sel.has(entryPath)) {
            useFileStore.getState().selectOne(pickedPaneId, entryPath);
          }
        }
      }

      // 屏幕边界保护
      const menuWidth = 220;
      const menuHeight = 360;
      let x = e.clientX;
      let y = e.clientY;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

      setGlobalState({
        paneId: pickedPaneId,
        entry,
        visible: true,
        pos: { x, y },
      });
      e.preventDefault();
    };

    const onClick = () => hideGlobalMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideGlobalMenu();
    };

    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
  }, []);

  // early return 必须放在所有 hooks 之后,否则 hooks 顺序会被破坏
  if (!globalState.visible || !globalState.paneId) return null;

  const paneId = globalState.paneId;
  const targetEntry = globalState.entry;
  const position = globalState.pos;
  const isEmptySpace = !targetEntry;

  // 从 store 取当前 pane 数据(读一次,菜单打开期间用)
  const paneData = useFileStore.getState().panes[paneId];
  const selectedPaths = paneData?.selectedPaths ?? new Set<string>();
  const currentPath = paneData?.currentPath ?? '';
  const clipboard = useFileStore.getState().clipboard;

  // action 用 getState 一次取齐(避免 selector 不稳定引用)
  const actions = useFileStore.getState();

  // buildMenuItems 现在是模块级纯函数,直接调用,不依赖 hook 顺序
  const menuItems = buildMenuItems({
    paneId,
    targetEntry,
    isEmptySpace,
    selectedPaths,
    currentPath,
    clipboard,
    actions,
  });

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
  if (!ms) return '-';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
