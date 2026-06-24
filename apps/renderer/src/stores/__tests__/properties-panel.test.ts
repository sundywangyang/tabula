/**
 * ui-dialogs-store propertiesPanel 单测 (G003)
 *
 * 覆盖:
 * - 默认值: open=false, paneId=null, entry=null
 * - openPropertiesPanel(paneId, entry) → open=true, paneId=..., entry=...
 * - closePropertiesPanel() → open=false, paneId=null, entry=null
 * - closePropertiesPanel 在已关闭状态下是 no-op(不报错)
 * - 再次 openPropertiesPanel 可以覆盖前一个 entry
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
import type { FsEntry } from '@tabula/bridge';
import { useUiDialogsStore } from '../ui-dialogs-store';

function makeEntry(overrides: Partial<FsEntry> = {}): FsEntry {
  return {
    name: 'demo.txt',
    path: 'C:\\Users\\me\\demo.txt',
    isDirectory: false,
    isSymlink: false,
    isHidden: false,
    size: 1234,
    mtime: 1_700_000_000_000,
    atime: 1_700_000_500_000,
    birthtime: 1_699_000_000_000,
    ext: '.txt',
    ...overrides,
  } as FsEntry;
}

describe('ui-dialogs-store propertiesPanel', () => {
  beforeEach(() => {
    useUiDialogsStore.setState({
      propertiesPanel: { open: false, paneId: null, entry: null },
    });
  });

  it('默认值:closed / null / null', () => {
    const s = useUiDialogsStore.getState();
    expect(s.propertiesPanel.open).toBe(false);
    expect(s.propertiesPanel.paneId).toBeNull();
    expect(s.propertiesPanel.entry).toBeNull();
  });

  it('openPropertiesPanel 设置 open=true, paneId, entry', () => {
    const entry = makeEntry();
    useUiDialogsStore.getState().openPropertiesPanel('pane-1', entry);
    const pp = useUiDialogsStore.getState().propertiesPanel;
    expect(pp.open).toBe(true);
    expect(pp.paneId).toBe('pane-1');
    expect(pp.entry).toEqual(entry);
  });

  it('openPropertiesPanel 保留 entry 的所有字段(size/mtime/atime/path)', () => {
    const entry = makeEntry({
      name: 'big.bin',
      path: '/tmp/big.bin',
      size: 9_999_999,
      mtime: 1_700_000_001,
      atime: 1_700_000_002,
      birthtime: 1_700_000_003,
    });
    useUiDialogsStore.getState().openPropertiesPanel('pane-2', entry);
    const stored = useUiDialogsStore.getState().propertiesPanel.entry;
    expect(stored?.name).toBe('big.bin');
    expect(stored?.path).toBe('/tmp/big.bin');
    expect(stored?.size).toBe(9_999_999);
    expect(stored?.mtime).toBe(1_700_000_001);
    expect(stored?.atime).toBe(1_700_000_002);
    expect(stored?.birthtime).toBe(1_700_000_003);
  });

  it('openPropertiesPanel 再次调用会覆盖 entry', () => {
    const a = makeEntry({ name: 'a.txt' });
    const b = makeEntry({ name: 'b.txt' });
    useUiDialogsStore.getState().openPropertiesPanel('pane-1', a);
    useUiDialogsStore.getState().openPropertiesPanel('pane-2', b);
    const pp = useUiDialogsStore.getState().propertiesPanel;
    expect(pp.open).toBe(true);
    expect(pp.paneId).toBe('pane-2');
    expect(pp.entry?.name).toBe('b.txt');
  });

  it('closePropertiesPanel 清空 open/paneId/entry', () => {
    useUiDialogsStore
      .getState()
      .openPropertiesPanel('pane-1', makeEntry({ name: 'x.txt' }));
    useUiDialogsStore.getState().closePropertiesPanel();
    const pp = useUiDialogsStore.getState().propertiesPanel;
    expect(pp.open).toBe(false);
    expect(pp.paneId).toBeNull();
    expect(pp.entry).toBeNull();
  });

  it('closePropertiesPanel 在 closed 状态下调用不抛错', () => {
    expect(() =>
      useUiDialogsStore.getState().closePropertiesPanel(),
    ).not.toThrow();
    expect(useUiDialogsStore.getState().propertiesPanel.open).toBe(false);
  });
});
