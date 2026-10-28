import type { KeyCombo } from '@tabula/bridge';
import { runCommandById } from './command-dispatcher';
import { closeCommandPalette, isCommandPaletteOpen } from './features/command-palette/CommandPalette';
import { getCachedPlatform } from './platform-cache';
import { useFileStore } from './stores/file-store';
import { useKeymapStore } from './stores/keymap-store';
import { useLayoutStore } from './stores/layout-store';
import { useUiDialogsStore } from './stores/ui-dialogs-store';

function normalizeKey(key: string): string {
  const normalized = key.toLowerCase();
  return ({ ' ': 'space', spacebar: 'space', del: 'delete', esc: 'escape', '|': '\\' } as Record<string, string>)[normalized] ?? normalized;
}

export function findShortcutCommand(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  bindings: ReadonlyMap<string, KeyCombo | null>,
  platform: string,
): string | null {
  for (const [command, combo] of bindings) {
    if (!combo) continue;
    const macPrimary = platform === 'macos' && combo.ctrl && !combo.meta && event.metaKey && !event.ctrlKey;
    if (normalizeKey(event.key) === normalizeKey(combo.key)
      && event.ctrlKey === (macPrimary ? false : combo.ctrl)
      && event.metaKey === (macPrimary ? true : combo.meta)
      && event.altKey === combo.alt && event.shiftKey === combo.shift) return command;
  }
  return null;
}

/** Capture before component handlers, so a key executes exactly one command. */
export function handleShortcutKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  // The open context menu owns Escape; let its handler close it without clearing selection.
  if (event.key === 'Escape' && document.querySelector('.context-menu')) return;
  const dialogs = useUiDialogsStore.getState();
  if (dialogs.toolsDialog || dialogs.settingsOpen || dialogs.newFolderOpen || dialogs.newFileOpen || dialogs.confirmDeleteOpen
    || dialogs.confirmPermanentDeleteOpen || dialogs.batchRename.open || dialogs.propertiesPanel.open) return;
  const file = useFileStore.getState();
  if (file.pendingConflicts || file.globalSearch.open) return;
  const command = findShortcutCommand(event, useKeymapStore.getState().bindings, getCachedPlatform());
  if (command === 'command-palette.toggle') {
    event.preventDefault(); event.stopPropagation();
    runCommandById(command);
    return;
  }
  if (isCommandPaletteOpen()) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable="true"]') || file.pathBarOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation();
    if (file.previewState) file.closePreview();
    else {
      const paneId = useLayoutStore.getState().activePaneId;
      file.clearSelection(paneId);
      file.closeSearch(paneId);
    }
    closeCommandPalette();
    return;
  }
  if (!command) return;
  if (file.previewState && command !== 'preview.toggle') return;
  event.preventDefault(); event.stopPropagation();
  runCommandById(command);
}
