import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { AppConfig, SavedSearch } from '@tabula/bridge';
import { seedFiles } from '../../../stores/__tests__/file-fixtures';
import { useFileStore } from '../../../stores/file-store';
import { GlobalSearch } from '../GlobalSearch';

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('saves a combined search and applies it again from the saved list', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  await seedFiles();
  let saved: SavedSearch[] = [];
  window.tabula.config.all = vi.fn(async () => ({ savedSearches: saved }) as AppConfig);
  window.tabula.config.set = vi.fn(async (key, value) => { if (key === 'savedSearches') saved = value as SavedSearch[]; });
  window.tabula.fs.search = vi.fn(async () => ({ ok: true as const, data: { entries: [], total: 0, elapsedMs: 1, truncated: false } }));
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => { root.render(<GlobalSearch />); await useFileStore.getState().openGlobalSearch(); });
    await act(async () => setInput(container.querySelector<HTMLInputElement>('[aria-label="最小大小 MB"]')!, '2'));
    await act(async () => setInput(container.querySelector<HTMLInputElement>('[aria-label="搜索名称"]')!, '大文档'));
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '文档')!.click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '保存搜索')!.click());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: '大文档', fileType: 'document', minSize: 2097152 });
    const select = container.querySelector<HTMLSelectElement>('[aria-label="已保存的搜索"]')!;
    await act(async () => { select.value = saved[0].id; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(window.tabula.fs.search).toHaveBeenLastCalledWith(expect.objectContaining({ fileType: 'document', minSize: 2097152 }));
  } finally { await act(async () => root.unmount()); useFileStore.getState().closeGlobalSearch(); container.remove(); }
});
