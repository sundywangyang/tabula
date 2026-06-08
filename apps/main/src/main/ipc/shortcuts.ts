/**
 * 快捷键 IPC 处理器 (P7 v1)
 *
 * 4 个通道:
 * - shortcuts:get-all       → CommandSpec[]
 * - shortcuts:get-bindings  → ShortcutBinding[]
 * - shortcuts:set-binding   → SetBindingResult(Result<T> 风格,但用 ShortcutError 而非 FsError)
 * - shortcuts:reset-all     → void
 */
import { ipcMain } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type { KeyCombo } from '@tabula/bridge';
import { getKeymapManager } from '../keymap/keymap-manager';

export function registerShortcutsHandlers(): void {
  const km = getKeymapManager();

  ipcMain.handle(IpcChannels.SHORTCUTS_GET_ALL, () => km.getAllCommands());

  ipcMain.handle(IpcChannels.SHORTCUTS_GET_BINDINGS, () => km.getBindings());

  ipcMain.handle(
    IpcChannels.SHORTCUTS_SET_BINDING,
    (_e, commandId: string, combo: KeyCombo | null) => {
      return km.setBinding(commandId, combo);
    },
  );

  ipcMain.handle(IpcChannels.SHORTCUTS_RESET_ALL, () => {
    km.resetAll();
  });
}
