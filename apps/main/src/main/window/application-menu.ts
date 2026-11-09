/** macOS 原生菜单：关闭标签复用应用命令，保留系统文本编辑与窗口菜单。 */
import { BrowserWindow, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type { KeyCombo } from '@tabula/bridge';
import { getKeymapManager } from '../keymap/keymap-manager';

function macAccelerator(combo: KeyCombo | null | undefined): string | undefined {
  // Plain/Shift/Option keys must reach renderer input guards instead of stealing text.
  if (!combo || (!combo.ctrl && !combo.meta)) return undefined;
  const key = combo.key.toLowerCase();
  const aliases: Record<string, string> = {
    arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
    space: 'Space', enter: 'Return', escape: 'Escape', backspace: 'Backspace',
    delete: 'Delete', tab: 'Tab', home: 'Home', end: 'End',
    pageup: 'PageUp', pagedown: 'PageDown', '+': 'Plus',
  };
  const acceleratorKey = aliases[key] ?? (/^[\x21-\x7e]$/.test(key) || /^f([1-9]|1\d|2[0-4])$/.test(key) ? key : undefined);
  if (!acceleratorKey) return undefined;
  const modifiers: string[] = [];
  // Renderer bindings accept Cmd as the macOS equivalent of a Ctrl-only combo.
  if (combo.ctrl && combo.meta) modifiers.push('Control', 'Command');
  else if (combo.ctrl || combo.meta) modifiers.push('Command');
  if (combo.alt) modifiers.push('Alt');
  if (combo.shift) modifiers.push('Shift');
  return [...modifiers, acceleratorKey].join('+');
}

/** Rebuild after a binding changes so native accelerators never retain an old binding. */
export function updateApplicationMenu(): void {
  if (process.platform !== 'darwin') return;
  const closeBinding = getKeymapManager().getBindings().find(binding => binding.commandId === 'tab.close');
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: '文件',
      submenu: [
        {
          label: '关闭标签',
          accelerator: macAccelerator(closeBinding?.combo),
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send(IpcChannels.COMMANDS_RUN_COMMAND, { commandId: 'tab.close' });
            }
          },
        },
        { type: 'separator' },
        // No accelerator: Cmd+W belongs to tab.close, including after rebinding.
        {
          label: '关闭窗口',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) win.close();
          },
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
