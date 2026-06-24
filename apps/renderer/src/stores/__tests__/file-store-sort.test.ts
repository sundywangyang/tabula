/**
 * file-store cycleSort 单测 (G005 列标题排序)
 *
 * 覆盖:
 * - cycleSort('name') 从初始状态(sortBy='name', sortDir='asc') → 'desc'
 * - cycleSort('name') 从 desc → null(unsorted)
 * - cycleSort('name') 从 null → 'asc'
 * - cycleSort 切换到不同字段时,dir 重置为 'asc'
 * - 在 4 个 SortField(name/size/mtime/type)上行为一致
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
// 必须先 import layout-store:file-store → layout-store 构成循环;
// layout-store 又 import { makeFolderTab } from file-store 来初始化 store 树。
import '../layout-store';
import { useFileStore, type SortField, type SortDir } from '../file-store';

beforeEach(() => {
  // 重置全局 sortBy/sortDir 到初始默认值,避免其它 test 残留
  useFileStore.setState({ sortBy: 'name', sortDir: 'asc' });
});

describe('G005 cycleSort (列标题排序三态循环)', () => {
  it('cycleSort("name") 初始 asc → desc', () => {
    expect(useFileStore.getState().sortBy).toBe('name');
    expect(useFileStore.getState().sortDir).toBe('asc');

    useFileStore.getState().cycleSort('name');

    expect(useFileStore.getState().sortBy).toBe('name');
    expect(useFileStore.getState().sortDir).toBe('desc');
  });

  it('cycleSort("name") desc → null(unsorted)', () => {
    useFileStore.setState({ sortBy: 'name', sortDir: 'desc' });

    useFileStore.getState().cycleSort('name');

    expect(useFileStore.getState().sortBy).toBe('name');
    expect(useFileStore.getState().sortDir).toBeNull();
  });

  it('cycleSort("name") null → asc(回到起点)', () => {
    useFileStore.setState({ sortBy: 'name', sortDir: null });

    useFileStore.getState().cycleSort('name');

    expect(useFileStore.getState().sortBy).toBe('name');
    expect(useFileStore.getState().sortDir).toBe('asc');
  });

  it('cycleSort("size") 切换到不同字段时 dir 重置为 asc', () => {
    // 当前按 name/asc 排序
    useFileStore.setState({ sortBy: 'name', sortDir: 'asc' });

    // 点击 size 列标题 → 字段切换,方向应为 asc
    useFileStore.getState().cycleSort('size');

    expect(useFileStore.getState().sortBy).toBe('size');
    expect(useFileStore.getState().sortDir).toBe('asc');
  });

  it('cycleSort 三次循环回到起点(asc → desc → null → asc)', () => {
    useFileStore.setState({ sortBy: 'name', sortDir: 'asc' });

    useFileStore.getState().cycleSort('name');
    expect(useFileStore.getState().sortDir).toBe<SortDir>('desc');

    useFileStore.getState().cycleSort('name');
    expect(useFileStore.getState().sortDir).toBeNull();

    useFileStore.getState().cycleSort('name');
    expect(useFileStore.getState().sortDir).toBe<SortDir>('asc');
  });
});

describe('G005 cycleSort 在不同 SortField 上行为一致', () => {
  const fields: SortField[] = ['name', 'size', 'mtime', 'type'];
  for (const field of fields) {
    it(`cycleSort("${field}") asc → desc → null → asc`, () => {
      useFileStore.setState({ sortBy: field, sortDir: 'asc' });

      useFileStore.getState().cycleSort(field);
      expect(useFileStore.getState().sortBy).toBe(field);
      expect(useFileStore.getState().sortDir).toBe('desc');

      useFileStore.getState().cycleSort(field);
      expect(useFileStore.getState().sortDir).toBeNull();

      useFileStore.getState().cycleSort(field);
      expect(useFileStore.getState().sortDir).toBe('asc');
    });
  }
});
