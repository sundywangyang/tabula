import { beforeEach, expect, it, vi } from 'vitest';
import { useFileStore } from '../file-store';
import { deferred, seedFiles } from './file-fixtures';

beforeEach(async () => { await seedFiles(); });
it('does not replace newer filtered results with an older request', async () => {
  const old = deferred<any>();
  window.tabula.fs.search = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, data: { entries: [], elapsedMs: 1, truncated: false } });
  await useFileStore.getState().openGlobalSearch();
  const first = useFileStore.getState().runGlobalSearch('old', 'C:\\', 'all');
  await useFileStore.getState().runGlobalSearch('', 'C:\\', 'all', { minSize: 10 });
  old.resolve({ ok: true, data: { entries: [{ path: 'C:\\old.txt', name: 'old.txt' }], elapsedMs: 1, truncated: false } });
  await first;
  expect(useFileStore.getState().globalSearch.results).toEqual([]);
  expect(useFileStore.getState().globalSearch.criteria?.minSize).toBe(10);
});

it('clears previous results when the current search fails', async () => {
  window.tabula.fs.search = vi.fn().mockResolvedValueOnce({ ok: true, data: { entries: [{ path: 'C:\\old.txt', name: 'old.txt' }], elapsedMs: 1, truncated: false } })
    .mockResolvedValueOnce({ ok: false, error: { code: 'ENOENT', message: '目录不存在' } });
  await useFileStore.getState().openGlobalSearch();
  await useFileStore.getState().runGlobalSearch('old', 'C:\\', 'all');
  await useFileStore.getState().runGlobalSearch('new', 'C:\\missing', 'all');
  expect(useFileStore.getState().globalSearch.results).toEqual([]);
  expect(useFileStore.getState().globalSearch.scanError).toBe('目录不存在');
});
