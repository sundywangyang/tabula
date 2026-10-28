import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsEntry, TabulaAPI } from '@tabula/bridge';
import { FileList } from '../FileList';
import { emptyPaneData } from '../../../stores/file/pane-data';
import { useFileStore } from '../../../stores/file-store';
import { useLayoutStore } from '../../../stores/layout-store';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 28, size: 28 })),
    measure: () => {},
  }),
}));
vi.mock('../../../perf/use-file-list-perf', () => ({ useFileListPerfReport: () => {} }));

const entry = (name: string, isDirectory = false): FsEntry => ({
  name, path: `C:/work/${name}`, isDirectory, isFile: !isDirectory, isSymlink: false,
  size: 0, mtime: 0, atime: 0, ctime: 0, birthtime: 0, ext: '', mode: 0,
});
const files = [entry('a'), entry('b'), entry('folder', true)];
let container: HTMLDivElement;
let root: Root;
let transfer: { types: string[]; files: File[]; effectAllowed: string; dropEffect: string; setData: ReturnType<typeof vi.fn> };
const bulk = vi.fn(async () => ({ ok: true, moved: 1 }));
const nativeDrag = vi.fn(() => ({ ok: true, data: undefined }));

function event(target: Element, type: string, options: MouseEventInit = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
  Object.defineProperty(e, 'dataTransfer', { value: transfer });
  target.dispatchEvent(e);
  return e;
}
function row(name: string) {
  const el = [...container.querySelectorAll<HTMLElement>('[data-entry-path]')].find(x => x.dataset.entryPath === `C:/work/${name}`);
  if (!el) throw new Error(`Missing row ${name}`);
  return el;
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.tabula = { fs: { startDrag: nativeDrag, getPathForFile: () => 'C:/external' }, tags: { get: vi.fn(async () => ({ ok: true, data: [] })) } } as unknown as TabulaAPI;
  transfer = { types: [], files: [], effectAllowed: '', dropEffect: '', setData: vi.fn() };
  bulk.mockClear(); nativeDrag.mockClear();
  useFileStore.setState({ panes: { p: { ...emptyPaneData(), currentPath: 'C:/work', entries: files } }, dragState: null, performBulk: bulk });
  useLayoutStore.setState({ activePaneId: 'p' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<FileList paneId="p" onOpenEntry={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('file drag', () => {
  it('starts from an unselected file and moves it into a folder', async () => {
    await act(async () => event(row('a'), 'dragstart'));
    expect(useFileStore.getState().dragState?.paths).toEqual(['C:/work/a']);
    expect(nativeDrag).not.toHaveBeenCalled();
    await act(async () => event(row('folder'), 'dragover'));
    expect(row('folder').classList.contains('file-drop-target')).toBe(true);
    await act(async () => event(row('folder'), 'drop'));
    expect(bulk).toHaveBeenCalledWith(['C:/work/a'], 'C:/work/folder', 'move', 'p');
  });

  it('keeps a multi-selection and copies it with Ctrl', async () => {
    await act(async () => useFileStore.setState(s => ({ panes: { ...s.panes, p: { ...s.panes.p, selectedPaths: new Set(['C:/work/a', 'C:/work/b']) } } })));
    await act(async () => event(row('a'), 'dragstart'));
    await act(async () => event(row('folder'), 'dragover', { ctrlKey: true }));
    await act(async () => event(row('folder'), 'drop', { ctrlKey: true }));
    expect(bulk).toHaveBeenCalledWith(['C:/work/a', 'C:/work/b'], 'C:/work/folder', 'copy', 'p');
  });

  it('does not clear selection on grid item mousedown and drags only an unselected item', async () => {
    await act(async () => useFileStore.setState(s => ({ panes: { ...s.panes, p: { ...s.panes.p, viewMode: 'grid', selectedPaths: new Set(['C:/work/a']) } } })));
    await act(async () => event(row('b'), 'mousedown'));
    expect([...useFileStore.getState().panes.p.selectedPaths]).toEqual(['C:/work/a']);
    await act(async () => event(row('b'), 'dragstart'));
    expect(useFileStore.getState().dragState?.paths).toEqual(['C:/work/b']);
  });

  it('copies an external file to the folder under the pointer', async () => {
    transfer.types = ['Files']; transfer.files = [new File(['x'], 'external')];
    await act(async () => event(row('folder'), 'drop'));
    expect(bulk).toHaveBeenCalledWith(['C:/external'], 'C:/work/folder', 'copy', 'p');
  });

  it('does not start a native drag when leaving an element inside the window', async () => {
    await act(async () => event(row('a'), 'dragstart'));
    await act(async () => event(row('a'), 'dragleave'));
    expect(nativeDrag).not.toHaveBeenCalled();
    expect(useFileStore.getState().dragState?.paths).toEqual(['C:/work/a']);
  });
});
