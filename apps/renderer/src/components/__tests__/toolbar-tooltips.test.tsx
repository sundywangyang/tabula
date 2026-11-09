import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyCombo, LayoutNode, TabulaAPI } from '@tabula/bridge';
import { Toolbar } from '../Toolbar';
import { useFileStore } from '../../stores/file-store';
import { emptyPaneData } from '../../stores/file/pane-data';
import { useFavoritesStore } from '../../stores/favorites-store';
import { useLayoutStore } from '../../stores/layout-store';
import { useKeymapStore } from '../../stores/keymap-store';
import { useUiDialogsStore } from '../../stores/ui-dialogs-store';
import { makeFolderTab } from '../../stores/folder-tab';
import { shortcutLabel } from '../../shortcut-label';

vi.mock('../../platform-cache', () => ({ getCachedPlatform: () => 'windows', getCachedRootPath: () => 'C:\\' }));
const combo = (key: string, options: Partial<KeyCombo> = {}): KeyCombo => ({ key, ctrl: false, shift: false, alt: false, meta: false, ...options });
let root: Root;
let container: HTMLDivElement;
const pane = (id: string): Extract<LayoutNode, { type: 'pane' }> => {
  const tab = makeFolderTab(`C:\\${id}`);
  tab.history = ['C:\\previous', `C:\\${id}`]; tab.historyIndex = 1;
  return { type: 'pane', id, tabs: [tab], activeTabId: tab.id };
};

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.tabula = { config: { set: vi.fn(async () => {}) }, fs: { writeClipboard: vi.fn(async () => {}) } } as unknown as TabulaAPI;
  useFileStore.setState({
    panes: {
      left: { ...emptyPaneData(), currentPath: 'C:\\left', selectedPaths: new Set(['C:\\left\\a.txt']) },
      right: { ...emptyPaneData(), currentPath: 'C:\\right' },
    }, clipboard: null,
  });
  useLayoutStore.setState({
    rootLayout: { type: 'split', id: 'split', dir: 'horizontal', sizes: [50, 50], children: [pane('left'), pane('right')] },
    activePaneId: 'left',
  });
  useFavoritesStore.setState({ favorites: [], history: [] });
  useKeymapStore.setState({ bindings: new Map([
    ['file.copy', combo('c', { ctrl: true })],
    ['file.new-folder', combo('n', { ctrl: true, shift: true })],
    ['file.new-folder-quick', combo('n', { ctrl: true })],
  ]) });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Toolbar paneId="right" />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const button = (label: string) => {
  const result = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`missing button ${label}`);
  return result;
};
const item = (id: string) => {
  const result = document.querySelector<HTMLButtonElement>(`[role="menu"] [data-menu-id="${id}"]`);
  if (!result) throw new Error(`missing menu item ${id}`);
  return result;
};
const click = async (element: HTMLElement) => act(async () => element.click());
const key = async (value: string) => act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));

describe('Finder toolbar', () => {
  it('keeps parent navigation for the targeted pane and disables it at a drive root', async () => {
    expect(button('向上一级').disabled).toBe(false);
    await click(button('向上一级'));
    const layout = useLayoutStore.getState().rootLayout;
    expect(layout.type).toBe('split');
    if (layout.type !== 'split' || layout.children[1].type !== 'pane') throw new Error('missing right pane');
    const right = layout.children[1];
    expect(right.tabs.find((tab) => tab.id === right.activeTabId)?.path).toBe('C:\\');
    await act(async () => useFileStore.setState((state) => ({ panes: { ...state.panes, right: { ...state.panes.right, currentPath: 'C:\\' } } })));
    expect(button('向上一级').disabled).toBe(true);
  });

  it('sorts only the toolbar pane and reflects that pane’s sort state', async () => {
    await click(button('排序与分组'));
    await click(item('sort-size'));
    expect(useFileStore.getState().panes.right.sortBy).toBe('size');
    expect(useFileStore.getState().panes.right.sortDir).toBe('asc');
    expect(useFileStore.getState().panes.left.sortBy).not.toBe('size');
    await click(button('排序与分组'));
    expect(item('sort-size').textContent).toContain('↑');
  });

  it('shows a disabled menu action binding and updates it after rebinding or clearing', async () => {
    await click(button('更多操作'));
    const wrapper = item('copy').parentElement!;
    expect(item('copy').disabled).toBe(true);
    await act(async () => wrapper.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect([...document.querySelectorAll('[role="tooltip"]')].some((el) => el.textContent?.includes('Ctrl+C'))).toBe(true);
    await act(async () => useKeymapStore.setState({ bindings: new Map([['file.copy', combo('k', { alt: true })]]) }));
    expect(item('copy').textContent).toContain('Alt+K');
    await act(async () => useKeymapStore.setState({ bindings: new Map([['file.copy', null]]) }));
    expect([...document.querySelectorAll('[role="tooltip"]')].some((el) => el.textContent?.includes('复制无快捷键'))).toBe(true);
  });

  it('shows both folder shortcuts and preserves the right-click hint', async () => {
    const wrapper = button('新建').parentElement!;
    await act(async () => wrapper.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('右键新建文件');
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Ctrl+Shift+N / Ctrl+N');
  });

  it('dispatches creation to the clicked pane and restores focus', async () => {
    const handler = vi.fn();
    window.addEventListener('tabula:new-file', handler);
    try {
      const anchor = button('新建');
      await click(anchor);
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(document.body.querySelector('[role="menu"]')?.getAttribute('data-pane-id')).toBe('right');
      await click(item('new-file'));
      expect(handler).toHaveBeenCalledOnce();
      expect((handler.mock.calls[0][0] as CustomEvent).detail.paneId).toBe('right');
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(anchor);
    } finally { window.removeEventListener('tabula:new-file', handler); }
  });

  it('targets menu actions at their own pane even when the active pane changes', async () => {
    await act(async () => useFileStore.setState((state) => ({ panes: { ...state.panes, right: { ...state.panes.right, selectedPaths: new Set(['C:\\right\\b.txt']) } } })));
    await click(button('更多操作'));
    await act(async () => useLayoutStore.setState({ activePaneId: 'left' }));
    await click(item('copy'));
    expect(useFileStore.getState().clipboard?.paths).toEqual(['C:\\right\\b.txt']);
    expect(useFileStore.getState().panes.left.selectedPaths.size).toBe(1);
  });

  it('navigates menus with Home, End, arrows and Enter while skipping disabled entries', async () => {
    const anchor = button('更多操作');
    await click(anchor);
    expect(document.activeElement).toBe(item('back'));
    await key('ArrowDown');
    expect(document.activeElement).toBe(item('new'));
    await key('ArrowRight');
    expect(document.body.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('新建');
    await key('End');
    expect(document.activeElement).toBe(item('new-file'));
    await key('ArrowLeft');
    await key('End');
    expect(document.activeElement).toBe(item('tools'));
    await key('Home');
    expect(document.activeElement).toBe(item('back'));
    await key('Escape');
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('keeps all view/filter/tool operations reachable through More', async () => {
    await click(button('更多操作'));
    await click(item('view'));
    await click(item('view-grid'));
    expect(useFileStore.getState().panes.right.viewMode).toBe('grid');
    expect(useFileStore.getState().panes.left.viewMode).toBe('details');
    await click(button('更多操作'));
    await click(item('filter'));
    await click(item('filter-image'));
    expect(useFileStore.getState().panes.right.fileType).toBe('image');
    await click(button('更多操作'));
    await click(item('tools'));
    await click(item('tool-duplicates'));
    expect(useUiDialogsStore.getState().toolsDialog).toEqual({ mode: 'duplicates', paneId: 'right', path: 'C:\\right' });
  });

  it('updates navigation buttons when the active tab history changes', async () => {
    expect(button('后退').disabled).toBe(false);
    expect(button('前进').disabled).toBe(true);
    await click(button('后退'));
    expect(button('后退').disabled).toBe(true);
    expect(button('前进').disabled).toBe(false);
  });

  it('keeps the menu inside viewport bounds and closes on outside click or Tab', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('toolbar-menu')
        ? { x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 500, width: 300, height: 500, toJSON() {} }
        : { x: 990, y: 740, left: 990, top: 740, right: 1018, bottom: 768, width: 28, height: 28, toJSON() {} };
    });
    await click(button('更多操作'));
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(parseFloat(menu.style.left) + 300).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(parseFloat(menu.style.top) + 500).toBeLessThanOrEqual(window.innerHeight - 8);
    await key('Tab');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await click(button('更多操作'));
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('formats modifiers and special keys consistently with shortcut handling', () => {
    expect(shortcutLabel(combo('arrowleft', { alt: true }), 'windows')).toBe('Alt+←');
    expect(shortcutLabel(combo('c', { ctrl: true }), 'macos')).toBe('Cmd+C');
    expect(shortcutLabel(combo('c', { ctrl: true, meta: true }), 'macos')).toBe('Ctrl+Cmd+C');
    expect(shortcutLabel(null, 'windows')).toBeNull();
  });
});
