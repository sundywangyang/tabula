/**
 * file-store selectInvert 单测 (G002)
 *
 * 覆盖:
 * - 反选:已选中的 2 个变成未选中,未选中的 3 个变成已选中
 * - 反选后 selectedPaths 数量从 2 变 3
 * - pre-existing 非选中项 → 现在选中
 * - pre-existing 选中项 → 现在非选中
 * - 反选之后再反选,回到原状态
 * - 对未知 paneId 安全 no-op(不抛错)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
// 必须先 import layout-store:file-store → layout-store(import useLayoutStore) 构成循环;
// layout-store 又 import { makeFolderTab } from file-store 来初始化 store 树。
// 直接单独 import file-store 会让 layout-store 在 init 时拿到未完成的 makeFolderTab。
import '../layout-store';
import { useFileStore, type PaneFileData } from '../file-store';
import type { FsEntry } from '@tabula/bridge';

const PANE_ID = 'pane-test-invert';

/** 构造 5 个文件 entry(3 个非选中 + 2 个预选中) */
function makeEntries(): FsEntry[] {
  const mk = (i: number, name: string, isDir = false): FsEntry => ({
    name,
    path: `C:\\fake\\${name}`,
    isDirectory: isDir,
    isFile: !isDir,
    isSymlink: false,
    size: 1024,
    mtime: Date.now(),
    atime: Date.now(),
    ctime: Date.now(),
    birthtime: Date.now(),
    ext: '.txt',
    mode: 0o644,
  });
  return [
    mk(1, 'alpha.txt'),
    mk(2, 'beta.txt'),
    mk(3, 'gamma.txt'),
    mk(4, 'delta.txt'),
    mk(5, 'epsilon.txt'),
  ];
}

function makePaneData(): PaneFileData {
  const entries = makeEntries();
  return {
    currentPath: 'C:\\fake',
    breadcrumb: [],
    entries,
    loading: false,
    error: null,
    // 预选中 alpha 和 beta(其余 3 个未选)
    selectedPaths: new Set([entries[0]!.path, entries[1]!.path]),
    cursorPath: entries[0]!.path,
    lastClickedPath: entries[0]!.path,
    renameTarget: null,
    searchQuery: '',
    searchOpen: false,
    viewMode: 'details',
    groupBy: 'none',
  };
}

describe('file-store selectInvert (G002)', () => {
  beforeEach(() => {
    // 重置 panes 到测试 fixture
    useFileStore.setState({
      panes: { [PANE_ID]: makePaneData() },
      sortBy: 'name',
      sortDir: 'asc',
      showHidden: false,
    });
  });

  it('反选后选中的数量从 2 变 3(总条目 5)', () => {
    const before = useFileStore.getState().panes[PANE_ID]!.selectedPaths.size;
    expect(before).toBe(2);

    useFileStore.getState().selectInvert(PANE_ID);

    const after = useFileStore.getState().panes[PANE_ID]!.selectedPaths.size;
    expect(after).toBe(3);
  });

  it('反选后:原本选中的 2 项变成未选中', () => {
    useFileStore.getState().selectInvert(PANE_ID);
    const sel = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    // alpha 和 beta 之前选中,现在应该不再选中
    expect(sel.has('C:\\fake\\alpha.txt')).toBe(false);
    expect(sel.has('C:\\fake\\beta.txt')).toBe(false);
  });

  it('反选后:原本未选的 3 项变成选中', () => {
    useFileStore.getState().selectInvert(PANE_ID);
    const sel = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    expect(sel.has('C:\\fake\\gamma.txt')).toBe(true);
    expect(sel.has('C:\\fake\\delta.txt')).toBe(true);
    expect(sel.has('C:\\fake\\epsilon.txt')).toBe(true);
  });

  it('反选后再反选,回到原状态(幂等)', () => {
    const initial = new Set(useFileStore.getState().panes[PANE_ID]!.selectedPaths);
    useFileStore.getState().selectInvert(PANE_ID);
    useFileStore.getState().selectInvert(PANE_ID);
    const finalSel = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    expect(finalSel).toEqual(initial);
  });

  it('对未知 paneId 安全 no-op', () => {
    expect(() => useFileStore.getState().selectInvert('nonexistent-pane')).not.toThrow();
    // 已知 pane 状态不变
    const before = useFileStore.getState().panes[PANE_ID]!.selectedPaths;
    expect(before.size).toBe(2);
  });

  it('全选后反选 → 全不选', () => {
    useFileStore.getState().selectAll(PANE_ID);
    expect(useFileStore.getState().panes[PANE_ID]!.selectedPaths.size).toBe(5);

    useFileStore.getState().selectInvert(PANE_ID);
    expect(useFileStore.getState().panes[PANE_ID]!.selectedPaths.size).toBe(0);
  });

  it('全不选后反选 → 全选', () => {
    // 重置成空 selection
    useFileStore.setState({
      panes: {
        [PANE_ID]: { ...makePaneData(), selectedPaths: new Set() },
      },
    });
    expect(useFileStore.getState().panes[PANE_ID]!.selectedPaths.size).toBe(0);

    useFileStore.getState().selectInvert(PANE_ID);
    expect(useFileStore.getState().panes[PANE_ID]!.selectedPaths.size).toBe(5);
  });
});