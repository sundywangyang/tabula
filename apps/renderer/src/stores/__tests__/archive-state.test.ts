import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabulaAPI } from '@tabula/bridge';
import { useFileStore } from '../file-store';
import { seedFiles } from './file-fixtures';

const archive = {
  compress: vi.fn<TabulaAPI['archive']['compress']>(async () => ({ ok: true, data: { jobId: 'compress' } })),
  extract: vi.fn<TabulaAPI['archive']['extract']>(async () => ({ ok: true, data: { jobId: 'extract' } })),
  cancelJob: vi.fn<TabulaAPI['archive']['cancelJob']>(async () => ({ ok: true, data: undefined })),
};
let bridge: Awaited<ReturnType<typeof seedFiles>> & {
  fs: { saveDialog: ReturnType<typeof vi.fn<TabulaAPI['fs']['saveDialog']>>; pickDirectory: ReturnType<typeof vi.fn<TabulaAPI['fs']['pickDirectory']>>; };
  archive: typeof archive;
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  const base = await seedFiles();
  bridge = {
    ...base,
    fs: {
      ...base.fs,
      saveDialog: vi.fn<TabulaAPI['fs']['saveDialog']>(async () => 'C:\\archive\\output.zip'),
      pickDirectory: vi.fn<TabulaAPI['fs']['pickDirectory']>(async () => 'C:\\output'),
    },
    archive,
  };
  window.tabula = bridge as unknown as TabulaAPI;
  useFileStore.setState({ archiveJobs: new Map(), archivePaneIds: new Map(), archiveToasts: new Map() });
  await useFileStore.getState().loadDir('p', 'C:\\initial');
  bridge.fs.listDir.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('archive operations through the composed file store', () => {
  it.each(['zip', 'tar', 'tgz'] as const)('keeps the %s save choice, sources and progress feedback', async format => {
    const sources = ['C:\\initial\\a.txt'];
    const destination = `C:\\archive\\output.${format}`;
    bridge.fs.saveDialog.mockResolvedValueOnce(destination);
    expect(await useFileStore.getState().startCompress(sources, 'p', format)).toEqual({ ok: true });
    expect(bridge.fs.saveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: `C:/initial/a.txt.${format}`,
      filters: [{ name: `${format.toUpperCase()} 归档`, extensions: [format] }],
    }));
    expect(archive.compress).toHaveBeenCalledWith({ sources, destination, sourcePaneId: 'p' });
    useFileStore.getState().updateArchiveJob({ jobId: 'compress', phase: 'compressing', processed: 1, total: 2, percent: 50, currentEntry: sources[0] });
    expect(useFileStore.getState().toasts).toEqual([expect.objectContaining({ message: '压缩 a.txt (50%)', duration: 0 })]);
  });

  it('does not create a job when the save dialog is cancelled', async () => {
    bridge.fs.saveDialog.mockResolvedValueOnce(null);
    expect(await useFileStore.getState().startCompress(['C:\\initial\\a.txt'], 'p')).toEqual({ ok: false, error: '已取消' });
    expect(archive.compress).not.toHaveBeenCalled();
    expect(useFileStore.getState().archiveJobs.size).toBe(0);
    expect(useFileStore.getState().toasts).toEqual([]);
  });

  it('reports extraction conflicts without registering a pending task', async () => {
    archive.extract.mockResolvedValueOnce({ ok: false, error: { code: 'DESTINATION_EXISTS', message: 'a.txt exists' } });
    const result = await useFileStore.getState().startExtract('C:\\archive\\a.tar', 'C:\\output', 'p');
    expect(result).toEqual({ ok: false, error: 'a.txt exists' });
    expect(archive.extract).toHaveBeenCalledWith({ archive: 'C:\\archive\\a.tar', destination: 'C:\\output', overwrite: false });
    expect(useFileStore.getState().archiveJobs.size).toBe(0);
    expect(useFileStore.getState().toasts[0]).toMatchObject({ kind: 'warn', message: '目标已存在,解压取消:a.txt exists' });
  });

  it('refreshes the originating pane on completion and leaves other jobs active', async () => {
    await useFileStore.getState().startCompress(['C:\\initial\\a.txt'], 'p');
    await useFileStore.getState().startExtract('C:\\archive\\b.tgz', 'C:\\output', 'p');
    useFileStore.getState().updateArchiveJob({ jobId: 'compress', phase: 'done', processed: 1, total: 1 });
    expect(bridge.fs.listDir).toHaveBeenCalledWith('C:\\initial');
    await vi.advanceTimersByTimeAsync(500);
    expect([...useFileStore.getState().archiveJobs.keys()]).toEqual(['extract']);
    expect([...useFileStore.getState().archiveToasts.keys()]).toEqual(['extract']);
    expect([...useFileStore.getState().archivePaneIds.keys()]).toEqual(['extract']);
  });

  it('forwards cancellation and clears progress when cancellation is acknowledged', async () => {
    await useFileStore.getState().startExtract('C:\\archive\\a.zip', undefined, 'p');
    expect(bridge.fs.pickDirectory).toHaveBeenCalledOnce();
    await useFileStore.getState().cancelArchive('extract');
    expect(archive.cancelJob).toHaveBeenCalledWith('extract');
    useFileStore.getState().updateArchiveJob({ jobId: 'extract', phase: 'cancelled', processed: 0, total: 1 });
    expect(useFileStore.getState().toasts).toEqual([expect.objectContaining({ message: '已取消', kind: 'info' })]);
    await vi.advanceTimersByTimeAsync(500);
    expect(useFileStore.getState().archiveJobs.size).toBe(0);
  });

  it('keeps an error visible while removing its completed task bookkeeping', async () => {
    await useFileStore.getState().startCompress(['C:\\initial\\a.txt'], 'p');
    useFileStore.getState().updateArchiveJob({ jobId: 'compress', phase: 'error', processed: 0, total: 1, error: { code: 'ARCHIVE_INVALID', message: 'broken archive' } });
    expect(useFileStore.getState().toasts).toEqual([expect.objectContaining({ message: '归档失败: broken archive', kind: 'error' })]);
    expect(bridge.fs.listDir).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(useFileStore.getState().archiveJobs.size).toBe(0);
    expect(useFileStore.getState().archiveToasts.size).toBe(0);
    expect(useFileStore.getState().archivePaneIds.size).toBe(0);
  });
});
