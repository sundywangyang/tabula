/**
 * file-store selectRect 单测 (G004 橡皮筋拖框)
 *
 * 覆盖:
 * - selectRect(paneId, paths):selectedPaths 被替换为新 Set
 * - selectRect(paneId, []):等价 clearSelection(cursorPath / lastClickedPath 也清掉)
 * - selectRect 之后 selectedPaths 是 Set(类型契约)
 * - 替换语义:先前 selection 不在 paths 中 → 被剔除
 * - 未知 paneId:安全 no-op
 * - selectRect 不影响其它 pane 的 selection
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
// 与 invert test 同样的导入顺序:先 layout-store 避免循环
import '../layout-store';
import { useFileStore, type PaneFileData } from '../file-store';
import type { FsEntry } from '@tabula/bridge';

const PANE_ID = 'pane-test-rect';
const OTHER_PANE = 'pane-test-rect-other';

function mkEntry(i: number): FsEntry {
  return {
    name: `file-${i}.txt`,
    path: `/path/${i}`,
    isDirectory: false,
    isFile: true,
    isSymlink: false,
    size: 1024 * i,
    mtime: Date.now(),
    atime: Date.now(),
    ctime: Date.now(),
    birthtime: Date.now(),
    ext: '.txt',
    mode: 0o644,
  };
}

function makeEntries(): FsEntry[] {
  const out: FsEntry[] = [];
  for (let i = 1; i <= 10; i++) out.push(mkEntry(i));
  return out;
}

function makePaneData(overrides: Partial<PaneFileData> = {}): PaneFileData {
  const entries = makeEntries();
  return {
    currentPath: '/test',
    breadcrumb: [],
    entries,
    loading: false,
    error: null,
    selectedPaths: new Set([entries[0]!.path, entries[2]!.path]),
    cursorPath: entries[0]!.path,
    lastClickedPath: entries[0]!.path,
    renameTarget: null,
    searchQuery: '',
    searchOpen: false,
    viewMode: 'details',
    groupBy: 'none',
    ...overrides,
  };
}

describe('file-store selectRect (G004 rubber-band)', () => {
  beforeEach(() => {
    useFileStore.setState({
      panes: {
        [PANE_ID]: makePaneData(),
        [OTHER_PANE]: makePaneData({
          selectedPaths: new Set(['/path/other-1']),
          cursorPath: '/path/other-1',
          lastClickedPath: '/path/other-1',
        }),
      },
      sortBy: 'name',
      sortDir: 'asc',
      showHidden: false,
    });
  });

  it('传入 3 个路径 → selectedPaths 是这 3 个路径的 Set', () => {
    useFileStore.getState().selectRect(PANE_ID, ['/path/1', '/path/3', '/path/5']);
    const sel = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    expect(sel).toBeInstanceOf(Set);
    expect(sel.size).toBe(3);
    expect(sel.has('/path/1')).toBe(true);
    expect(sel.has('/path/3')).toBe(true);
    expect(sel.has('/path/5')).toBe(true);
  });

  it('替换语义:旧 selection 中不在 paths 里的会被剔除', () => {
    // 初始 selected = ['/path/1', '/path/3']
    useFileStore.getState().selectRect(PANE_ID, ['/path/3', '/path/5']);
    const sel = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    expect(sel.has('/path/1')).toBe(false);
    expect(sel.has('/path/3')).toBe(true);
    expect(sel.has('/path/5')).toBe(true);
    expect(sel.size).toBe(2);
  });

  it('空数组 → 等价 clearSelection(清掉 selection + cursor + lastClicked)', () => {
    useFileStore.getState().selectRect(PANE_ID, []);
    const data = useFileStore.getState().panes[PANE_ID]!;
    expect(data.selectedPaths.size).toBe(0);
    expect(data.cursorPath).toBeNull();
    expect(data.lastClickedPath).toBeNull();
  });

  it('未知 paneId:no-op,已知 pane 状态不变', () => {
    const before = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    expect(() =>
      useFileStore.getState().selectRect('nonexistent-pane', ['/x', '/y']),
    ).not.toThrow();
    const after = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    // 已知 pane 应保持原状(2 项)
    expect(after.size).toBe(2);
    expect(after.has('/path/1')).toBe(true);
    expect(after.has('/path/3')).toBe(true);
    // 不抛错 + 内容相同 → no-op(对未知 pane 不创建条目,reference 可保持)
    expect(Array.from(after).sort()).toEqual(Array.from(before).sort());
  });

  it('不影响其它 pane 的 selection', () => {
    useFileStore.getState().selectRect(PANE_ID, ['/path/7']);
    const other = useFileStore.getState().panes[OTHER_PANE]!;
    expect(other.selectedPaths.has('/path/other-1')).toBe(true);
    expect(other.selectedPaths.size).toBe(1);
    // target pane 已替换
    expect(useFileStore.getState().panes[PANE_ID]!.selectedPaths.size).toBe(1);
  });

  it('selectedPaths 返回值是新的 Set 实例(避免引用相等导致的渲染优化失效)', () => {
    const before = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    useFileStore.getState().selectRect(PANE_ID, ['/path/9']);
    const after = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    expect(after).not.toBe(before);
  });

  it('去重:传入重复路径 → Set 去重,size 不超过唯一路径数', () => {
    useFileStore.getState().selectRect(PANE_ID, ['/path/2', '/path/2', '/path/2']);
    expect(useFileStore.getState().panes[PANE_ID]!.selectedPaths.size).toBe(1);
  });
});
