import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SidebarTree } from '../SidebarTree';
import { seedFiles, entry, deferred } from '../../stores/__tests__/file-fixtures';

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; await seedFiles(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it('loads folder children on expansion and navigates when a child is selected', async () => {
  const open = vi.fn();
  vi.mocked(window.tabula.fs.listDir).mockResolvedValue({ ok: true, data: { path: 'C:\\root', entries: [
    { ...entry('C:\\root\\子目录'), isDirectory: true, isFile: false }, entry('C:\\root\\file.txt'),
  ], total: 2 } });
  await act(async () => root.render(<div className="sidebar-item"><SidebarTree path="C:\\root" currentPath="" onOpenPath={open} /></div>));
  expect(window.tabula.fs.listDir).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click());
  expect(container.textContent).toContain('子目录');
  expect(container.textContent).not.toContain('file.txt');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('子目录'))!.click());
  expect(open).toHaveBeenCalledWith('C:\\root\\子目录');
});

it('ignores a late listing after its branch is collapsed', async () => {
  const pending = deferred<any>();
  vi.mocked(window.tabula.fs.listDir).mockReturnValue(pending.promise);
  await act(async () => root.render(<SidebarTree path="C:\\root" currentPath="" onOpenPath={() => {}} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => pending.resolve({ ok: true, data: { path: 'C:\\root', entries: [{ ...entry('C:\\root\\late'), isDirectory: true }], total: 1 } }));
  expect(container.textContent).not.toContain('late');
});

it('routes a drop on an expanded child to that child rather than the parent favorite', async () => {
  const drop = vi.fn(); const parentDrop = vi.fn();
  vi.mocked(window.tabula.fs.listDir).mockResolvedValue({ ok: true, data: { path: 'C:\\root', entries: [
    { ...entry('C:\\root\\child'), isDirectory: true, isFile: false },
  ], total: 1 } });
  await act(async () => root.render(<div onDrop={parentDrop}><SidebarTree path="C:\\root" currentPath="" onOpenPath={() => {}} onDrop={drop} /></div>));
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => container.querySelector('.sidebar-tree-item')!.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true })));
  expect(drop).toHaveBeenCalledWith(expect.anything(), 'C:\\root\\child');
  expect(parentDrop).not.toHaveBeenCalled();
});
