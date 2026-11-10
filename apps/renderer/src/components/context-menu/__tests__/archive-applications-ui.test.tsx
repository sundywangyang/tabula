import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ContextMenu } from '../../ContextMenu';
import { setGlobalState } from '../state';
import { deferred, entry, seedFiles } from '../../../stores/__tests__/file-fixtures';
import type { ArchiveApplication } from '@tabula/bridge';

it('updates an already open archive submenu when installed software is found', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; await seedFiles();
  const pending = deferred<ArchiveApplication[]>(); window.tabula.fs.getArchiveApplications = vi.fn(() => pending.promise);
  window.tabula.fs.openWithArchiveApplication = vi.fn(async () => ({ method: 'application' as const }));
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const file = entry('C:\\folder\\文件.rar');
  setGlobalState({ paneId: 'p', entry: file, visible: true, pos: { x: 100, y: 100 } });
  try {
    await act(async () => root.render(<ContextMenu />));
    const item = [...element.querySelectorAll('button')].find(button => button.textContent?.includes('压缩/解压'))!;
    await act(async () => item.click());
    expect(document.querySelector('.submenu-panel')?.textContent).toContain('正在查询系统应用');
    await act(async () => pending.resolve([{ id: '7zip', name: '7-Zip' }]));
    const button = [...document.querySelectorAll<HTMLButtonElement>('.submenu-panel button')].find(item => item.textContent?.includes('使用 7-Zip 打开'))!;
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(window.tabula.fs.openWithArchiveApplication).toHaveBeenCalledWith(file.path, '7zip');
  } finally {
    await act(async () => { setGlobalState({ paneId: null, entry: null, visible: false, pos: { x: 0, y: 0 } }); root.unmount(); });
    element.remove();
  }
});
