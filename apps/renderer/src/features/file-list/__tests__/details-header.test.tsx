import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { FolderViewSettings } from '@tabula/bridge';
import { DetailsHeader } from '../views/DetailsHeader';

it('toggles columns and persists the final dragged width without sorting', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const change = vi.fn(); const sort = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState<FolderViewSettings>({});
    return <DetailsHeader settings={settings} sortBy="name" sortDir="asc" onSort={sort} onChange={(patch, persist) => { change(patch, persist); setSettings(s => ({ ...s, ...patch })); }} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择显示的列"]')!.click());
    const checkbox = [...container.querySelectorAll<HTMLInputElement>('input')].find(item => item.parentElement?.textContent?.includes('类型'))!;
    await act(async () => checkbox.click());
    expect(container.querySelector('button.col-type')).toBeNull();
    expect(change).toHaveBeenLastCalledWith({ visibleColumns: { type: false } }, undefined);
    const handle = container.querySelector('[aria-label="调整大小列宽"]')!;
    await act(async () => handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200 })));
    await act(async () => window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 160 })));
    await act(async () => window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 160 })));
    expect(change).toHaveBeenLastCalledWith({ columnWidths: { size: 140 } }, undefined);
    expect(sort).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
