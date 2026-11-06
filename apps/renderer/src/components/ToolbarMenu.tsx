/** 挂载到窗口顶层的工具栏菜单，支持分级选项、键盘导航和视口定位。 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip } from './Tooltip';
import './ToolbarMenu.css';

interface MenuAction {
  type?: 'action';
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  children?: ToolbarMenuEntry[];
  action?: () => void;
}
export type ToolbarMenuEntry = MenuAction
  | { type: 'separator'; id: string }
  | { type: 'heading'; id: string; label: string };

export function ToolbarMenu({ anchor, label, items, paneId, onClose }: {
  anchor: HTMLButtonElement;
  label: string;
  items: ToolbarMenuEntry[];
  paneId: string;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const returnItemRef = useRef<string | null>(null);
  closeRef.current = onClose;
  const [path, setPath] = useState<string[]>([]);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  let entries = items;
  let title = label;
  for (const id of path) {
    const parent = entries.find((entry): entry is MenuAction => entry.id === id && (!entry.type || entry.type === 'action'));
    if (!parent?.children) break;
    title = parent.label;
    entries = parent.children;
  }
  const pathKey = path.join('/');
  useLayoutEffect(() => {
    const update = () => {
      if (!menuRef.current) return;
      const rect = anchor.getBoundingClientRect();
      const menu = menuRef.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - menu.width, window.innerWidth - menu.width - 8));
      const below = rect.bottom + 6;
      const top = below + menu.height <= window.innerHeight - 8
        ? below : Math.max(8, Math.min(rect.top - menu.height - 6, window.innerHeight - menu.height - 8));
      setPosition({ left, top });
    };
    update();
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const initial = buttons.find((button) => button.dataset.menuId === returnItemRef.current)
      ?? buttons.find((button) => button.dataset.menuId) ?? buttons[0];
    returnItemRef.current = null;
    initial?.focus({ preventScroll: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchor, pathKey]);
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchor.contains(target)) closeRef.current(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside); };
  }, [anchor]);
  const activate = (entry: MenuAction) => {
    if (entry.disabled) return;
    if (entry.children) setPath((previous) => [...previous, entry.id]);
    else { onClose(true); entry.action?.(); }
  };
  const back = () => {
    returnItemRef.current = path[path.length - 1] ?? null;
    setPath((previous) => previous.slice(0, -1));
  };
  return createPortal(
    <div ref={menuRef} className="toolbar-menu" role="menu" aria-label={title} data-pane-id={paneId} data-no-context-menu style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault(); event.stopPropagation(); onClose(true);
        } else if (event.key === 'ArrowLeft' && path.length) {
          event.preventDefault(); event.stopPropagation(); back();
        } else if (event.key === 'ArrowRight') {
          const id = (document.activeElement as HTMLElement)?.dataset.menuId;
          const entry = entries.find((item): item is MenuAction => (!item.type || item.type === 'action') && item.id === id);
          if (entry?.children) { event.preventDefault(); event.stopPropagation(); activate(entry); }
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); buttons[index]?.click();
        }
      }}>
      {path.length > 0 && <>
        <button className="toolbar-menu-item toolbar-menu-back" role="menuitem" onClick={back}><ChevronLeft size={16} /><span>{title}</span></button>
        <div className="toolbar-menu-separator" role="separator" />
      </>}
      {entries.map((entry) => entry.type === 'separator'
        ? <div key={entry.id} className="toolbar-menu-separator" role="separator" />
        : entry.type === 'heading'
          ? <div key={entry.id} className="toolbar-menu-heading">{entry.label}</div>
          : <Tooltip key={entry.id} label={entry.label} shortcut={entry.shortcut ?? '无快捷键'}>
            <button className={`toolbar-menu-item ${entry.danger ? 'danger' : ''}`} role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={entry.checked} aria-haspopup={entry.children ? 'menu' : undefined}
              disabled={entry.disabled} data-menu-id={entry.id} onClick={() => activate(entry)}>
              <span className="toolbar-menu-icon">{entry.checked ? <Check size={15} /> : entry.icon}</span>
              <span className="toolbar-menu-label">{entry.label}</span>
              {entry.shortcut && entry.shortcut !== '无快捷键' && <span className="toolbar-menu-shortcut">{entry.shortcut}</span>}
              {entry.children && <ChevronRight className="toolbar-menu-chevron" size={14} />}
            </button>
          </Tooltip>)}
    </div>, document.body,
  );
}
