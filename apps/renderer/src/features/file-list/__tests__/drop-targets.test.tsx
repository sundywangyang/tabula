import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutNode, Tab, TabulaAPI } from '@tabula/bridge';
import { Breadcrumb } from '../../../components/Breadcrumb';
import { Sidebar } from '../../../components/Sidebar';
import { TabBar } from '../../panes/TabBar';
import { useFileStore } from '../../../stores/file-store';
import { useFavoritesStore } from '../../../stores/favorites-store';
import { useLayoutStore } from '../../../stores/layout-store';

const tab: Tab = { id: 'tab', type: 'folder', title: 'Target', path: 'C:/target', pinned: false, closable: true, history: ['C:/target'], historyIndex: 0 };
const pane: Extract<LayoutNode, { type: 'pane' }> = { type: 'pane', id: 'p', tabs: [tab], activeTabId: tab.id };
const bulk = vi.fn(async () => ({ ok: true, moved: 1 }));
let root: Root;
let container: HTMLDivElement;

function sendDrag(target: Element, type: string, transfer: { dropEffect: string }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, altKey: true, ctrlKey: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event);
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.tabula = { fs: { listDrives: vi.fn(async () => []) }, extensions: { getPanels: vi.fn(async () => []) }, config: { set: vi.fn(async () => {}) } } as unknown as TabulaAPI;
  bulk.mockClear();
  useFileStore.setState({ dragState: { paths: ['C:/source/a.txt'], sourcePaneId: 'p', targetPath: null, targetKind: null, effect: 'copy' }, performBulk: bulk });
  useFavoritesStore.setState({ favorites: [{ id: 'favorite', path: 'C:/target', label: 'Target', addedAt: 0 }], history: [] });
  useLayoutStore.setState({ rootLayout: pane, activePaneId: 'p', tabDrag: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('internal file drop targets', () => {
  it.each(['breadcrumb', 'sidebar', 'tab'] as const)('%s moves files even with Ctrl held', async (kind) => {
    await act(async () => {
      if (kind === 'breadcrumb') root.render(<Breadcrumb segments={[{ name: 'Target', path: 'C:/target' }]} onNavigate={() => {}} onOpenPicker={() => {}} />);
      if (kind === 'sidebar') root.render(<Sidebar currentPath="C:/source" onOpenPath={() => {}} />);
      if (kind === 'tab') root.render(<TabBar paneId="p" pane={pane} />);
    });
    const target = kind === 'breadcrumb' ? container.querySelector('.breadcrumb-segment') :
      kind === 'sidebar' ? container.querySelector('.sidebar-item') : container.querySelector('[data-tab-index="0"]');
    expect(target).not.toBeNull();
    const transfer = { dropEffect: '' };
    await act(async () => sendDrag(target!, 'dragover', transfer));
    expect(transfer.dropEffect).toBe('move');
    await act(async () => sendDrag(target!, 'drop', transfer));
    expect(bulk).toHaveBeenCalledOnce();
    expect(bulk).toHaveBeenCalledWith(['C:/source/a.txt'], 'C:/target', 'move', 'p');
  });
});
