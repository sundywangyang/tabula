import { vi } from 'vitest';
import type { FsEntry, TabulaAPI } from '@tabula/bridge';
import { useLayoutStore } from '../layout-store';
import { makeFolderTab, useFileStore } from '../file-store';
import { initPlatformCache } from '../../platform-cache';

export function entry(path: string): FsEntry {
  return { name: path.split(/[\\/]/).at(-1)!, path, isDirectory: false, isFile: true, isSymlink: false,
    size: 1, mtime: 1, atime: 1, ctime: 1, birthtime: 1, ext: '.txt', mode: 0o644 };
}

export function listing(path: string, names = ['a.txt']) {
  return { ok: true as const, data: { path, entries: names.map((name) => entry(`${path}\\${name}`)), total: names.length } };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function seedFiles() {
  const mock = {
    config: { all: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
    platform: { get: vi.fn(async () => 'windows'), defaultRootPath: vi.fn(async () => 'C:\\') },
    fs: {
      listDir: vi.fn(async (path: string) => listing(path)),
      exists: vi.fn(async (_path: string) => false),
      stat: vi.fn(async (_path: string): Promise<any> => ({ ok: false, error: { code: 'ENOENT', message: 'missing' } })),
      copy: vi.fn(async (_request: unknown) => ({ ok: true as const, data: undefined })),
      move: vi.fn(async (_request: unknown) => ({ ok: true as const, data: undefined })),
      undo: vi.fn(async (): Promise<any> => ({ ok: true, data: null })),
      redo: vi.fn(async (): Promise<any> => ({ ok: true, data: null })),
      openPath: vi.fn(async () => undefined),
    },
  };
  window.tabula = mock as unknown as TabulaAPI;
  useFileStore.setState({ panes: {}, toasts: [], pendingConflicts: null, clipboard: null, progress: null, previewState: null,
    pathBarOpen: false, globalSearch: { ...useFileStore.getState().globalSearch, open: false } });
  const tab = makeFolderTab('C:\\initial');
  useLayoutStore.setState({ rootLayout: { type: 'pane', id: 'p', tabs: [tab], activeTabId: tab.id }, activePaneId: 'p', hydrated: true });
  await useFileStore.getState().ensurePane('p');
  await initPlatformCache();
  return mock;
}
