// @vitest-environment node
/** Native close-tab routing and shortcut changes must not fall back to closing a window. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import type { KeyCombo } from '@tabula/bridge';
import { IpcChannels } from '@tabula/bridge';

const mocks = vi.hoisted(() => ({
  build: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
  install: vi.fn(),
  focused: vi.fn(),
  handle: vi.fn<(channel: string, handler: (...args: unknown[]) => unknown) => void>(),
  bindings: vi.fn(),
  setBinding: vi.fn(),
  resetAll: vi.fn(),
}));

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: mocks.build, setApplicationMenu: mocks.install },
  BrowserWindow: { getFocusedWindow: mocks.focused },
  ipcMain: { handle: mocks.handle },
}));
vi.mock('../../keymap/keymap-manager', () => ({
  getKeymapManager: () => ({
    getBindings: mocks.bindings, setBinding: mocks.setBinding,
    resetAll: mocks.resetAll, getAllCommands: () => [],
  }),
}));

import { updateApplicationMenu } from '../../window/application-menu';
import { registerShortcutsHandlers } from '../shortcuts';

const defaultCombo: KeyCombo = { key: 'w', ctrl: true, meta: false, alt: false, shift: false };
const platform = process.platform;

function fileItems(): MenuItemConstructorOptions[] {
  const template = mocks.build.mock.lastCall![0];
  return template.find(item => item.label === '文件')!.submenu as MenuItemConstructorOptions[];
}

function click(item: MenuItemConstructorOptions, win?: unknown): void {
  if (win !== undefined) mocks.focused.mockReturnValue(win);
  item.click!(undefined as never, win as never, undefined as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
  mocks.bindings.mockReturnValue([{ commandId: 'tab.close', combo: defaultCombo }]);
  mocks.focused.mockReturnValue(null);
});
afterEach(() => Object.defineProperty(process, 'platform', { configurable: true, value: platform }));

describe('macOS application menu', () => {
  it('Cmd+W dispatches close-tab to the active window without closing it', () => {
    const win = { isDestroyed: () => false, close: vi.fn(), webContents: { send: vi.fn() } };
    updateApplicationMenu();
    const items = fileItems();
    expect(items[0].accelerator).toBe('Command+w');
    click(items[0], win);
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(IpcChannels.COMMANDS_RUN_COMMAND, { commandId: 'tab.close' });
    expect(win.close).not.toHaveBeenCalled();
    expect(items.find(item => item.label === '关闭窗口')!.accelerator).toBeUndefined();
    expect(items.some(item => item.role === 'close')).toBe(false);
  });

  it('keeps native editing, application and window menus', () => {
    updateApplicationMenu();
    expect(mocks.build.mock.lastCall![0]).toEqual(expect.arrayContaining([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
    ]));
  });

  it('uses the current custom binding and removes the accelerator when unbound', () => {
    mocks.bindings.mockReturnValue([{ commandId: 'tab.close', combo: { ...defaultCombo, key: 'arrowleft', shift: true } }]);
    updateApplicationMenu();
    expect(fileItems()[0].accelerator).toBe('Command+Shift+Left');
    mocks.bindings.mockReturnValue([{ commandId: 'tab.close', combo: null }]);
    updateApplicationMenu();
    expect(fileItems()[0].accelerator).toBeUndefined();
  });

  it.each([
    { key: 'k', ctrl: false, meta: false, alt: false, shift: false },
    { key: 'k', ctrl: false, meta: false, alt: false, shift: true },
    { key: 'k', ctrl: false, meta: false, alt: true, shift: false },
  ])('leaves printable bindings to renderer input guards: %j', combo => {
    mocks.bindings.mockReturnValue([{ commandId: 'tab.close', combo }]);
    updateApplicationMenu();
    expect(fileItems()[0].accelerator).toBeUndefined();
  });

  it('ignores missing or destroyed windows', () => {
    updateApplicationMenu();
    expect(() => click(fileItems()[0])).not.toThrow();
    const send = vi.fn();
    click(fileItems()[0], { isDestroyed: () => true, webContents: { send } });
    expect(send).not.toHaveBeenCalled();
  });

  it('offers an explicit close-window action without a conflicting accelerator', () => {
    const win = { isDestroyed: () => false, close: vi.fn() };
    mocks.focused.mockReturnValue(win);
    updateApplicationMenu();
    click(fileItems().find(item => item.label === '关闭窗口')!);
    expect(win.close).toHaveBeenCalledOnce();
  });

  it('refreshes accelerators only after successful changes and after resetting bindings', () => {
    registerShortcutsHandlers();
    const handlers = new Map(mocks.handle.mock.calls);
    mocks.setBinding.mockReturnValue({ ok: false, error: { code: 'CONFLICT' } });
    handlers.get(IpcChannels.SHORTCUTS_SET_BINDING)!(null, 'tab.close', defaultCombo);
    expect(mocks.install).not.toHaveBeenCalled();
    mocks.setBinding.mockReturnValue({ ok: true, data: { commandId: 'tab.close', combo: null } });
    mocks.bindings.mockReturnValue([{ commandId: 'tab.close', combo: null }]);
    handlers.get(IpcChannels.SHORTCUTS_SET_BINDING)!(null, 'tab.close', null);
    expect(fileItems()[0].accelerator).toBeUndefined();
    handlers.get(IpcChannels.SHORTCUTS_RESET_ALL)!(null);
    expect(mocks.resetAll).toHaveBeenCalledOnce();
    expect(mocks.install).toHaveBeenCalledTimes(2);
  });

  it.each(['win32', 'linux'])('leaves %s menus unchanged', value => {
    Object.defineProperty(process, 'platform', { configurable: true, value });
    updateApplicationMenu();
    expect(mocks.install).not.toHaveBeenCalled();
  });
});
