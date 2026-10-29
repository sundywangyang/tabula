import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabulaAPI } from '@tabula/bridge';
import { PathBar } from '../PathBar';
import { runCommandById } from '../../command-dispatcher';
import { useFavoritesStore } from '../../stores/favorites-store';
import { useFileStore } from '../../stores/file-store';
import { makeFolderTab } from '../../stores/folder-tab';
import { useLayoutStore } from '../../stores/layout-store';

let container: HTMLDivElement;
let root: Root;
const listDir = vi.fn();
const tab = makeFolderTab('C:\\existing');
function currentPath() {
  const pane = useLayoutStore.getState().getActivePane();
  return pane?.type === 'pane' ? pane.tabs[0]?.path : undefined;
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  listDir.mockReset().mockImplementation(async (path: string) => ({ ok: true, data: { path, entries: [], total: 0 } }));
  window.tabula = { fs: { listDir }, config: { set: vi.fn(async () => {}) } } as unknown as TabulaAPI;
  useLayoutStore.setState({ rootLayout: { type: 'pane', id: 'p', tabs: [tab], activeTabId: tab.id }, activePaneId: 'p' });
  useFileStore.setState({ panes: {}, pathBarOpen: false });
  useFavoritesStore.setState({ history: [{ path: 'D:\\work', visitedAt: 2 }, { path: 'E:\\other', visitedAt: 1 }] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PathBar />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('go to path dialog', () => {
  it('shows the same recent visits and opens one in the current tab', async () => {
    await act(async () => { runCommandById('file.path-bar'); });
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe('转到路径');
    expect(container.querySelectorAll('.new-tab-history-item')).toHaveLength(2);
    await act(async () => (container.querySelector('.new-tab-history-item') as HTMLButtonElement).click());
    const pane = useLayoutStore.getState().getActivePane();
    expect(pane?.type).toBe('pane');
    if (pane?.type === 'pane') {
      expect(pane.tabs).toHaveLength(1);
      expect(pane.tabs[0].path).toBe('D:\\work');
    }
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows validation errors and stays open', async () => {
    listDir.mockResolvedValueOnce({ ok: false, error: { message: '目录不存在' } });
    await act(async () => useFileStore.getState().openPathBar('p', 'D:\\missing'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('目录不存在');
    expect(currentPath()).toBe('C:\\existing');
  });

  it('does not navigate after pending validation is cancelled', async () => {
    let resolve!: (value: unknown) => void;
    listDir.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => useFileStore.getState().openPathBar('p', 'D:\\work'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => (container.querySelector('.new-tab-close') as HTMLButtonElement).click());
    await act(async () => resolve({ ok: true, data: { path: 'D:\\work', entries: [], total: 0 } }));
    expect(currentPath()).toBe('C:\\existing');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
