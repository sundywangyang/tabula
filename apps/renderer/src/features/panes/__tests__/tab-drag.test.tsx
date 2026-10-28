import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutNode, Tab, TabulaAPI } from '@tabula/bridge';
import { TabBar } from '../TabBar';
import { useLayoutStore } from '../../../stores/layout-store';
import { useFileStore } from '../../../stores/file-store';

const tab = (id: string): Tab => ({ id, type: 'folder', title: id, path: `C:/${id}`, pinned: false, closable: true, history: [`C:/${id}`], historyIndex: 0 });
const pane = (id: string, tabs: Tab[]): Extract<LayoutNode, { type: 'pane' }> => ({ type: 'pane', id, tabs, activeTabId: tabs[0]?.id ?? null });
let container: HTMLDivElement;
let root: Root;
let hit: Element | null;

function panes() {
  const layout = useLayoutStore.getState().rootLayout;
  if (layout.type !== 'split') throw new Error('Expected split');
  return layout.children as Extract<LayoutNode, { type: 'pane' }>[];
}

function Bars() {
  const layout = useLayoutStore(s => s.rootLayout);
  if (layout.type !== 'split') return null;
  return <>{layout.children.map(node => node.type === 'pane' && <TabBar key={node.id} paneId={node.id} pane={node} />)}</>;
}

function point(type: string, target: Element | Window, x: number, y = 10) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.tabula = { config: { set: vi.fn(async () => {}), all: vi.fn(async () => ({})) }, fs: { listDir: vi.fn(async () => ({ ok: true, data: { entries: [] } })) } } as unknown as TabulaAPI;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  useFileStore.setState({ panes: {} });
  useLayoutStore.setState({ rootLayout: { type: 'split', id: 'split', dir: 'horizontal', sizes: [50, 50], children: [pane('left', [tab('a'), tab('b')]), pane('right', [tab('c')])] }, activePaneId: 'left', tabDrag: null });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
  await act(async () => root.render(<Bars />));
  [...container.querySelectorAll<HTMLElement>('[data-tab-index]')].forEach((chip, index) => {
    const left = index < 2 ? index * 100 : 400;
    chip.getBoundingClientRect = () => ({ left, right: left + 100, top: 0, bottom: 30, width: 100, height: 30, x: left, y: 0, toJSON() {} });
  });
  await act(async () => { await useFileStore.getState().loadDir('left', 'C:/a'); });
});

afterEach(async () => { await act(async () => root.unmount()); container.remove(); Reflect.deleteProperty(document, 'elementFromPoint'); vi.restoreAllMocks(); });

describe('tab drag between panes', () => {
  it('moves to the target bar after its last tab and refreshes the source active folder', async () => {
    const source = container.querySelector('[data-pane-id="left"][data-tab-index="0"]')!;
    hit = container.querySelector('[data-tab-bar-pane-id="right"] .tab-add');
    await act(async () => point('pointerdown', source, 20));
    await act(async () => point('pointermove', window, 540));
    expect(useLayoutStore.getState().tabDrag?.dropTarget).toEqual({ paneId: 'right', index: 0, side: 'right' });
    await act(async () => point('pointerup', window, 540));
    expect(panes().map(p => p.tabs.map(t => t.id))).toEqual([['b'], ['c', 'a']]);
    expect(panes().map(p => p.activeTabId)).toEqual(['b', 'a']);
    expect(useLayoutStore.getState().activePaneId).toBe('right');
    expect(useFileStore.getState().panes.left.currentPath).toBe('C:/b');
    expect(useFileStore.getState().panes.right.currentPath).toBe('C:/a');
  });

  it('moves into an empty pane and clears the old folder when the source becomes empty', async () => {
    await act(async () => useLayoutStore.setState({ rootLayout: { type: 'split', id: 'split', dir: 'horizontal', sizes: [50, 50], children: [pane('left', [tab('a')]), pane('right', [])] } }));
    const source = container.querySelector('[data-pane-id="left"][data-tab-index="0"]')!;
    hit = container.querySelector('[data-tab-bar-pane-id="right"] .tab-add');
    await act(async () => point('pointerdown', source, 20));
    await act(async () => point('pointermove', window, 500));
    await act(async () => point('pointerup', window, 500));
    expect(panes().map(p => p.tabs.map(t => t.id))).toEqual([[], ['a']]);
    expect(useFileStore.getState().panes.left.currentPath).toBe('');
  });

  it('reorders in the same pane and ignores a release outside any tab bar', async () => {
    const source = container.querySelector('[data-pane-id="left"][data-tab-index="0"]')!;
    hit = container.querySelector('[data-pane-id="left"][data-tab-index="1"]');
    await act(async () => point('pointerdown', source, 20));
    await act(async () => point('pointermove', window, 180));
    await act(async () => point('pointerup', window, 180));
    expect(panes()[0].tabs.map(t => t.id)).toEqual(['b', 'a']);
    const moved = container.querySelector('[data-pane-id="left"][data-tab-index="1"]')!;
    hit = container.querySelector('[data-tab-bar-pane-id="right"]');
    await act(async () => point('pointerdown', moved, 180));
    await act(async () => point('pointermove', window, 450));
    hit = document.body;
    await act(async () => point('pointerup', window, 600));
    expect(panes().map(p => p.tabs.map(t => t.id))).toEqual([['b', 'a'], ['c']]);
  });

  it('clears stale directory data when a moved tab has no folder path', async () => {
    const blank = { ...tab('blank'), path: '', history: [], historyIndex: -1 };
    await act(async () => useLayoutStore.setState({ rootLayout: { type: 'split', id: 'split', dir: 'horizontal', sizes: [50, 50], children: [pane('left', [blank]), pane('right', [tab('c')])] } }));
    await act(async () => { await useFileStore.getState().loadDir('right', 'C:/c'); });
    await act(async () => useLayoutStore.getState().pane.moveTab('left', 'blank', 'right', 1));
    expect(panes()[1].activeTabId).toBe('blank');
    expect(useFileStore.getState().panes.right.currentPath).toBe('');
  });
});
