import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyCombo } from '@tabula/bridge';
import { findShortcutCommand, handleShortcutKeyDown } from '../../keyboard-shortcuts';
import { closeCommandPalette, isCommandPaletteOpen } from '../../features/command-palette/CommandPalette';
import { useFileStore } from '../file-store';
import { useKeymapStore } from '../keymap-store';
import { useUiDialogsStore } from '../ui-dialogs-store';
import { entry, seedFiles } from './file-fixtures';

const combo = (key: string, overrides: Partial<KeyCombo> = {}): KeyCombo => ({ key, ctrl: false, alt: false, shift: false, meta: false, ...overrides });
let mock: Awaited<ReturnType<typeof seedFiles>>;
let target: HTMLDivElement;

function press(key: string, modifiers: KeyboardEventInit = {}, element: HTMLElement = target) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  element.dispatchEvent(event);
  return event;
}

beforeEach(async () => {
  vi.useFakeTimers();
  mock = await seedFiles();
  useUiDialogsStore.setState(useUiDialogsStore.getInitialState(), true);
  useKeymapStore.setState({ bindings: new Map(), hydrated: true });
  closeCommandPalette();
  await useFileStore.getState().loadDir('p', 'C:\\initial');
  useFileStore.getState().selectOne('p', 'C:\\initial\\a.txt');
  target = document.createElement('div');
  document.body.append(target);
  window.addEventListener('keydown', handleShortcutKeyDown, true);
});

afterEach(() => {
  window.removeEventListener('keydown', handleShortcutKeyDown, true);
  target.remove(); closeCommandPalette();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('configured keyboard dispatch', () => {
  it('rebinds copy and stops the old default from firing', () => {
    useKeymapStore.setState({ bindings: new Map([['file.copy', combo('c', { ctrl: true, alt: true })]]) });
    press('c', { ctrlKey: true });
    expect(useFileStore.getState().clipboard).toBeNull();
    const local = vi.fn(); target.addEventListener('keydown', local);
    press('c', { ctrlKey: true, altKey: true });
    expect(useFileStore.getState().clipboard?.paths).toEqual(['C:\\initial\\a.txt']);
    expect(local).not.toHaveBeenCalled();
    expect(useFileStore.getState().toasts.filter((toast) => toast.message.startsWith('已复制'))).toHaveLength(1);
  });

  it('unbinding Delete leaves the confirmation dialog closed', () => {
    useKeymapStore.setState({ bindings: new Map([['file.delete', null]]) });
    press('Delete');
    expect(useUiDialogsStore.getState().confirmDeleteOpen).toBe(false);
    useKeymapStore.setState({ bindings: new Map([['file.delete', combo('delete')]]) });
    press('Delete');
    expect(useUiDialogsStore.getState().confirmDeleteOpen).toBe(true);
  });

  it('routes Ctrl+A through the single global listener', () => {
    const file = useFileStore.getState();
    useFileStore.setState({ panes: { p: { ...file.panes.p, entries: [entry('C:\\initial\\a.txt'), entry('C:\\initial\\b.txt')] } } });
    useKeymapStore.setState({ bindings: new Map([['file.select-all', combo('a', { ctrl: true })]]) });
    press('a', { ctrlKey: true });
    expect(useFileStore.getState().panes.p.selectedPaths.size).toBe(2);
  });

  it('opens and closes preview once per Space event using the real dispatcher', () => {
    useKeymapStore.setState({ bindings: new Map([['preview.toggle', combo('space')]]) });
    press(' ');
    expect(useFileStore.getState().previewState?.entry.path).toBe('C:\\initial\\a.txt');
    press(' ');
    expect(useFileStore.getState().previewState).toBeNull();
  });

  it('custom preview bindings replace the original Space binding', () => {
    useKeymapStore.setState({ bindings: new Map([['preview.toggle', combo('q', { ctrl: true })]]) });
    press(' ');
    expect(useFileStore.getState().previewState).toBeNull();
    press('q', { ctrlKey: true });
    expect(useFileStore.getState().previewState).not.toBeNull();
    press('Escape');
    expect(useFileStore.getState().previewState).toBeNull();
  });

  it('does not intercept typing or execute file commands while capturing settings shortcuts', () => {
    useKeymapStore.setState({ bindings: new Map([['file.copy', combo('c', { ctrl: true })]]) });
    const input = document.createElement('input'); target.append(input);
    expect(press('c', { ctrlKey: true }, input).defaultPrevented).toBe(false);
    useUiDialogsStore.getState().setSettingsOpen(true);
    expect(press('c', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(useFileStore.getState().clipboard).toBeNull();
  });

  it('opens the command palette from an input without running other commands', () => {
    useKeymapStore.setState({ bindings: new Map([['command-palette.toggle', combo('p', { ctrl: true, shift: true })]]) });
    const input = document.createElement('input'); target.append(input);
    press('P', { ctrlKey: true, shiftKey: true }, input);
    expect(isCommandPaletteOpen()).toBe(true);
    press('P', { ctrlKey: true, shiftKey: true }, input);
    expect(isCommandPaletteOpen()).toBe(false);
  });

  it('opens the actual directory filter for its configured command', () => {
    useKeymapStore.setState({ bindings: new Map([['search.focus', combo('f', { ctrl: true })]]) });
    press('f', { ctrlKey: true });
    expect(useFileStore.getState().panes.p.searchOpen).toBe(true);
  });

  it('lets an open context menu handle Escape while keeping the selected files', () => {
    const menu = document.createElement('div'); menu.className = 'context-menu'; target.append(menu);
    const closeMenu = vi.fn(() => menu.remove()); target.addEventListener('keydown', closeMenu, { once: true });
    expect(press('Escape').defaultPrevented).toBe(false);
    expect(closeMenu).toHaveBeenCalledOnce();
    expect([...useFileStore.getState().panes.p.selectedPaths]).toEqual(['C:\\initial\\a.txt']);
    press('Escape');
    expect(useFileStore.getState().panes.p.selectedPaths.size).toBe(0);
  });

  it('undo refreshes current directory data and reports failures', async () => {
    useKeymapStore.setState({ bindings: new Map([['file.undo', combo('z', { ctrl: true })]]) });
    mock.fs.undo.mockResolvedValueOnce({ ok: true, data: { id: '1', label: '复制', timestamp: 1 } });
    mock.fs.listDir.mockClear();
    press('z', { ctrlKey: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(mock.fs.undo).toHaveBeenCalledTimes(1);
    expect(mock.fs.listDir).toHaveBeenCalledWith('C:\\initial');
    mock.fs.undo.mockResolvedValueOnce({ ok: false, error: { code: 'EBUSY', message: '文件已变化' } });
    press('z', { ctrlKey: true });
    await Promise.resolve(); await Promise.resolve();
    expect(useFileStore.getState().toasts.some((toast) => toast.message === '文件已变化')).toBe(true);
  });

  it('normalizes platform primary modifiers and shifted backslash', () => {
    const binding = new Map([['pane.split-vertical', combo('\\', { ctrl: true, shift: true })]]);
    expect(findShortcutCommand({ key: '|', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }, binding, 'macos')).toBe('pane.split-vertical');
    expect(findShortcutCommand({ key: '|', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }, binding, 'windows')).toBeNull();
  });
});
