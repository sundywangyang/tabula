import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyCombo } from '@tabula/bridge';
import { Toolbar } from '../Toolbar';
import { useFileStore } from '../../stores/file-store';
import { useKeymapStore } from '../../stores/keymap-store';
import { shortcutLabel } from '../../shortcut-label';

vi.mock('../../platform-cache', () => ({ getCachedPlatform: () => 'windows', getCachedRootPath: () => 'C:\\' }));
const combo = (key: string, options: Partial<KeyCombo> = {}): KeyCombo => ({ key, ctrl: false, shift: false, alt: false, meta: false, ...options });
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useFileStore.setState({ panes: {}, clipboard: null });
  useKeymapStore.setState({ bindings: new Map([
    ['file.copy', combo('c', { ctrl: true })],
    ['file.new-folder', combo('n', { ctrl: true, shift: true })],
    ['file.new-folder-quick', combo('n', { ctrl: true })],
  ]) });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Toolbar paneId="p" />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function wrapperWithButton(text: string): HTMLElement {
  const button = [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === text);
  if (!button?.parentElement) throw new Error(`missing button ${text}`);
  return button.parentElement;
}

describe('toolbar shortcut tooltips', () => {
  it('shows the actual binding on a disabled button and updates after rebinding or clearing it', async () => {
    const wrapper = wrapperWithButton('复制');
    expect(wrapper.querySelector('button')?.disabled).toBe(true);
    await act(async () => wrapper.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Ctrl+C');
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => useKeymapStore.setState({ bindings: new Map([['file.copy', combo('k', { alt: true })]]) }));
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Alt+K');
    await act(async () => useKeymapStore.setState({ bindings: new Map([['file.copy', null]]) }));
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('无快捷键');
    await act(async () => wrapper.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('shows both folder shortcuts and preserves the right-click hint', async () => {
    const wrapper = wrapperWithButton('新建');
    await act(async () => wrapper.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('右键新建文件');
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Ctrl+Shift+N / Ctrl+N');
  });

  it('formats platform modifiers and special keys consistently with shortcut handling', () => {
    expect(shortcutLabel(combo('arrowleft', { alt: true }), 'windows')).toBe('Alt+←');
    expect(shortcutLabel(combo('c', { ctrl: true }), 'macos')).toBe('Cmd+C');
    expect(shortcutLabel(combo('c', { ctrl: true, meta: true }), 'macos')).toBe('Ctrl+Cmd+C');
    expect(shortcutLabel(null, 'windows')).toBeNull();
  });
});
