import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutNode, Tab } from '@tabula/bridge';
import { TabBar } from '../TabBar';
import { runCommandById } from '../../../command-dispatcher';
import { useFileStore } from '../../../stores/file-store';
import { useLayoutStore } from '../../../stores/layout-store';
import { initPlatformCache } from '../../../platform-cache';
import { deferred, listing, seedFiles } from '../../../stores/__tests__/file-fixtures';

const tab = (id: string, path = `C:\\${id}`): Tab => ({ id, type: 'folder', title: id, path, pinned: false, closable: true, history: [path], historyIndex: 0 });
const pane = (id: string, tabs: Tab[]): Extract<LayoutNode, { type: 'pane' }> => ({ type: 'pane', id, tabs, activeTabId: tabs[0]?.id ?? null });
let mock: Awaited<ReturnType<typeof seedFiles>>;
let container: HTMLDivElement;
let root: Root;

function SingleBar() {
  const layout = useLayoutStore(s => s.rootLayout);
  return layout.type === 'pane' ? <TabBar paneId={layout.id} pane={layout} /> : null;
}
function onlyPane() {
  const layout = useLayoutStore.getState().rootLayout;
  if (layout.type !== 'pane') throw new Error('Expected a single pane');
  return layout;
}
async function startSingle(tabs: Tab[]) {
  useLayoutStore.setState({ rootLayout: pane('p', tabs), activePaneId: 'p', tabDrag: null });
  await useFileStore.getState().loadDir('p', tabs[0]!.path!);
  mock.fs.listDir.mockClear();
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  mock = await seedFiles();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('closing the last tab', () => {
  it('clicking close opens the platform default path and loads it into the last pane', async () => {
    await act(async () => { await startSingle([tab('old')]); root.render(<SingleBar />); });
    const oldId = onlyPane().activeTabId;
    const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭标签"]')!;
    await act(async () => close.click());
    const current = onlyPane();
    expect(current.tabs).toHaveLength(1);
    expect(current.activeTabId).not.toBe(oldId);
    expect(current.tabs[0]).toMatchObject({ path: 'C:\\', title: 'C:', history: ['C:\\'], historyIndex: 0 });
    expect(current.activeTabId).toBe(current.tabs[0].id);
    expect(mock.fs.listDir).toHaveBeenCalledWith('C:\\');
    expect(useFileStore.getState().panes.p.currentPath).toBe('C:\\');
    expect(useFileStore.getState().panes.p.breadcrumb[0].path).toBe('C:\\');
    expect(container.textContent).toContain('C:');
    await act(async () => useLayoutStore.getState().persistImmediate());
    expect(mock.config.set).toHaveBeenCalledWith('layoutV1', expect.objectContaining({ rootLayout: current }));
  });

  it('shows the default folder name on the tab when the path is C:\\Users', async () => {
    mock.platform.defaultRootPath.mockResolvedValue('C:\\Users');
    await initPlatformCache();
    await act(async () => { await startSingle([tab('old')]); root.render(<SingleBar />); });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭标签"]')!.click());
    expect(onlyPane().tabs[0]).toMatchObject({ path: 'C:\\Users', title: 'Users' });
    expect(container.textContent).toContain('Users');
    expect(useFileStore.getState().panes.p.currentPath).toBe('C:\\Users');
  });

  it('updates an old saved fallback title without changing its tab identity or history', async () => {
    mock.platform.defaultRootPath.mockResolvedValue('C:\\Users');
    await initPlatformCache();
    const saved = { ...tab('saved', 'C:\\Users'), title: '主页' };
    mock.config.all.mockResolvedValue({ layoutV1: { rootLayout: pane('p', [saved]), activePaneId: 'p' } });
    await act(async () => useLayoutStore.getState().hydrateFromConfig());
    expect(onlyPane().tabs[0]).toEqual({ ...saved, title: 'Users' });
    await act(async () => useLayoutStore.getState().persistImmediate());
    expect(mock.config.set).toHaveBeenCalledWith('layoutV1', expect.objectContaining({ rootLayout: onlyPane() }));
  });

  it('keeps an unrelated saved tab named 主页 unchanged', async () => {
    const saved = { ...tab('saved', 'C:\\elsewhere'), title: '主页' };
    mock.config.all.mockResolvedValue({ layoutV1: { rootLayout: pane('p', [saved]), activePaneId: 'p' } });
    await act(async () => useLayoutStore.getState().hydrateFromConfig());
    expect(onlyPane().tabs[0]).toEqual(saved);
  });

  it('uses the same fallback for the close-tab command', async () => {
    await act(async () => { await startSingle([tab('old')]); });
    await act(async () => { expect(runCommandById('tab.close')).toBe(true); });
    expect(onlyPane().tabs[0].path).toBe('C:\\');
    expect(useFileStore.getState().panes.p.currentPath).toBe('C:\\');
  });

  it('keeps the remaining tab and does not navigate to the default', async () => {
    await act(async () => { await startSingle([tab('a'), tab('b')]); });
    await act(async () => useLayoutStore.getState().pane.closeTab('p', 'a'));
    expect(onlyPane().tabs.map(t => t.id)).toEqual(['b']);
    expect(onlyPane().activeTabId).toBe('b');
    expect(mock.fs.listDir).not.toHaveBeenCalledWith('C:\\');
  });

  it('does not replace a pinned tab or react to a missing tab', async () => {
    const pinned = { ...tab('pinned'), closable: false, pinned: true };
    await act(async () => { await startSingle([pinned]); });
    await act(async () => { useLayoutStore.getState().pane.closeTab('p', 'pinned'); useLayoutStore.getState().pane.closeTab('p', 'missing'); });
    expect(onlyPane().tabs).toEqual([pinned]);
    expect(mock.fs.listDir).not.toHaveBeenCalled();
  });

  it('merges a closed pane without adding a default tab to another populated pane', async () => {
    const left = pane('left', [tab('a')]);
    const right = pane('right', [tab('b')]);
    useLayoutStore.setState({ rootLayout: { type: 'split', id: 'split', dir: 'horizontal', sizes: [50, 50], children: [left, right] }, activePaneId: 'left' });
    await act(async () => useLayoutStore.getState().pane.closeTab('left', 'a'));
    expect(onlyPane().id).toBe('right');
    expect(onlyPane().tabs.map(t => t.id)).toEqual(['b']);
    expect(mock.fs.listDir).not.toHaveBeenCalledWith('C:\\');
  });

  it('opens the default when a merge leaves the final pane empty', async () => {
    useLayoutStore.setState({ rootLayout: { type: 'split', id: 'split', dir: 'horizontal', sizes: [50, 50], children: [pane('left', [tab('a')]), pane('right', [])] }, activePaneId: 'left' });
    await act(async () => useLayoutStore.getState().pane.closeTab('left', 'a'));
    expect(onlyPane().id).toBe('right');
    expect(onlyPane().tabs[0].path).toBe('C:\\');
    expect(useFileStore.getState().panes.right.currentPath).toBe('C:\\');
  });

  it('prevents a late response from the closed tab from restoring stale content', async () => {
    await act(async () => { await startSingle([tab('old')]); });
    const pending = deferred<ReturnType<typeof listing>>();
    mock.fs.listDir.mockImplementation(path => path === 'C:\\old' ? pending.promise : Promise.resolve(listing(path, ['default.txt'])));
    let oldRequest!: Promise<void>;
    await act(async () => { oldRequest = useFileStore.getState().loadDir('p', 'C:\\old'); });
    await act(async () => useLayoutStore.getState().pane.closeTab('p', 'old'));
    await act(async () => { pending.resolve(listing('C:\\old', ['stale.txt'])); await oldRequest; });
    expect(useFileStore.getState().panes.p.currentPath).toBe('C:\\');
    expect(useFileStore.getState().panes.p.entries.map(e => e.name)).toEqual(['default.txt']);
  });
});
