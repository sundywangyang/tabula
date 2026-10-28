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
    expect(mock.fs.move.mock.calls.every(([request]) => (request as { sources: string[] }).sources.length === 0)).toBe(true);
  });
});
