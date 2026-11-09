import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result, TrashEntry } from '@tabula/bridge';
import { useFileStore } from '../file-store';
import { seedFiles } from './file-fixtures';

const items: TrashEntry[] = ['first.txt', 'second.txt'].map((name, index) => ({
  name, itemPath: `/trash/${name}`, originalPath: index === 0 ? null : `/original/${name}`,
  deletedTime: 1, size: 1, isDirectory: false,
}));
const paths = items.map(item => item.itemPath);
let trashRestore: ReturnType<typeof vi.fn<(path: string, originalPath?: string) => Promise<Result<void>>>>;
let trashList: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  const mock = await seedFiles();
  trashRestore = vi.fn(async () => ({ ok: true as const, data: undefined }));
  trashList = vi.fn(async () => ({ ok: true, data: { entries: [], total: 0 } }));
  Object.assign(mock.fs, { trashRestore, trashList });
  useFileStore.setState({ trashItems: items, trashLoading: false, trashError: null });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('trash restore feedback', () => {
  it('reports complete failure with the first reason and preserves the original restore arguments', async () => {
    const reason = '目标已存在，文件仍保留在废纸篓: /Desktop/first.txt';
    trashRestore.mockResolvedValueOnce({ ok: false, error: { code: 'EEXIST', message: reason } });
    trashRestore.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN', message: 'later error' } });
    expect(await useFileStore.getState().restoreTrashItems(paths)).toEqual({ ok: false });
    expect(useFileStore.getState().toasts).toMatchObject([{
      message: `恢复失败（2 项）: ${reason}`, kind: 'error',
    }]);
    expect(trashRestore).toHaveBeenNthCalledWith(1, paths[0], undefined);
    expect(trashRestore).toHaveBeenNthCalledWith(2, paths[1], '/original/second.txt');
    expect(trashList).toHaveBeenCalledTimes(1);
  });

  it('reports successful and failed counts with the source-preservation reason', async () => {
    const reason = '无法跨磁盘恢复，文件仍保留在废纸篓，请在 Finder 中恢复';
    trashRestore.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN', message: reason } });
    expect(await useFileStore.getState().restoreTrashItems(paths)).toEqual({ ok: false });
    expect(useFileStore.getState().toasts).toMatchObject([{
      message: `已恢复 1 项，1 项失败: ${reason}`, kind: 'warn',
    }]);
    expect(trashRestore).toHaveBeenCalledTimes(2);
    expect(trashList).toHaveBeenCalledTimes(1);
  });

  it('reports success when every item was restored', async () => {
    expect(await useFileStore.getState().restoreTrashItems(paths)).toEqual({ ok: true });
    expect(useFileStore.getState().toasts).toMatchObject([{ message: '已恢复 2 项', kind: 'success' }]);
    expect(trashList).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no selected items', async () => {
    expect(await useFileStore.getState().restoreTrashItems([])).toEqual({ ok: true });
    expect(trashRestore).not.toHaveBeenCalled();
    expect(trashList).not.toHaveBeenCalled();
    expect(useFileStore.getState().toasts).toEqual([]);
  });
});
