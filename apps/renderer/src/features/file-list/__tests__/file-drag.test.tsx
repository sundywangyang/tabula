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
const nativeDrag = vi.fn(() => new Promise<import('@tabula/bridge').Result<void>>(() => {}));
const prepareIcon = vi.fn();

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
  window.tabula = { fs: { startDrag: nativeDrag, prepareDragIcon: prepareIcon, getPathForFile: () => 'C:/external' }, tags: { get: vi.fn(async () => ({ ok: true, data: [] })) } } as unknown as TabulaAPI;
  transfer = { types: [], files: [], effectAllowed: '', dropEffect: '', setData: vi.fn() };
  bulk.mockClear(); nativeDrag.mockClear(); prepareIcon.mockClear();
  useFileStore.setState({ panes: { p: { ...emptyPaneData(), currentPath: 'C:/work', entries: files } }, dragState: null, performBulk: bulk });
  useLayoutStore.setState({ activePaneId: 'p' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<FileList paneId="p" onOpenEntry={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('file drag', () => {
  it('starts from an unselected file and moves it into a folder', async () => {
    let dragStart: MouseEvent;
    await act(async () => { dragStart = event(row('a'), 'dragstart', { altKey: true }); });
    expect(useFileStore.getState().dragState?.paths).toEqual(['C:/work/a']);
    expect(nativeDrag).not.toHaveBeenCalled();
    expect(dragStart!.defaultPrevented).toBe(false);
    await act(async () => event(row('folder'), 'dragover'));
    expect(row('folder').classList.contains('file-drop-target')).toBe(true);
    await act(async () => event(row('folder'), 'drop'));
    expect(bulk).toHaveBeenCalledWith(['C:/work/a'], 'C:/work/folder', 'move', 'p');
  });

  it('moves a multi-selection even when Ctrl is held', async () => {
    await act(async () => useFileStore.setState(s => ({ panes: { ...s.panes, p: { ...s.panes.p, selectedPaths: new Set(['C:/work/a', 'C:/work/b']) } } })));
    await act(async () => event(row('a'), 'dragstart', { altKey: true }));
    expect(nativeDrag).not.toHaveBeenCalled();
    await act(async () => event(row('folder'), 'dragover', { altKey: true, ctrlKey: true }));
    await act(async () => event(row('folder'), 'drop', { altKey: true, ctrlKey: true }));
    expect(transfer.effectAllowed).toBe('move');
    expect(transfer.dropEffect).toBe('move');
    expect(bulk).toHaveBeenCalledWith(['C:/work/a', 'C:/work/b'], 'C:/work/folder', 'move', 'p');
  });

  it('does nothing when an internal drag is released in the same directory', async () => {
    await act(async () => useFileStore.setState(s => ({ panes: { ...s.panes, p: { ...s.panes.p, currentPath: 'c:\\WORK\\' } } })));
    await act(async () => event(row('a'), 'dragstart', { altKey: true, ctrlKey: true }));
    await act(async () => event(row('a'), 'dragover', { altKey: true, ctrlKey: true }));
    await act(async () => event(row('a'), 'drop', { altKey: true, ctrlKey: true }));
    expect(bulk).not.toHaveBeenCalled();
    expect(useFileStore.getState().dragState).toBeNull();
  });

  it('does not clear selection on grid item mousedown and drags only an unselected item', async () => {
    await act(async () => useFileStore.setState(s => ({ panes: { ...s.panes, p: { ...s.panes.p, viewMode: 'grid', selectedPaths: new Set(['C:/work/a']) } } })));
    await act(async () => event(row('b'), 'mousedown'));
    expect([...useFileStore.getState().panes.p.selectedPaths]).toEqual(['C:/work/a']);
    await act(async () => event(row('b'), 'dragstart', { altKey: true }));
    expect(useFileStore.getState().dragState?.paths).toEqual(['C:/work/b']);
  });

  it('copies an external file to the folder under the pointer', async () => {
    transfer.types = ['Files']; transfer.files = [new File(['x'], 'external')];
    await act(async () => event(row('folder'), 'drop'));
    expect(bulk).toHaveBeenCalledWith(['C:/external'], 'C:/work/folder', 'copy', 'p');
  });

  it('starts the native drag on dragstart and does not restart it on dragleave', async () => {
    let dragStart: MouseEvent;
    await act(async () => { dragStart = event(row('a'), 'dragstart'); });
    expect(dragStart!.defaultPrevented).toBe(true);
    expect(nativeDrag).toHaveBeenCalledTimes(1);
    await act(async () => event(row('a'), 'dragleave'));
    expect(nativeDrag).toHaveBeenCalledTimes(1);
    expect(useFileStore.getState().dragState?.paths).toEqual(['C:/work/a']);
  });

  it('passes every selected item to the native drag', async () => {
    await act(async () => useFileStore.setState(s => ({ panes: { ...s.panes, p: { ...s.panes.p, selectedPaths: new Set(['C:/work/a', 'C:/work/b']) } } })));
    await act(async () => event(row('b'), 'dragstart'));
    expect(nativeDrag).toHaveBeenCalledWith(['C:/work/b', 'C:/work/a']);
  });

  it('prepares the hovered and pressed file icon before a drag', async () => {
    await act(async () => event(row('b'), 'mouseover'));
    await act(async () => event(row('b'), 'mousedown'));
    expect(prepareIcon).toHaveBeenCalledWith('C:/work/b');
    expect(nativeDrag).not.toHaveBeenCalled();
  });

  it('reports native drag failures and clears the drag state', async () => {
    nativeDrag.mockImplementationOnce(async () => ({ ok: false, error: { code: 'ENOENT', message: 'File not found' } }));
    await act(async () => event(row('a'), 'dragstart'));
    expect(useFileStore.getState().dragState).toBeNull();
    expect(useFileStore.getState().toasts.some(t => t.message.includes('File not found'))).toBe(true);
  });
});
