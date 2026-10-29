import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabulaAPI, WindowSessionSnapshot } from '@tabula/bridge';
import { useFileStore } from '../file-store';
import { makeFolderTab } from '../folder-tab';
import { useLayoutStore } from '../layout-store';
import { seedFiles } from './file-fixtures';
import { ensureStartupDirectory } from '../startup-directory';

let snapshot: WindowSessionSnapshot;
beforeEach(async () => {
  await seedFiles();
  const tab = makeFolderTab('C:\\restored');
  snapshot = { rootLayout: { type: 'pane', id: 'saved', tabs: [tab], activeTabId: tab.id }, activePaneId: 'saved',
    selections: { saved: { path: 'C:\\restored', paths: ['C:\\restored\\a.txt', 'C:\\restored\\removed.txt'], cursorPath: 'C:\\restored\\a.txt' } } };
  window.tabula.windows = { getSession: vi.fn(async () => ({ snapshot, allowLegacy: false })),
    saveSession: vi.fn(async () => {}), saveSessionSync: vi.fn(() => true) } as unknown as TabulaAPI['windows'];
  useLayoutStore.setState({ hydrated: false });
  useFileStore.getState().setSessionSelections({});
});

describe('window sessions', () => {
  it('restores the window layout and only selections still present on disk', async () => {
    await useLayoutStore.getState().hydrateFromConfig();
    expect(useLayoutStore.getState().activePaneId).toBe('saved');
    await useFileStore.getState().loadDir('saved', 'C:\\restored');
    const pane = useFileStore.getState().panes.saved;
    expect([...pane.selectedPaths]).toEqual(['C:\\restored\\a.txt']);
    expect(pane.cursorPath).toBe('C:\\restored\\a.txt');
    await ensureStartupDirectory('saved', 'C:\\restored');
    expect([...useFileStore.getState().panes.saved.selectedPaths]).toEqual(['C:\\restored\\a.txt']);
    useLayoutStore.getState().persistOnUnload();
    expect(window.tabula.windows.saveSessionSync).toHaveBeenCalledWith(expect.objectContaining({ activePaneId: 'saved', selections: { saved: { path: 'C:\\restored', paths: ['C:\\restored\\a.txt'], cursorPath: 'C:\\restored\\a.txt' } } }));
  });
  it('does not copy the legacy layout into a freshly created second window', async () => {
    vi.mocked(window.tabula.windows.getSession).mockResolvedValue({ snapshot: null, allowLegacy: false });
    vi.mocked(window.tabula.config.all).mockClear();
    const previous = useLayoutStore.getState().rootLayout;
    await useLayoutStore.getState().hydrateFromConfig();
    expect(useLayoutStore.getState().rootLayout).toEqual(previous);
    expect(window.tabula.config.all).not.toHaveBeenCalled();
  });
});
