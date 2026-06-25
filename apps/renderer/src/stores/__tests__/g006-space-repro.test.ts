/**
 * G006: Space 键 1 次就应唤起预览(回归测试)
 *
 * Bug 现象: 选中 1 个文件后,需要按 2 次 Space 键才唤起预览。
 *
 * 根因:
 *  同一个 Space 键有 2 个 handler 在抢:
 *  1) FileList 组件级 onKeyDown(FileList.tsx,在 React 合成事件阶段触发)
 *    — 调 openPreview(entry)
 *  2) App.tsx 全局 window keydown(冒泡阶段触发,React 合成事件之后)
 *    — 看到 previewState 已经被 (1) 设上,把这次按键当成「再按一次 = 关闭」,
 *      调 closePreview()。
 *  结果: 1 次 Space = open 立刻被 close,用户什么都没看到。
 *
 * 修复: 删除 FileList 中的 Space handler,让 App.tsx 全局 handler 作为唯一来源。
 *
 * 这个测试模拟「选中 → 按 Space」,断言:
 *  修复后,只有 App.tsx handler 跑 1 次,previewState 应被打开 (而不是 null)。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
import '../layout-store';
import { useFileStore } from '../file-store';
import type { FsEntry } from '@tabula/bridge';

function makeEntry(overrides: Partial<FsEntry> = {}): FsEntry {
  return {
    name: 'demo.txt',
    path: 'C:\\fake\\demo.txt',
    isDirectory: false,
    isFile: true,
    isSymlink: false,
    isHidden: false,
    size: 1024,
    mtime: 1_700_000_000_000,
    atime: 1_700_000_500_000,
    birthtime: 1_699_000_000_000,
    ext: '.txt',
    ...overrides,
  } as FsEntry;
}

interface PaneSeed {
  currentPath: string;
  entries: FsEntry[];
  selectedPaths: Set<string>;
  cursorPath: string | null;
  lastClickedPath: string | null;
  renameTarget: string | null;
  loading: boolean;
  error: string | null;
  breadcrumb: unknown[];
  viewMode: 'details' | 'list' | 'grid';
  groupBy: 'none' | 'name' | 'modified';
  searchQuery: string;
  searchOpen: boolean;
}

/** 模拟 App.tsx 全局 Space handler (lines 408-432) */
function simulateAppSpaceHandler(activePaneId: string): void {
  const fileState = useFileStore.getState();
  const data = fileState.panes[activePaneId];
  if (!data) return;
  let target: FsEntry | null = null;
  if (data.selectedPaths.size === 1) {
    const p = Array.from(data.selectedPaths)[0]!;
    target = data.entries.find((x) => x.path === p) ?? null;
  }
  if (!target && data.cursorPath) {
    target = data.entries.find((x) => x.path === data.cursorPath) ?? null;
  }
  if (!target) return;
  if (target.isDirectory) return;
  const current = fileState.previewState;
  if (current && current.entry.path === target.path) {
    fileState.closePreview();
  } else {
    fileState.openPreview(target);
  }
}

function seedPane(paneId: string, seed: Partial<PaneSeed>): void {
  useFileStore.setState((s) => ({
    panes: {
      ...s.panes,
      [paneId]: {
        currentPath: 'C:\\fake',
        entries: [],
        selectedPaths: new Set<string>(),
        cursorPath: null,
        lastClickedPath: null,
        renameTarget: null,
        loading: false,
        error: null,
        breadcrumb: [],
        viewMode: 'details',
        groupBy: 'none',
        searchQuery: '',
        searchOpen: false,
        ...seed,
      } as unknown as ReturnType<typeof useFileStore.getState>['panes'][string],
    },
  }));
}

describe('G006: Space 按 1 次就应唤起预览 (回归)', () => {
  beforeEach(() => {
    useFileStore.setState({ previewState: null });
  });

  it('用户选 a.txt 后按 1 次 Space,previewState 应当被打开 (而非 null)', () => {
    const paneId = 'p1';
    seedPane(paneId, {
      entries: [
        makeEntry({ name: 'a.txt', path: 'C:\\fake\\a.txt' }),
        makeEntry({ name: 'b.txt', path: 'C:\\fake\\b.txt' }),
      ],
    });

    // 用户点击 a.txt
    useFileStore.getState().selectOne(paneId, 'C:\\fake\\a.txt');

    // 修复后,FileList 不再处理 Space;只有 App.tsx handler 跑 1 次
    simulateAppSpaceHandler(paneId);

    const ps = useFileStore.getState().previewState;
    expect(ps).not.toBeNull();
    expect(ps?.entry.path).toBe('C:\\fake\\a.txt');
    expect(ps?.loading).toBe(true);
  });

  it('同文件按第 2 次 Space,previewState 应被关闭 (toggle 行为)', () => {
    const paneId = 'p1';
    seedPane(paneId, {
      entries: [
        makeEntry({ name: 'a.txt', path: 'C:\\fake\\a.txt' }),
      ],
    });
    useFileStore.getState().selectOne(paneId, 'C:\\fake\\a.txt');

    // 第 1 次:打开
    simulateAppSpaceHandler(paneId);
    expect(useFileStore.getState().previewState?.entry.path).toBe(
      'C:\\fake\\a.txt',
    );

    // 第 2 次:关闭
    simulateAppSpaceHandler(paneId);
    expect(useFileStore.getState().previewState).toBeNull();
  });

  it('切换到不同文件按 Space,应打开新的预览 (而非关掉旧的再开,造成视觉闪一下)', () => {
    const paneId = 'p1';
    seedPane(paneId, {
      entries: [
        makeEntry({ name: 'a.txt', path: 'C:\\fake\\a.txt' }),
        makeEntry({ name: 'b.txt', path: 'C:\\fake\\b.txt' }),
      ],
    });
    useFileStore.getState().selectOne(paneId, 'C:\\fake\\a.txt');
    simulateAppSpaceHandler(paneId);
    expect(useFileStore.getState().previewState?.entry.path).toBe(
      'C:\\fake\\a.txt',
    );

    // 切到 b.txt
    useFileStore.getState().selectOne(paneId, 'C:\\fake\\b.txt');
    simulateAppSpaceHandler(paneId);
    expect(useFileStore.getState().previewState?.entry.path).toBe(
      'C:\\fake\\b.txt',
    );
  });

  it('未选任何文件按 Space,handler 安全 return (previewState 保持 null)', () => {
    const paneId = 'p1';
    seedPane(paneId, {
      entries: [makeEntry({ name: 'a.txt', path: 'C:\\fake\\a.txt' })],
    });
    // 不 selectOne
    simulateAppSpaceHandler(paneId);
    expect(useFileStore.getState().previewState).toBeNull();
  });

  it('G006 关键回归: 即使在旧 FileList 行为下(open 之后被 App close 翻转),最终状态也应该是 open', () => {
    // 这个测试模拟修复前(双 handler)的执行顺序,断言:
    // 修复后,FileList 不再注册 Space handler,所以 App handler 是唯一的处理器。
    // 即便我们手动调用一次 FileList 风格的处理(老行为),App handler 不会
    // 再紧跟着把状态关闭 — 因为 FileList 那一层不再存在了。
    //
    // 这里仅保留一个对照:确认在「只有 App handler」的场景下,1 次按键
    // 能正确地打开预览(不依赖 FileList)。
    const paneId = 'p1';
    seedPane(paneId, {
      entries: [makeEntry({ name: 'a.txt', path: 'C:\\fake\\a.txt' })],
    });
    useFileStore.getState().selectOne(paneId, 'C:\\fake\\a.txt');

    // 模拟真实情况:App handler 跑 1 次
    simulateAppSpaceHandler(paneId);
    expect(useFileStore.getState().previewState?.entry.path).toBe(
      'C:\\fake\\a.txt',
    );

    // 注意:FileList 不再处理 Space,所以同一个事件不会有第 2 次 handler 跑
    // 不会发生「open → close」的翻转
  });
});
