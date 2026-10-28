import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../layout-store';
import { useFileStore } from '../file-store';
import { deferred, listing, seedFiles } from './file-fixtures';

let mock: Awaited<ReturnType<typeof seedFiles>>;
const store = () => useFileStore.getState();

beforeEach(async () => { vi.useFakeTimers(); mock = await seedFiles(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('directory request ownership', () => {
  it('ignores an older directory response after a newer navigation finishes', async () => {
    const older = deferred<ReturnType<typeof listing>>();
    const newer = deferred<ReturnType<typeof listing>>();
    mock.fs.listDir.mockImplementation((path) => path === 'C:\\old' ? older.promise : newer.promise);
    const first = store().loadDir('p', 'C:\\old');
    const second = store().loadDir('p', 'C:\\new');
    newer.resolve(listing('C:\\new', ['new.txt'])); await second;
    older.resolve(listing('C:\\old', ['old.txt'])); await first;
    expect(store().panes.p.currentPath).toBe('C:\\new');
    expect(store().panes.p.entries.map((item) => item.name)).toEqual(['new.txt']);
  });

  it('does not allow an old refresh to overwrite a new directory', async () => {
    await store().loadDir('p', 'C:\\old');
    const oldRefresh = deferred<ReturnType<typeof listing>>();
    mock.fs.listDir.mockImplementation((path) => path === 'C:\\old' ? oldRefresh.promise : Promise.resolve(listing(path, ['new.txt'])));
    const refresh = store().refresh('p');
    await store().loadDir('p', 'C:\\new');
    oldRefresh.resolve(listing('C:\\old')); await refresh;
    expect(store().panes.p.entries[0].path).toBe('C:\\new\\new.txt');
  });

  it('rejects stale requests even after navigating A -> B -> A', async () => {
    const older = deferred<ReturnType<typeof listing>>();
    mock.fs.listDir.mockImplementationOnce(() => older.promise);
    const first = store().loadDir('p', 'C:\\A');
    await store().loadDir('p', 'C:\\B');
    mock.fs.listDir.mockResolvedValueOnce(listing('C:\\A', ['latest.txt']));
    await store().loadDir('p', 'C:\\A');
    older.resolve(listing('C:\\A', ['stale.txt'])); await first;
    expect(store().panes.p.entries[0].name).toBe('latest.txt');
  });

  it('clears old actionable entries while loading and ignores stale failures', async () => {
    await store().loadDir('p', 'C:\\initial');
    const older = deferred<ReturnType<typeof listing>>();
    mock.fs.listDir.mockImplementationOnce(() => older.promise);
    const first = store().loadDir('p', 'C:\\slow');
    expect(store().panes.p.entries).toEqual([]);
    await store().loadDir('p', 'C:\\new');
    older.reject(new Error('old failure')); await first;
    expect(store().panes.p.error).toBeNull();
    expect(store().panes.p.currentPath).toBe('C:\\new');
  });

  it('does not recreate a pane removed during a directory request', async () => {
    const pending = deferred<ReturnType<typeof listing>>();
    mock.fs.listDir.mockImplementationOnce(() => pending.promise);
    const request = store().loadDir('p', 'C:\\slow');
    store().removePaneData('p');
    pending.resolve(listing('C:\\slow')); await request;
    expect(store().panes.p).toBeUndefined();
  });

  it('late configuration preserves a loaded new pane and concurrent initialization is idempotent', async () => {
    store().removePaneData('p');
    const config = deferred<Record<string, unknown>>();
    mock.config.all.mockImplementation(() => config.promise);
    const first = store().ensurePane('p');
    const second = store().ensurePane('p');
    await store().loadDir('p', 'C:\\new');
    config.resolve({ defaultView: 'grid' }); await Promise.all([first, second]);
    expect(store().panes.p.currentPath).toBe('C:\\new');
    expect(store().panes.p.entries).toHaveLength(1);
    expect(store().panes.p.viewMode).toBe('grid');
    expect(mock.config.all).toHaveBeenCalledTimes(2); // the initial seed and one shared initialization
  });

  it('address-bar navigation updates the tab path and back history', async () => {
    store().openPathBar('p', 'C:\\from-address-bar');
    await store().submitPathBar();
    const pane = useLayoutStore.getState().getActivePane();
    expect(pane?.type).toBe('pane');
    if (pane?.type === 'pane') {
      const tab = pane.tabs.find((item) => item.id === pane.activeTabId)!;
      expect(tab.path).toBe('C:\\from-address-bar');
      expect(tab.history).toEqual(['C:\\initial', 'C:\\from-address-bar']);
    }
    useLayoutStore.getState().pane.goBack('p');
    await Promise.resolve();
    expect(store().panes.p.currentPath).toBe('C:\\initial');
  });
});

describe('conflict execution', () => {
  it('uses the entered keep-both name for an actual copy', async () => {
    mock.fs.exists.mockImplementation(async (path) => path === 'C:\\dest\\a.txt');
    mock.fs.stat.mockResolvedValue({ ok: true, data: { isDirectory: false } });
    await store().performBulk(['C:\\source\\a.txt'], 'C:\\dest', 'copy', 'p');
    await store().resolveConflict('rename', 'kept.txt');
    expect(mock.fs.copy).toHaveBeenCalledWith(expect.objectContaining({
      sources: ['C:\\source\\a.txt'], destinations: ['C:\\dest\\kept.txt'], overwrites: [false],
    }));
    expect(store().pendingConflicts).toBeNull();
  });

  it('keeps the dialog pending for invalid or already occupied names', async () => {
    mock.fs.exists.mockResolvedValue(true);
    await store().performBulk(['C:\\source\\a.txt'], 'C:\\dest', 'copy', 'p');
    await store().resolveConflict('rename', '../escape.txt');
    await store().resolveConflict('rename', 'occupied.txt');
    expect(store().pendingConflicts?.queue).toHaveLength(1);
    expect(mock.fs.copy).not.toHaveBeenCalled();
  });

  it('passes the overwrite decision to move and refreshes both panes without navigating either', async () => {
    await store().loadDir('p', 'C:\\source');
    await store().ensurePane('destination-pane');
    await store().loadDir('destination-pane', 'C:\\dest');
    mock.fs.exists.mockResolvedValue(true);
    await store().performBulk(['C:\\source\\a.txt'], 'C:\\dest', 'move', 'p');
    mock.fs.listDir.mockClear();
    await store().resolveConflict('overwrite');
    expect(mock.fs.move).toHaveBeenCalledWith(expect.objectContaining({ destinations: ['C:\\dest\\a.txt'], overwrites: [true] }));
    expect(mock.fs.listDir).toHaveBeenCalledWith('C:\\source');
    expect(mock.fs.listDir).toHaveBeenCalledWith('C:\\dest');
    expect(store().panes.p.currentPath).toBe('C:\\source');
    expect(store().panes['destination-pane'].currentPath).toBe('C:\\dest');
  });
});
