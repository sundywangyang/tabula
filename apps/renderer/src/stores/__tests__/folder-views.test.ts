import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderViewSettings } from '@tabula/bridge';
import { useFileStore } from '../file-store';
import { deferred, seedFiles } from './file-fixtures';

let views: Record<string, FolderViewSettings>;
beforeEach(async () => {
  await seedFiles();
  views = {};
  window.tabula.config.get = vi.fn(async () => 'details') as typeof window.tabula.config.get;
  window.tabula.config.getFolderView = vi.fn(async (path) => views[path] ?? null);
  window.tabula.config.setFolderView = vi.fn(async (path, patch) => { views[path] = { ...views[path], ...patch }; });
});

describe('folder views', () => {
  it('restores different views and sorting for separate folders and panes', async () => {
    const store = useFileStore.getState();
    await store.loadDir('p', 'C:\\pictures');
    store.setViewMode('p', 'grid');
    store.setDetailColumns('p', { columnWidths: { size: 180 }, visibleColumns: { type: false } });
    store.cycleSort('mtime', 'p'); store.cycleSort('mtime', 'p');
    await store.loadDir('p', 'C:\\code');
    store.setViewMode('p', 'details');
    await store.loadDir('q', 'C:\\pictures');
    expect(useFileStore.getState().panes.q).toMatchObject({ viewMode: 'grid', sortBy: 'mtime', sortDir: 'desc', columnWidths: { size: 180 }, visibleColumns: { type: false } });
    expect(useFileStore.getState().panes.p).toMatchObject({ viewMode: 'details', sortBy: 'name', sortDir: 'asc', columnWidths: {}, visibleColumns: {} });
    await store.loadDir('p', 'C:\\pictures');
    expect(useFileStore.getState().panes.p).toMatchObject({ viewMode: 'grid', sortBy: 'mtime', sortDir: 'desc' });
  });

  it('does not apply a late saved view after the user changes the current view', async () => {
    const pending = deferred<FolderViewSettings | null>();
    vi.mocked(window.tabula.config.getFolderView).mockReturnValueOnce(pending.promise);
    const loading = useFileStore.getState().loadDir('p', 'C:\\pictures');
    useFileStore.getState().setViewMode('p', 'grid');
    pending.resolve({ viewMode: 'list' });
    await loading;
    expect(useFileStore.getState().panes.p.viewMode).toBe('grid');
  });
});
