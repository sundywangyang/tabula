import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileStore } from '../file-store';
import { seedFiles } from './file-fixtures';

vi.mock('../../platform-cache', async (load) => ({ ...(await load<typeof import('../../platform-cache')>()), getCachedPlatform: () => 'windows' }));
let mock: Awaited<ReturnType<typeof seedFiles>>;
let originalPerform: ReturnType<typeof useFileStore.getState>['performBulk'];
beforeEach(async () => {
  mock = await seedFiles();
  originalPerform = useFileStore.getState().performBulk;
  Object.assign(mock.fs, {
    readFileClipboard: vi.fn(), writeFileClipboard: vi.fn(), clearFileClipboard: vi.fn(),
  });
  await useFileStore.getState().loadDir('p', 'C:\\initial');
});
afterEach(() => { useFileStore.setState({ performBulk: originalPerform }); vi.restoreAllMocks(); });

describe('Windows file clipboard integration', () => {
  it('pastes the current external file clipboard instead of stale internal paths', async () => {
    const performBulk = vi.fn(async () => ({ ok: true, moved: 1 }));
    useFileStore.setState({ clipboard: { mode: 'copy', paths: ['C:\\old.txt'], sourcePaneId: 'p' }, performBulk });
    (mock.fs as any).readFileClipboard.mockResolvedValue({ ok: true, data: { paths: ['C:\\外部.txt'], mode: 'cut', sequence: 10 } });
    await useFileStore.getState().pasteToPane('p');
    expect(performBulk).toHaveBeenCalledWith(['C:\\外部.txt'], 'C:\\initial', 'move', 'p');
  });

  it('does not paste stale files when the system clipboard contains text or cannot be read', async () => {
    const performBulk = vi.fn(async () => ({ ok: true, moved: 1 }));
    useFileStore.setState({ clipboard: { mode: 'copy', paths: ['C:\\old.txt'], sourcePaneId: 'p' }, performBulk });
    (mock.fs as any).readFileClipboard.mockResolvedValue({ ok: true, data: { paths: [], mode: 'copy', sequence: 11 } });
    await useFileStore.getState().pasteToPane('p');
    expect(performBulk).not.toHaveBeenCalled();
    expect(useFileStore.getState().clipboard).toBeNull();
    useFileStore.setState({ clipboard: { mode: 'copy', paths: ['C:\\old.txt'], sourcePaneId: 'p' } });
    (mock.fs as any).readFileClipboard.mockResolvedValue({ ok: false, error: { code: 'UNKNOWN', message: 'locked' } });
    await useFileStore.getState().pasteToPane('p');
    expect(performBulk).not.toHaveBeenCalled();
    expect(useFileStore.getState().clipboard).toBeNull();
  });
});
