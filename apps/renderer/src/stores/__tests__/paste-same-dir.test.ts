import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileStore } from '../file-store';
import { seedFiles } from './file-fixtures';

let mock: Awaited<ReturnType<typeof seedFiles>>;
beforeEach(async () => { vi.useFakeTimers(); mock = await seedFiles(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('paste destinations', () => {
  it('passes the generated same-directory duplicate name to the main process', async () => {
    await useFileStore.getState().performBulk(['C:\\folder\\a.txt'], 'C:\\folder', 'copy');
    expect(mock.fs.copy).toHaveBeenCalledWith(expect.objectContaining({
      sources: ['C:\\folder\\a.txt'], destinations: ['C:\\folder\\a - 副本.txt'], overwrites: [false],
    }));
  });

  it('finds the next available duplicate name', async () => {
    mock.fs.exists.mockImplementation(async (path) => path === 'C:\\folder\\a - 副本.txt');
    await useFileStore.getState().performBulk(['C:\\folder\\a.txt'], 'C:\\folder', 'copy');
    expect(mock.fs.copy).toHaveBeenCalledWith(expect.objectContaining({ destinations: ['C:\\folder\\a - 副本 (2).txt'] }));
  });

  it('sends multiple files as one request so they share one undo entry', async () => {
    await useFileStore.getState().performBulk(['C:\\source\\a.txt', 'C:\\source\\b.txt'], 'C:\\destination', 'move');
    expect(mock.fs.move).toHaveBeenCalledTimes(1);
    expect(mock.fs.move).toHaveBeenCalledWith(expect.objectContaining({
      sources: ['C:\\source\\a.txt', 'C:\\source\\b.txt'],
      destinations: ['C:\\destination\\a.txt', 'C:\\destination\\b.txt'], overwrites: [false, false],
    }));
  });

  it('skips moving an item into its own directory without changing the file', async () => {
    await useFileStore.getState().performBulk(['C:\\folder\\a.txt'], 'C:\\folder', 'move');
    expect(mock.fs.move).not.toHaveBeenCalled();
    expect(mock.fs.exists).not.toHaveBeenCalled();
    expect(useFileStore.getState().pendingConflicts).toBeNull();
  });

  it('recognizes Windows paths with different slash direction and casing as the same file', async () => {
    mock.fs.exists.mockResolvedValue(true);
    const result = await useFileStore.getState().performBulk(['C:\\Folder\\a.txt'], 'c:/folder/', 'move');
    expect(result).toEqual({ ok: true, moved: 0 });
    expect(mock.fs.exists).not.toHaveBeenCalled();
    expect(mock.fs.move).not.toHaveBeenCalled();
    expect(useFileStore.getState().pendingConflicts).toBeNull();
    expect(useFileStore.getState().toasts).toEqual([]);
  });

  it('does not ask about a name conflict when moving a folder onto itself', async () => {
    mock.fs.exists.mockResolvedValue(true);
    const result = await useFileStore.getState().performBulk(['C:\\Folder'], 'c:/folder/', 'move');
    expect(result).toEqual({ ok: true, moved: 0 });
    expect(mock.fs.exists).not.toHaveBeenCalled();
    expect(mock.fs.move).not.toHaveBeenCalled();
    expect(useFileStore.getState().pendingConflicts).toBeNull();
  });

  it('still reports an actual name conflict in another directory', async () => {
    mock.fs.exists.mockResolvedValue(true);
    await useFileStore.getState().performBulk(['C:\\source\\a.txt'], 'C:\\target', 'move');
    expect(useFileStore.getState().pendingConflicts?.queue).toHaveLength(1);
    expect(mock.fs.move).not.toHaveBeenCalled();
  });
});
