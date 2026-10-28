import type { FsEntry } from '@tabula/bridge';
import type { MenuItem } from './types';
import { useFileStore, makeFolderTab } from '../../stores/file-store';
import { useFavoritesStore } from '../../stores/favorites-store';
import { useLayoutStore } from '../../stores/layout-store';
import { isReadOnly } from '../../utils/permissions';
import { getCachedReadonly, resolveLockMenuLabel, setCachedReadonly } from '../readonly-cache';
import { getCachedTags, addTagForPath, removeTagForPath } from './tags';
import { hideGlobalMenu } from './state';

/** G008: 5 个颜色预设 (红/橙/黄/绿/蓝) — 每个加一个带 emoji 的彩色标签 */
const TAG_COLOR_PRESETS: ReadonlyArray<{ color: string; emoji: string; label: string; tag: string; }> = [
  { color: 'red', emoji: '🔴', label: '红色', tag: '🔴红色' },
  { color: 'orange', emoji: '🟠', label: '橙色', tag: '🟠橙色' },
  { color: 'yellow', emoji: '🟡', label: '黄色', tag: '🟡黄色' },
  { color: 'green', emoji: '🟢', label: '绿色', tag: '🟢绿色' },
  { color: 'blue', emoji: '🔵', label: '蓝色', tag: '🔵蓝色' },
];

/** buildMenuItems 提到组件外面:纯函数 + 闭包传参,避免 hooks 顺序问题 */
export function buildMenuItems(args: {
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

    // 1. 打开 (顶层,最常用)
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

    // 2. 文件操作 (二级: 复制/剪切/粘贴)
    items.push({
      label: '文件操作',
      icon: '📁',
      submenu: [
        {
          label: '复制',
          icon: '📋',
          shortcut: 'Ctrl+C',
          disabled: !hasSelection,
          action: () => { actions.copySelected(paneId); hideGlobalMenu(); },
        },
        {
          label: '剪切',
          icon: '✂',
          shortcut: 'Ctrl+X',
          disabled: !hasSelection,
          action: () => { actions.cutSelected(paneId); hideGlobalMenu(); },
        },
        {
          label: '粘贴',
          icon: '📄',
          shortcut: 'Ctrl+V',
          disabled: !clipboard || clipboard.paths.length === 0,
          action: () => { void actions.pasteToPane(paneId); hideGlobalMenu(); },
        },
      ],
    });

    // 3. 打开方式 (二级: 多种打开方式)
    {
      const openSubmenu: MenuItem[] = [];
      if (targetEntry?.isDirectory) {
        openSubmenu.push({
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
        openSubmenu.push({
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
      if (targetEntry) {
        openSubmenu.push({
          label: '在文件资源管理器中打开',
          icon: '📁',
          action: () => {
            if (targetEntry) {
              void window.tabula.fs.showInFolder(targetEntry.path);
            }
            hideGlobalMenu();
          },
        });
      }
      if (targetEntry && !targetEntry.isDirectory) {
        openSubmenu.push({
          label: '打开方式...',
          icon: '⚡',
          action: () => {
            if (targetEntry) {
              void window.tabula.fs.openWithDialog(targetEntry.path);
            }
            hideGlobalMenu();
          },
        });
      }
      if (openSubmenu.length > 0) {
        items.push({
          label: '打开方式',
          icon: '↗',
          submenu: openSubmenu,
        });
      }
    }

    // 4. 编辑 (二级: 重命名 / 批量重命名 / 收藏 / 复制路径 / 复制到当前位置 / 发送到)
    {
      const editSubmenu: MenuItem[] = [];

      editSubmenu.push({
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

      if (selectedPaths.size >= 2) {
        editSubmenu.push({
          label: '批量重命名',
          icon: '📝',
          action: () => {
            void import('../../command-dispatcher').then((m) =>
              m.runCommandById('file.batch-rename'),
            );
            hideGlobalMenu();
          },
        });
      }

      editSubmenu.push({
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

      editSubmenu.push({
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

      editSubmenu.push({
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

      if (targetEntry) {
        editSubmenu.push({
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
      }

      items.push({
        label: '编辑',
        icon: '✏',
        submenu: editSubmenu,
      });
    }

    // 5. 标签 (二级) — 已有逻辑
    {
      const entryPath = targetEntry!.path;
      const existingTags = getCachedTags(entryPath);
      const tagSubmenu: MenuItem[] = [];
      tagSubmenu.push({
        label: '添加标签...',
        icon: '🏷',
        action: () => {
          window.dispatchEvent(new CustomEvent('tabula:add-tag', { detail: { path: entryPath } }));
          hideGlobalMenu();
        },
      });
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

    // 6. 压缩/解压 (二级) — 已有逻辑
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
      for (const format of ['tar', 'tgz'] as const) archiveSubmenu.push({ label: `压缩为 ${format.toUpperCase()}…`, icon: '🗜', action: () => { void useFileStore.getState().startCompress([...selectedPaths], paneId, format); hideGlobalMenu(); } });
      const hasZip = Array.from(selectedPaths).some((p) => /\.(zipx?|tar|tgz|tar\.gz)$/i.test(p));
      if (hasZip && targetEntry && !targetEntry.isDirectory) {
        archiveSubmenu.push({
          label: '解压到…',
          icon: '📦',
          action: () => {
            const zipPath = Array.from(selectedPaths).find((p) => /\.(zipx?|tar|tgz|tar\.gz)$/i.test(p));
            if (zipPath) {
              void useFileStore.getState().startExtract(zipPath, undefined, paneId);
            }
            hideGlobalMenu();
          },
        });
        const extractHereZipPath = Array.from(selectedPaths).find((p) => /\.(zipx?|tar|tgz|tar\.gz)$/i.test(p));
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

    // 7. 计算 (二级: 文件夹大小 / SHA-256)
    {
      const computeSubmenu: MenuItem[] = [];
      if (targetEntry?.isDirectory) {
        computeSubmenu.push({
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
                });
              });
            }
            hideGlobalMenu();
          },
        });
      }
      if (targetEntry && !targetEntry.isDirectory) {
        computeSubmenu.push({
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
                  void window.tabula.fs.writeClipboard(hash);
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
      if (computeSubmenu.length > 0) {
        items.push({
          label: '计算',
          icon: '🧮',
          submenu: computeSubmenu,
        });
      }
    }

    items.push({ label: '', divider: true });

    // 8. G002: 反选 — 与选择相关,留在顶层(高频)
    items.push({
      label: '反选',
      icon: '⇄',
      shortcut: 'Ctrl+Shift+I',
      action: () => { actions.selectInvert(paneId); hideGlobalMenu(); },
    });

    // 9. G010: 锁定/解锁 — 顶层(高频)
    {
      const targetPaths: string[] = [];
      if (selectedPaths.size > 0) {
        targetPaths.push(...selectedPaths);
      } else if (targetEntry) {
        targetPaths.push(targetEntry.path);
      }
      const firstPath = targetPaths[0];
      const cachedMode = firstPath ? getCachedReadonly(firstPath) : undefined;
      const { label, icon } = resolveLockMenuLabel(cachedMode);
      const anyWritable = cachedMode === undefined ? true : !isReadOnly(cachedMode);
      items.push({
        label,
        icon,
        disabled: targetPaths.length === 0,
        action: async () => {
          let succeeded = 0;
          let failed = 0;
          for (const p of targetPaths) {
            const statRes = await window.tabula.fs.stat(p);
            if (!statRes.ok) {
              failed++;
              continue;
            }
            const nextReadonly = anyWritable;
            const r = await window.tabula.fs.setPermissions({ path: p, readonly: nextReadonly });
            if (r.ok) {
              const updated = await window.tabula.fs.stat(p);
              if (updated.ok) setCachedReadonly(p, updated.data.mode);
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

    // 10. 删除 (顶层,高频独立)
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

    // 11. G011: 创建快捷方式 (顶层,独立)
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

    // 12. 属性 (顶层,常驻)
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

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
