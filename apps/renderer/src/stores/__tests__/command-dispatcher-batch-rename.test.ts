/**
 * command-dispatcher file.batch-rename 单测 (G013)
 *
 * 覆盖:
 * - 2+ 选中:触发 'tabula:batch-rename' 事件,detail.paneId / detail.paths / detail.names 正确
 *   - names 从 entries.name 派生(同序)
 * - 0 / 1 选中:不触发事件,弹 warn toast
 * - event detail.paths 与 selectedPaths 一致(顺序为 Set 的插入序)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './setup';
import '../layout-store';
import { useFileStore, type PaneFileData } from '../file-store';
import { useLayoutStore } from '../layout-store';
import { runCommandById } from '../../command-dispatcher';
import type { FsEntry } from '@tabula/bridge';

const PANE_ID = 'pane-batch-rename';
const ACTIVE_PANE_ID = PANE_ID;

function makeEntries(): FsEntry[] {
  const mk = (i: number, name: string): FsEntry => ({
    name,
    path: `C:\\fake\\${name}`,
    isDirectory: false,
    isFile: true,
    isSymlink: false,
    size: 1024,
    mtime: Date.now(),
    atime: Date.now(),
    ctime: Date.now(),
    birthtime: Date.now(),
    ext: '.txt',
    mode: 0o644,
  });
  return [mk(1, 'one.txt'), mk(2, 'two.txt'), mk(3, 'three.txt'), mk(4, 'four.txt')];
}

function makePaneData(selected: string[]): PaneFileData {
  const entries = makeEntries();
  return {
    currentPath: 'C:\\fake',
    breadcrumb: [],
    entries,
    loading: false,
    error: null,
    selectedPaths: new Set(selected),
    cursorPath: entries[0]!.path,
    lastClickedPath: entries[0]!.path,
    renameTarget: null,
    searchQuery: '',
    searchOpen: false,
    viewMode: 'details',
    groupBy: 'none',
  };
}

describe('command-dispatcher file.batch-rename (G013)', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useFileStore.setState({
      panes: { [PANE_ID]: makePaneData([]) },
      sortBy: 'name',
      sortDir: 'asc',
      showHidden: false,
      toasts: [],
    });
    // 把 layout 切到我们关心的 pane
    useLayoutStore.setState({ activePaneId: ACTIVE_PANE_ID });
    // 监听全局事件 — 用类型断言规避 vi.spyOn 的 overload 推断问题
    dispatchSpy = vi.spyOn(window, 'dispatchEvent') as unknown as ReturnType<typeof vi.spyOn>;
  });

  it('2+ 选中:派发 tabula:batch-rename 事件,detail 包含 paneId/paths/names', () => {
    const entries = makeEntries();
    const selected = [entries[0]!.path, entries[1]!.path, entries[2]!.path];
    useFileStore.setState({
      panes: { [PANE_ID]: makePaneData(selected) },
    });

    const result = runCommandById('file.batch-rename');
    expect(result).toBe(true);

    // 找到派发的事件
    const evt = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent<{ paneId: string; paths: string[]; names: string[] }> =>
        e instanceof CustomEvent && e.type === 'tabula:batch-rename',
      );
    expect(evt, 'expected tabula:batch-rename event').toBeDefined();
    expect(evt!.detail.paneId).toBe(ACTIVE_PANE_ID);
    expect(evt!.detail.paths).toEqual(selected);
    expect(evt!.detail.names).toEqual(['one.txt', 'two.txt', 'three.txt']);
  });

  it('0 选中:不派发事件,返回 false,弹 warn toast', () => {
    useFileStore.setState({
      panes: { [PANE_ID]: makePaneData([]) },
    });
    const result = runCommandById('file.batch-rename');
    expect(result).toBe(false);
    const dispatched = dispatchSpy.mock.calls.some(
      (c) => c[0] instanceof CustomEvent && c[0].type === 'tabula:batch-rename',
    );
    expect(dispatched).toBe(false);
    // 应该有 toast
    const toasts = useFileStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.kind).toBe('warn');
  });

  it('1 选中:不派发事件,返回 false,弹 warn toast', () => {
    const entries = makeEntries();
    useFileStore.setState({
      panes: { [PANE_ID]: makePaneData([entries[0]!.path]) },
    });
    const result = runCommandById('file.batch-rename');
    expect(result).toBe(false);
    const dispatched = dispatchSpy.mock.calls.some(
      (c) => c[0] instanceof CustomEvent && c[0].type === 'tabula:batch-rename',
    );
    expect(dispatched).toBe(false);
    const toasts = useFileStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.kind).toBe('warn');
  });
});
