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
import { InputDialog } from './InputDialog';
import type { FsEntry } from '@tabula/bridge';
import './ContextMenu.css';
import { isReadOnly } from '../utils/permissions';
import { shouldContextMenuReturnNull } from './context-menu-shared';

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
  submenu?: MenuItem[]; // 二级菜单
}

/** G008: 5 个颜色预设 (红/橙/黄/绿/蓝) — 每个加一个带 emoji 的彩色标签 */
const TAG_COLOR_PRESETS: ReadonlyArray<{ color: string; emoji: string; label: string; tag: string }> = [
  { color: 'red',    emoji: '🔴', label: '红色', tag: '🔴红色' },
  { color: 'orange', emoji: '🟠', label: '橙色', tag: '🟠橙色' },
  { color: 'yellow', emoji: '🟡', label: '黄色', tag: '🟡黄色' },
  { color: 'green',  emoji: '🟢', label: '绿色', tag: '🟢绿色' },
  { color: 'blue',   emoji: '🔵', label: '蓝色', tag: '🔵蓝色' },
];

/** G008: 缓存 entry → tags 的内存映射(避免每次右键都打 IPC) */
const tagsCache = new Map<string, string[]>();

/** G010: 缓存 path → 上次读到的 POSIX mode(用于「锁定/解锁」菜单显示状态) */
const readonlyCache = new Map<string, number>();
const tagsCacheListeners = new Set<() => void>();
let tagsCacheLoaded = false;
let tagsCacheLoading: Promise<void> | null = null;

async function ensureTagsCacheLoaded(): Promise<void> {
  if (tagsCacheLoaded) return;
  if (tagsCacheLoading) return tagsCacheLoading;
  tagsCacheLoading = (async () => {
    try {
      // getAllTags 是主进程的导出;渲染端没有,改为逐项读取
      // 渲染端走 window.tabula.tags.get(path) — 缓存机制:右键时拉一次
      // 这里我们不在每次右键前主动拉所有 — ContextMenu 内会按需拉
      tagsCacheLoaded = true;
    } finally {
      tagsCacheLoading = null;
    }
  })();
  return tagsCacheLoading;
}

/** 取某路径当前的 tags(从缓存;无则返回空) */
export function getCachedTags(path: string): string[] {
  return tagsCache.get(path) ?? [];
}

/** 设置某路径的 tags(主进程返回后调用) */
export function setCachedTags(path: string, tags: string[]): void {
  tagsCache.set(path, tags);
  tagsCacheListeners.forEach((fn) => fn());
}

/** 订阅 tags 变化(ContextMenu 在打开时刷新会用到) */
export function subscribeTagsCache(fn: () => void): () => void {
  tagsCacheListeners.add(fn);
  return () => tagsCacheListeners.delete(fn);
}

/** 给路径添加 tag(IPC + 写缓存) */
async function addTagForPath(path: string, tag: string): Promise<void> {
  await window.tabula.tags.add(path, tag);
  const cur = tagsCache.get(path) ?? [];
  if (!cur.includes(tag)) {
    tagsCache.set(path, [...cur, tag]);
    tagsCacheListeners.forEach((fn) => fn());
  }
}

/** 给路径移除 tag(IPC + 写缓存) */
async function removeTagForPath(path: string, tag: string): Promise<void> {
  await window.tabula.tags.remove(path, tag);
  const cur = tagsCache.get(path) ?? [];
  tagsCache.set(path, cur.filter((t) => t !== tag));
  tagsCacheListeners.forEach((fn) => fn());
}

/** 主进程拉一次 path 的 tags(并写缓存) */
export async function loadTagsForPath(path: string): Promise<string[]> {
  const tags = await window.tabula.tags.get(path);
  tagsCache.set(path, tags);
  return tags;
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
    // G002: 空右键菜单也提供反选
    items.push({
      label: '反选',
      icon: '⇄',
      shortcut: 'Ctrl+Shift+I',
      action: () => { actions.selectInvert(paneId); hideGlobalMenu(); },
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

    // G002: 反选 — 在「复制路径」组,与选择相关动作放一起
    items.push({
      label: '反选',
      icon: '⇄',
      shortcut: 'Ctrl+Shift+I',
      action: () => { actions.selectInvert(paneId); hideGlobalMenu(); },
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

    // G013: 批量重命名 — 仅当选中 2+ 项时显示
    if (selectedPaths.size >= 2) {
      items.push({
        label: '批量重命名',
        icon: '📝',
        action: () => {
          // 复用命令派发(同时支持命令面板 / 快捷键 / 右键菜单)
          void import('../command-dispatcher').then((m) =>
            m.runCommandById('file.batch-rename'),
          );
          hideGlobalMenu();
        },
      });
    }

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

    // P3 + G016: 计算文件夹大小（仅文件夹）。G016 后改为后台异步,
    // invoke 立即返回 jobId,后续通过 onDirSizeProgress 收进度。
    if (targetEntry?.isDirectory) {
      items.push({
        label: '计算文件夹大小',
        icon: '📊',
        action: () => {
          if (targetEntry) {
            const path = targetEntry.path;
            const toastId = actions.showToast('正在计算…', 'info', 0);
            void window.tabula.fs.getDirSize(path).then((startRes) => {
              if (!startRes.ok) {
                actions.dismissToast(toastId);
                actions.showToast(`启动失败: ${startRes.error.message}`, 'error', 3000);
                return;
              }
              const { jobId } = startRes.data;
              const unsub = window.tabula.fs.onDirSizeProgress((p) => {
                if (p.jobId !== jobId) return;
                if (p.done) {
                  actions.dismissToast(toastId);
                  unsub();
                  if (p.cancelled) {
                    actions.showToast('已取消', 'info', 1500);
                  } else if (p.error) {
                    actions.showToast(`计算失败: ${p.error}`, 'error', 3000);
                  } else {
                    actions.showToast(
                      `大小: ${formatSize(p.totalBytes)} · 文件: ${p.processedEntries}`,
                      'success',
                      3000,
                    );
                  }
                }
                // 中间进度点(每 100 个文件一次)不弹 toast,只显示「计算中…」
              });
            });
          }
          hideGlobalMenu();
        },
      });
    }

    // G008: 标签 → 二级子菜单
    {
      const entryPath = targetEntry!.path;
      const existingTags = getCachedTags(entryPath);

      // 二级菜单内容: 添加 + 颜色预设 + 已有标签移除
      const tagSubmenu: MenuItem[] = [];

      // 「添加标签...」→ 弹 InputDialog
      tagSubmenu.push({
        label: '添加标签...',
        icon: '🏷',
        action: () => {
          window.dispatchEvent(
            new CustomEvent('tabula:add-tag', { detail: { path: entryPath } }),
          );
          hideGlobalMenu();
        },
      });

      // 颜色预设（已有颜色标签的显示 ✖ 移除，未有的显示添加）
      for (const preset of TAG_COLOR_PRESETS) {
        const alreadyTagged = existingTags.includes(preset.tag);
        tagSubmenu.push({
          label: alreadyTagged ? `移除 ${preset.tag}` : `标记为 ${preset.label}`,
          icon: alreadyTagged ? '✖' : preset.emoji,
          action: () => {
            if (alreadyTagged) {
              void removeTagForPath(entryPath, preset.tag);
              actions.showToast(`已移除标签: ${preset.tag}`, 'success', 1500);
            } else {
              void addTagForPath(entryPath, preset.tag);
              actions.showToast(`已添加标签: ${preset.tag}`, 'success', 1500);
            }
            hideGlobalMenu();
          },
        });
      }

      // 已有标签（非颜色预设的标签）
      const nonPresetTags = existingTags.filter(
        (t) => !TAG_COLOR_PRESETS.some((p) => p.tag === t),
      );
      if (nonPresetTags.length > 0) {
        tagSubmenu.push({ label: '', divider: true });
        for (const tag of nonPresetTags) {
          tagSubmenu.push({
            label: `移除 ${tag}`,
            icon: '✖',
            action: () => {
              void removeTagForPath(entryPath, tag);
              actions.showToast(`已移除标签: ${tag}`, 'success', 1500);
              hideGlobalMenu();
            },
          });
        }
      }

      items.push({
        label: '标签',
        icon: '🏷',
        submenu: tagSubmenu,
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
    // Archive: 压缩 / 解压 → 二级子菜单
    // - 选中文件 / 文件夹 → 显示「压缩为 ZIP...」
    // - 选中包含至少一个 .zip → 显示「解压到...」「解压到此处」
    if (hasSelection) {
      const archiveSubmenu: MenuItem[] = [];

      archiveSubmenu.push({
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
        archiveSubmenu.push({
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

        // 解压到此处:直接把 .zip 解压到当前目录(currentPath),无需选择目标
        const extractHereZipPath = Array.from(selectedPaths).find((p) => /\.zip(x)?$/i.test(p));
        if (extractHereZipPath && currentPath) {
          archiveSubmenu.push({
            label: '解压到此处',
            icon: '📂',
            action: () => {
              void useFileStore.getState().startExtract(extractHereZipPath, currentPath, paneId);
              hideGlobalMenu();
            },
          });
        }
      }

      items.push({
        label: '压缩/解压',
        icon: '🗜',
        submenu: archiveSubmenu,
      });
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

    // G011: 创建快捷方式 (symlink / junction) — 仅单选
    {
      const singlePath = targetEntry?.path ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
      items.push({
        label: '创建快捷方式',
        icon: '🔗',
        disabled: !singlePath,
        action: () => {
          if (singlePath) {
            window.dispatchEvent(
              new CustomEvent('tabula:create-symlink', { detail: { paneId, sourcePath: singlePath } }),
            );
          }
          hideGlobalMenu();
        },
      });
    }

    items.push({ label: '', divider: true });

    // G010: 锁定 / 解锁 — 通过 FS_SET_PERMISSIONS 切换 read-only 权限位
    // - 锁定:对 owner 取消 w 位 (0o444);Windows:FS ReadOnly bit
    // - 解锁:恢复 0o644
    // - 多选时,按"任一未锁"决定显示「锁定」,否则显示「解锁」;操作应用到所有选中项
    {
      const targetPaths: string[] = [];
      if (selectedPaths.size > 0) {
        targetPaths.push(...selectedPaths);
      } else if (targetEntry) {
        targetPaths.push(targetEntry.path);
      }
      // 异步取第一个目标的当前 read-only 状态作为菜单显示依据
      // 简化策略:第一次打开时为同步读 cache,否则等异步拉一次
      const firstPath = targetPaths[0];
      const cachedMode = readonlyCache.get(firstPath);
      const anyWritable = cachedMode === undefined ? true : !isReadOnly(cachedMode);
      // 用缓存不可知时,不显示等异步,可以乐观选择"锁定"(常见默认是可写)
      items.push({
        label: anyWritable ? '锁定' : '解锁',
        icon: anyWritable ? '🔒' : '🔓',
        disabled: targetPaths.length === 0,
        action: async () => {
          // 取每个 path 的最新 mode,按各自当前状态取反
          // 简化:如果 firstPath 已知是 read-only → 全部解锁;否则 → 全部锁定
          // 为更稳妥,逐个 stat
          let succeeded = 0;
          let failed = 0;
          for (const p of targetPaths) {
            const statRes = await window.tabula.fs.stat(p);
            if (!statRes.ok) {
              failed++;
              continue;
            }
            const currentIsReadonly = isReadOnly(statRes.data.mode);
            const nextReadonly = !currentIsReadonly;
            const r = await window.tabula.fs.setPermissions({ path: p, readonly: nextReadonly });
            if (r.ok) {
              readonlyCache.set(p, nextReadonly ? 0o444 : 0o644);
              succeeded++;
            } else {
              failed++;
            }
          }
          if (failed === 0) {
            actions.showToast(
              `已${anyWritable ? '锁定' : '解锁'} ${succeeded} 项`,
              'success',
              1500,
            );
          } else if (succeeded === 0) {
            actions.showToast(
              `${anyWritable ? '锁定' : '解锁'}失败 (${failed} 项)`,
              'error',
              3000,
            );
          } else {
            actions.showToast(
              `${anyWritable ? '锁定' : '解锁'} ${succeeded} 项,${failed} 项失败`,
              'warn',
              3000,
            );
          }
          hideGlobalMenu();
        },
      });
    }

    items.push({ label: '', divider: true });

    // G015: 计算 SHA-256(仅文件,流式哈希大文件友好)
    if (targetEntry && !targetEntry.isDirectory) {
      items.push({
        label: '计算 SHA-256',
        icon: '#️⃣',
        action: () => {
          if (targetEntry) {
            const p = targetEntry.path;
            const toastId = actions.showToast('正在计算 SHA-256…', 'info', 0);
            void window.tabula.fs.checksum({ path: p, algorithm: 'sha256' }).then((result) => {
              actions.dismissToast(toastId);
              if (result.ok) {
                const { hash } = result.data;
                // 64-char hex 过长不适合 toast;写剪贴板 + 弹带 hash 的简单对话框
                void window.tabula.fs.writeClipboard(hash);
                // 用一个简短的确认 toast,再弹一个原生 alert 显示完整 hash
                actions.showToast('SHA-256 已复制到剪贴板', 'success', 2000);
                // eslint-disable-next-line no-alert
                window.alert(
                  `SHA-256\n${hash}\n\n(已自动复制到剪贴板,可粘贴到校验工具)`,
                );
              } else {
                actions.showToast(`计算失败: ${result.error.message}`, 'error', 3000);
              }
            });
          }
          hideGlobalMenu();
        },
      });
    }

    items.push({
      label: '属性',
      icon: 'ℹ',
      action: () => {
        if (targetEntry) {
          window.dispatchEvent(
            new CustomEvent('tabula:show-properties', {
              detail: { paneId, entry: targetEntry },
            }),
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

  // G008: tag dialog 状态(从全局事件中填)
  const [tagDialog, setTagDialog] = useState<
    | { mode: 'add' | 'remove'; path: string; existingTags: string[] }
    | null
  >(null);

  // G011: create-symlink dialog 状态
  const [symlinkDialog, setSymlinkDialog] = useState<
    | { paneId: string; sourcePath: string; defaultName: string }
    | null
  >(null);

	  // 二级菜单状态
	  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  // 监听 add/remove tag 全局事件
  useEffect(() => {
    const onAdd = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      setTagDialog({ mode: 'add', path: detail.path, existingTags: [] });
    };
    const onRemove = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; existingTags: string[] }>).detail;
      setTagDialog({ mode: 'remove', path: detail.path, existingTags: detail.existingTags });
    };
    const onCreateSymlink = (e: Event) => {
      const detail = (e as CustomEvent<{ paneId: string; sourcePath: string }>).detail;
      const sep = detail.sourcePath.includes('\\') ? '\\' : '/';
      const baseName = detail.sourcePath.substring(detail.sourcePath.lastIndexOf(sep) + 1);
      const defaultName = baseName ? `${baseName} - Shortcut` : 'Shortcut';
      setSymlinkDialog({ paneId: detail.paneId, sourcePath: detail.sourcePath, defaultName });
    };
    window.addEventListener('tabula:add-tag', onAdd);
    window.addEventListener('tabula:remove-tag', onRemove);
    window.addEventListener('tabula:create-symlink', onCreateSymlink);
    return () => {
      window.removeEventListener('tabula:add-tag', onAdd);
      window.removeEventListener('tabula:remove-tag', onRemove);
      window.removeEventListener('tabula:create-symlink', onCreateSymlink);
    };
  }, []);

  // 订阅 tags 缓存变化(右键刷新用)
  useEffect(() => {
    return subscribeTagsCache(() => force((n) => n + 1));
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
          // G008: 右键打开菜单时,拉一次该 entry 的 tags(写入缓存)
          void loadTagsForPath(entryPath);
          // G010: 拉一次该 entry 的 stat(mode)用于「锁定/解锁」菜单显示
          void window.tabula.fs.stat(entryPath).then((res) => {
            if (res.ok) {
              readonlyCache.set(entryPath, res.data.mode);
            }
          });
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
      setOpenSubmenu(null);
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
  // G008 fix: 菜单关闭但 dialog 已开,仍要渲染 InputDialog,否则 hideGlobalMenu 后
  // 与 setTagDialog 一起被批量 setState 抹掉,用户看到「下次右键才弹」的现象。
  if (
    shouldContextMenuReturnNull({
      visible: globalState.visible,
      paneId: globalState.paneId,
      hasTagDialog: tagDialog !== null,
      hasSymlinkDialog: symlinkDialog !== null,
    })
  ) {
    return null;
  }

  const paneId = globalState.paneId;
  const targetEntry = globalState.entry;
  const position = globalState.pos;
  const isEmptySpace = !targetEntry;

  // 从 store 取当前 pane 数据(读一次,菜单打开期间用)
  const paneData = paneId ? useFileStore.getState().panes[paneId] : undefined;
  const selectedPaths = paneData?.selectedPaths ?? new Set<string>();
  const currentPath = paneData?.currentPath ?? '';
  const clipboard = useFileStore.getState().clipboard;

  // action 用 getState 一次取齐(避免 selector 不稳定引用)
  const actions = useFileStore.getState();

  // buildMenuItems 现在是模块级纯函数,直接调用,不依赖 hook 顺序
  // 仅在 paneId 存在时构建菜单项(菜单关闭但 dialog 仍开的情况不应重新构建菜单)
  const menuItems = paneId
    ? buildMenuItems({
        paneId,
        targetEntry,
        isEmptySpace,
        selectedPaths,
        currentPath,
        clipboard,
        actions,
      })
    : [];

  // G008 fix: 当菜单已隐藏但 dialog 仍开,不显示菜单 div 本身(避免悬空的菜单样式),
  // 只渲染 dialog fragment,避免 visibility:hidden 级联到 dialog 蒙层。
  const showMenu = globalState.visible && paneId;

  // dialogs 用一个 fragment 渲染,确保它们不受外层菜单的 visibility 影响
  const dialogs = (
    <>
      {tagDialog && (
        <InputDialog
          open={true}
          title={tagDialog.mode === 'add' ? '添加标签' : '移除标签(输入要移除的完整标签)'}
          placeholder={tagDialog.mode === 'add' ? '输入标签名' : tagDialog.existingTags.join(' / ')}
          defaultValue=""
          okLabel={tagDialog.mode === 'add' ? '添加' : '移除'}
          onSubmit={async (value) => {
            const trimmed = value.trim();
            if (!trimmed) return;
            if (tagDialog.mode === 'add') {
              await addTagForPath(tagDialog.path, trimmed);
              const actions = useFileStore.getState();
              actions.showToast(`已添加标签: ${trimmed}`, 'success', 1500);
            } else {
              if (!tagDialog.existingTags.includes(trimmed)) {
                const actions = useFileStore.getState();
                actions.showToast('该标签不存在', 'warn', 1500);
                setTagDialog(null);
                return;
              }
              await removeTagForPath(tagDialog.path, trimmed);
              const actions = useFileStore.getState();
              actions.showToast(`已移除标签: ${trimmed}`, 'success', 1500);
            }
            setTagDialog(null);
          }}
          onCancel={() => setTagDialog(null)}
        />
      )}
      {symlinkDialog && (
        <InputDialog
          open={true}
          title="创建快捷方式"
          placeholder="链接名称"
          defaultValue={symlinkDialog.defaultName}
          okLabel="创建"
          onSubmit={async (value) => {
            const trimmed = value.trim();
            if (!trimmed) return;
            const sep = symlinkDialog.sourcePath.includes('\\') ? '\\' : '/';
            const parent = symlinkDialog.sourcePath.substring(0, symlinkDialog.sourcePath.lastIndexOf(sep));
            const linkPath = parent + sep + trimmed;
            const actions = useFileStore.getState();
            const result = await window.tabula.fs.createSymlink({
              target: symlinkDialog.sourcePath,
              linkPath,
            });
            if (result.ok) {
              actions.showToast(`已创建快捷方式: ${trimmed}`, 'success', 1500);
              void actions.loadDir(symlinkDialog.paneId, parent);
            } else {
              actions.showToast(`创建失败: ${result.error.message}`, 'error', 3000);
            }
            setSymlinkDialog(null);
          }}
          onCancel={() => setSymlinkDialog(null)}
        />
      )}
    </>
  );

  if (!showMenu) {
    return dialogs;
  }

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
        const hasSub = !!item.submenu?.length;
        const isOpen = openSubmenu === index;
        return (
          <div key={index} className={hasSub ? 'context-menu-submenu' : ''} onMouseLeave={() => { if (hasSub) setOpenSubmenu(null); }}>
            <button
  
              className={`context-menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''} ${hasSub ? 'has-submenu' : ''}`}
              onClick={() => {
                if (item.disabled) return;
                if (hasSub) {
                  setOpenSubmenu(isOpen ? null : index);
                } else if (item.action) {
                  item.action();
                }
              }}
              disabled={item.disabled}
              onMouseEnter={() => { if (hasSub) setOpenSubmenu(index); }}
            >
              {item.icon && <span className="context-menu-icon">{item.icon}</span>}
              <span className="context-menu-label">{item.label}</span>
              {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
            </button>

            {/* 二级面板 */}
            {hasSub && isOpen && (
              <div className="submenu-panel">
{item.submenu!.map((sub, si) => {
                  if (sub.divider) return <div key={si} className="submenu-divider" />;
                  return (
                    <button
                      key={si}
                      className={`context-menu-item ${sub.disabled ? 'disabled' : ''} ${sub.danger ? 'danger' : ''}`}
                      onClick={() => { if (!sub.disabled && sub.action) sub.action(); setOpenSubmenu(null); }}
                      disabled={sub.disabled}
                    >
                      {sub.icon && <span className="context-menu-icon">{sub.icon}</span>}
                      <span className="context-menu-label">{sub.label}</span>
                      {sub.shortcut && <span className="context-menu-shortcut">{sub.shortcut}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {dialogs}
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
