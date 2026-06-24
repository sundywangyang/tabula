/**
 * file-store openPreview / closePreview 单测 (G006)
 *
 * 覆盖:
 * - 默认值: previewState = null
 * - openPreview(entry) → previewState.entry = entry, loading=true
 * - closePreview() → previewState = null
 * - closePreview 在 closed 状态下不抛错
 * - openPreview 再次调用会替换 entry(并清掉 blobUrl,避免内存泄漏)
 * - 替换 entry 时如果上一个有 blobUrl,URL.revokeObjectURL 会被调
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
// 必须先 import layout-store:file-store → layout-store(import useLayoutStore) 构成循环;
// layout-store 又 import { makeFolderTab } from file-store 来初始化 store 树。
// 直接单独 import file-store 会让 layout-store 在 init 时拿到未完成的 makeFolderTab。
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

describe('file-store openPreview / closePreview (G006)', () => {
  beforeEach(() => {
    useFileStore.setState({ previewState: null });
  });

  it('默认值: previewState = null', () => {
    expect(useFileStore.getState().previewState).toBeNull();
  });

  it('openPreview(entry) 设置 previewState.entry 并 loading=true', () => {
    const entry = makeEntry({ name: 'a.txt', path: 'C:\\fake\\a.txt' });
    useFileStore.getState().openPreview(entry);
    const ps = useFileStore.getState().previewState;
    expect(ps).not.toBeNull();
    expect(ps?.entry).toEqual(entry);
    expect(ps?.entry.path).toBe('C:\\fake\\a.txt');
    expect(ps?.loading).toBe(true);
    expect(ps?.error).toBeNull();
  });

  it('closePreview() 把 previewState 置回 null', () => {
    useFileStore.getState().openPreview(makeEntry());
    expect(useFileStore.getState().previewState).not.toBeNull();
    useFileStore.getState().closePreview();
    expect(useFileStore.getState().previewState).toBeNull();
  });

  it('closePreview 在 closed 状态下不抛错(idempotent)', () => {
    expect(useFileStore.getState().previewState).toBeNull();
    expect(() => useFileStore.getState().closePreview()).not.toThrow();
    expect(useFileStore.getState().previewState).toBeNull();
  });

  it('openPreview 再次调用会替换 entry', () => {
    const a = makeEntry({ name: 'a.txt', path: 'C:\\fake\\a.txt' });
    const b = makeEntry({ name: 'b.txt', path: 'C:\\fake\\b.txt' });
    useFileStore.getState().openPreview(a);
    expect(useFileStore.getState().previewState?.entry.path).toBe(
      'C:\\fake\\a.txt',
    );
    useFileStore.getState().openPreview(b);
    expect(useFileStore.getState().previewState?.entry.path).toBe(
      'C:\\fake\\b.txt',
    );
  });

  it('openPreview 再次调用时,若上一个有 blobUrl,会 URL.revokeObjectURL 回收', () => {
    // jsdom 缺 URL.revokeObjectURL;在测试里临时补一个
    const original = (URL as { revokeObjectURL?: (s: string) => void })
      .revokeObjectURL;
    const calls: string[] = [];
    (URL as { revokeObjectURL: (s: string) => void }).revokeObjectURL = (s) => {
      calls.push(s);
    };
    try {
      useFileStore.setState({
        previewState: {
          entry: makeEntry({ name: 'old.txt' }),
          blobUrl: 'blob:old',
          text: null,
          loading: false,
          error: null,
          truncated: false,
          totalLines: 0,
        },
      });
      useFileStore.getState().openPreview(makeEntry({ name: 'new.txt' }));
      expect(calls).toContain('blob:old');
    } finally {
      if (original) {
        (URL as { revokeObjectURL: (s: string) => void }).revokeObjectURL = original;
      } else {
        delete (URL as { revokeObjectURL?: (s: string) => void }).revokeObjectURL;
      }
    }
  });
});
