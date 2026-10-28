import { describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@tabula/bridge';

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), sendSync: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn(() => 'C:\\dropped\\a.txt') },
}));
vi.mock('electron', () => electron);
import '../../../preload/index';

const api = electron.contextBridge.exposeInMainWorld.mock.calls[0][1] as import('@tabula/bridge').TabulaAPI;

describe('preload contracts', () => {
  it('resolves native files with webUtils instead of the removed File.path', () => {
    const file = new File(['example'], 'a.txt');
    expect((file as File & { path?: string }).path).toBeUndefined();
    expect(api.fs.getPathForFile(file)).toBe('C:\\dropped\\a.txt');
    expect(electron.webUtils.getPathForFile).toHaveBeenCalledWith(file);
  });

  it('forwards one batch-rename request', () => {
    const items = [{ oldPath: 'C:\\a', newPath: 'C:\\b' }];
    void api.fs.batchRename(items);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.FS_BATCH_RENAME, items);
  });

  it('loads RTF HTML through the main process', () => {
    void api.fs.readRtf('C:\\a.rtf');
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.FS_READ_RTF, 'C:\\a.rtf');
  });
});
