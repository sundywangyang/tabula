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
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFileStore } from '../stores/file-store';
import { InputDialog } from './InputDialog';
import type { FsEntry } from '@tabula/bridge';
import './ContextMenu.css';
import { shouldContextMenuReturnNull } from './context-menu-shared';
import { loadReadonlyForPath, subscribeReadonlyCache } from './readonly-cache';
import {
  globalState,
  globalSubscribers,
  setGlobalState,
  hideGlobalMenu,
  registration,
} from './context-menu/state';
import { subscribeTagsCache, addTagForPath, removeTagForPath, loadTagsForPath } from './context-menu/tags';
import { buildMenuItems } from './context-menu/menu-items';
export { buildMenuItems } from './context-menu/menu-items';
export { getCachedTags, setCachedTags, subscribeTagsCache, loadTagsForPath } from './context-menu/tags';

interface ContextMenuProps {
  /** 保留 prop 兼容性,但全局单例模式下被忽略 */
  paneId?: string;
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
    | { mode: 'add' | 'remove'; path: string; existingTags: string[]; }
    | null
  >(null);

  // G011: create-symlink dialog 状态
  const [symlinkDialog, setSymlinkDialog] = useState<
    | { paneId: string; sourcePath: string; defaultName: string; }
    | null
  >(null);

  // 二级菜单状态
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  // 二级菜单位置(portal 模式)— 从父 item 的 getBoundingClientRect 派生
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number; } | null>(null);
  // 父 item refs 字典,onMouseEnter 时读 rect
  const itemRefs = useRef(new Map<number, HTMLDivElement>());

  // 监听 add/remove tag 全局事件
  useEffect(() => {
    const onAdd = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; }>).detail;
      setTagDialog({ mode: 'add', path: detail.path, existingTags: [] });
    };
    const onRemove = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; existingTags: string[]; }>).detail;
      setTagDialog({ mode: 'remove', path: detail.path, existingTags: detail.existingTags });
    };
    const onCreateSymlink = (e: Event) => {
      const detail = (e as CustomEvent<{ paneId: string; sourcePath: string; }>).detail;
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

  // G010: 订阅 readonly 缓存变化 — stat 拉回后菜单需要刷新「锁定/解锁」文案
  useEffect(() => {
    return subscribeReadonlyCache(() => force((n) => n + 1));
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);

  // 第一次 mount 注册全局 listener(只挂一次,全生命周期不卸载)
  useEffect(() => {
    if (registration.active) return;
    registration.active = true;

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
          //   - loadReadonlyForPath 内部会 setCachedReadonly → 通知订阅者 → force re-render
          void loadReadonlyForPath(entryPath);
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

  // 真实尺寸边界保护:store 里 setPos 用了硬编码 menuWidth=220/menuHeight=360 估算;
  // 实际菜单更长时(尤其带二级子菜单)会超出屏幕。useLayoutEffect 在浏览器绘制前测
  // 量 getBoundingClientRect,超界时用 transform 平移修正(不动 store,避免循环渲染)。
  // 必须在所有 early return 之前,否则 hooks 顺序变化 → React 报错。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const PAD = 6;
    let dx = 0;
    let dy = 0;
    if (rect.right > window.innerWidth) {
      dx = window.innerWidth - rect.right - PAD;
    } else if (rect.left < 0) {
      dx = -rect.left + PAD;
    }
    if (rect.bottom > window.innerHeight) {
      dy = window.innerHeight - rect.bottom - PAD;
    } else if (rect.top < 0) {
      dy = -rect.top + PAD;
    }
    if (dx !== 0 || dy !== 0) {
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    } else {
      el.style.transform = '';
    }
  }, [globalState.pos.x, globalState.pos.y]);

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
          <div
            key={index}
            className={hasSub ? 'context-menu-submenu' : ''}
            ref={(el) => {
              if (el) itemRefs.current.set(index, el);
              else itemRefs.current.delete(index);
            }}
            onMouseLeave={() => { if (hasSub) setOpenSubmenu(null); }}
          >
            <button

              className={`context-menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''} ${hasSub ? 'has-submenu' : ''}`}
              onClick={() => {
                if (item.disabled) return;
                if (hasSub) {
                  if (!isOpen) {
                    // 打开时同步测父 item 位置,设给 portal 渲染的二级面板
                    const el = itemRefs.current.get(index);
                    if (el) {
                      const r = el.getBoundingClientRect();
                      setSubmenuPos({ top: r.top - 4, left: r.right });
                    }
                    setOpenSubmenu(index);
                  } else {
                    setOpenSubmenu(null);
                  }
                } else if (item.action) {
                  item.action();
                }
              }}
              disabled={item.disabled}
              onMouseEnter={() => {
                if (!hasSub) return;
                const el = itemRefs.current.get(index);
                if (el) {
                  const r = el.getBoundingClientRect();
                  setSubmenuPos({ top: r.top - 4, left: r.right });
                }
                setOpenSubmenu(index);
              }}
            >
              {item.icon && <span className="context-menu-icon">{item.icon}</span>}
              <span className="context-menu-label">{item.label}</span>
              {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
            </button>

            {/* 二级面板用 portal 渲染到 body 避免被父 overflow 裁切 */}
            {hasSub && isOpen && submenuPos && createPortal(
              <div
                className="submenu-panel"
                style={{ position: 'fixed', top: submenuPos.top, left: submenuPos.left }}
              >
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
              </div>,
              document.body,
            )}
          </div>
        );
      })}
      {dialogs}
    </div>
  );
}
