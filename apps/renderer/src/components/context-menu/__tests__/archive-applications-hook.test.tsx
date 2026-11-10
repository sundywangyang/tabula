import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useArchiveApplications } from '../use-archive-applications';
import { deferred, seedFiles } from '../../../stores/__tests__/file-fixtures';
import type { ArchiveApplication } from '@tabula/bridge';

it('ignores a delayed result from an earlier menu and stops loading after closure', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; await seedFiles();
  const first = deferred<ArchiveApplication[]>(); const second = deferred<ArchiveApplication[]>();
  window.tabula.fs.getArchiveApplications = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  function Preview({ path }: { path: string | null }) { const result = useArchiveApplications(path); return <div>{result?.loading ? 'loading' : result?.apps.map(app => app.name).join(',')}</div>; }
  try {
    await act(async () => root.render(<Preview path="C:\\old.rar" />));
    await act(async () => root.render(<Preview path="C:\\new.zip" />));
    await act(async () => first.resolve([{ id: 'winrar', name: 'old' }]));
    expect(element.textContent).toBe('loading');
    await act(async () => second.resolve([{ id: '7zip', name: 'new' }]));
    expect(element.textContent).toBe('new');
    await act(async () => root.render(<Preview path={null} />));
    expect(element.textContent).toBe('');
  } finally { await act(async () => root.unmount()); element.remove(); }
});
