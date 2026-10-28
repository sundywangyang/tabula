import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutNode, TabulaAPI } from '@tabula/bridge';
import { NewTabDialog } from '../NewTabDialog';
import { TabBar } from '../../features/panes/TabBar';
import { runCommandById } from '../../command-dispatcher';
import { useFavoritesStore } from '../../stores/favorites-store';
import { makeFolderTab } from '../../stores/folder-tab';
import { useFileStore } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import { useUiDialogsStore } from '../../stores/ui-dialogs-store';

let container: HTMLDivElement;
let root: Root;
const listDir = vi.fn();
const pane = (id: string): Extract<LayoutNode, { type: 'pane' }> => ({
  type: 'pane', id, tabs: [makeFolderTab('C:\\existing')], activeTabId: null,
});
function renderBars() {
  const layout = useLayoutStore.getState().rootLayout;
  if (layout.type !== 'split') throw new Error('expected split');
  return <>{layout.children.map((node) => node.type === 'pane' && <TabBar key={node.id} paneId={node.id} pane={node} />)}<NewTabDialog /></>;
}
function currentPane(id: string) {
  const layout = useLayoutStore.getState().rootLayout;
  if (layout.type !== 'split') throw new Error('expected split');
  const found = layout.children.find((node) => node.type === 'pane' && node.id === id);
  if (!found || found.type !== 'pane') throw new Error('missing pane');
  return found;
}
function click(selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  element.click();
}
function setInput(value: string) {
  const input = container.querySelector<HTMLInputElement>('#new-tab-path')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  listDir.mockReset().mockImplementation(async (path: string) => ({ ok: true, data: { path, entries: [], total: 0 } }));
  window.tabula = { fs: { listDir }, config: { set: vi.fn(async () => {}) } } as unknown as TabulaAPI;
  const left = pane('left'); left.activeTabId = left.tabs[0].id;
  const right = pane('right'); right.activeTabId = right.tabs[0].id;
  useLayoutStore.setState({ rootLayout: { type: 'split', id: 'split', dir: 'horizontal', sizes: [50, 50], children: [left, right] }, activePaneId: 'left' });
  useFileStore.setState({ panes: {} });
  useFavoritesStore.setState({ history: [{ path: 'C:\\existing', visitedAt: 2 }, { path: 'D:\\work', visitedAt: 1 }] });
  useUiDialogsStore.getState().setNewTabPaneId(null);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(renderBars()));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('new tab path dialog', () => {
  it('opens history from the clicked pane and creates a new tab even for the same path', async () => {
    await act(async () => click('[data-tab-bar-pane-id="right"] .tab-add'));
    expect(container.querySelectorAll('.new-tab-history-item')).toHaveLength(2);
    expect(currentPane('right').tabs).toHaveLength(1);
    await act(async () => click('.new-tab-history-item'));
    expect(currentPane('right').tabs).toHaveLength(2);
    expect(currentPane('right').tabs[1].path).toBe('C:\\existing');
    expect(currentPane('left').tabs).toHaveLength(1);
    expect(useLayoutStore.getState().activePaneId).toBe('right');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens the same dialog through the tab command, validates input and creates a tab on success', async () => {
    listDir.mockResolvedValueOnce({ ok: false, error: { message: '目录不存在' } });
    await act(async () => { runCommandById('tab.new'); });
    await act(async () => setInput('D:\\missing'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('目录不存在');
    expect(currentPane('left').tabs).toHaveLength(1);
    await act(async () => setInput('D:\\work'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(currentPane('left').tabs[1].path).toBe('D:\\work');
  });

  it('cancels a pending validation without creating a tab', async () => {
    let resolve!: (result: unknown) => void;
    listDir.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => click('[data-tab-bar-pane-id="left"] .tab-add'));
    await act(async () => click('.new-tab-history-item'));
    await act(async () => click('.new-tab-close'));
    await act(async () => resolve({ ok: true, data: { path: 'C:\\existing', entries: [], total: 0 } }));
    expect(currentPane('left').tabs).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
