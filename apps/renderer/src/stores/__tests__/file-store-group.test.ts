/**
 * file-store groupEntries + setGroupBy 单测 (G007)
 *
 * 覆盖:
 * - groupEntries([], 'type') → [{ header: '', entries: [] }]
 * - groupEntries(mixed, 'type') → 目录先一段,然后按 ext 分组
 * - groupEntries(files, 'size') → 按 SIZE_BUCKETS 分桶
 * - groupEntries(recent, 'date') → 按 Today / Yesterday / ... 分组
 * - setGroupBy 更新 store 中 pane 的 groupBy 字段
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './setup';
// 必须先 import layout-store:file-store → layout-store 构成循环。
import '../layout-store';
import { groupEntries, useFileStore, type GroupByMode, type GroupSection } from '../file-store';
import type { FsEntry } from '@tabula/bridge';

/** 测试用 FsEntry 构造器 — bridge 的 FsEntry 有 11 个字段,这里只关心 groupBy 需要的。 */
function makeEntry(
  name: string,
  opts: { isDirectory?: boolean; ext?: string; size?: number; mtime?: number } = {},
): FsEntry {
  return {
    name,
    path: `/test/${name}`,
    isDirectory: opts.isDirectory ?? false,
    isFile: !opts.isDirectory,
    isSymlink: false,
    size: opts.size ?? 0,
    mtime: opts.mtime ?? 0,
    atime: 0,
    ctime: 0,
    birthtime: 0,
    ext: opts.ext ?? '',
  };
}

beforeEach(() => {
  // 重置 store 的 panes(避免其它测试残留)
  useFileStore.setState({ panes: {} });
});

describe('G007 groupEntries 基础', () => {
  it('groupEntries([], "none") 返回单段空 entries(header 为空)', () => {
    const result = groupEntries([], 'none');
    expect(result).toEqual([{ header: '', entries: [] }]);
  });

  it('groupEntries(entries, "none") 返回单段,header 为空', () => {
    const a = makeEntry('a.txt');
    const b = makeEntry('b.txt');
    const result = groupEntries([a, b], 'none');
    expect(result).toEqual([{ header: '', entries: [a, b] }]);
  });

  it('groupEntries([], "type") 返回空数组(没有任何组)', () => {
    const result = groupEntries([], 'type');
    expect(result).toEqual([]);
  });
});

describe('G007 groupEntries "type" 模式', () => {
  it('目录先一段,文件按 ext 分组', () => {
    const dir1 = makeEntry('docs', { isDirectory: true });
    const dir2 = makeEntry('pics', { isDirectory: true });
    const a = makeEntry('a.js', { ext: '.js' });
    const b = makeEntry('b.ts', { ext: '.ts' });
    const c = makeEntry('c.js', { ext: '.js' });
    const noExt = makeEntry('README', { ext: '' });

    const result = groupEntries([dir1, a, b, c, dir2, noExt], 'type');

    // 至少 2 段: Folders + .js/.ts/(no extension) 之一
    expect(result.length).toBeGreaterThanOrEqual(2);

    // 第一段必须是 Folders,且包含两个目录
    const firstSection = result[0]!;
    expect(firstSection.header).toBe('Folders');
    expect(firstSection.entries).toEqual([dir1, dir2]);

    // 找到 .js 段、.ts 段、(no extension) 段
    const jsSection = result.find((s: GroupSection) => s.header === '.js');
    const tsSection = result.find((s: GroupSection) => s.header === '.ts');
    const noExtSection = result.find((s: GroupSection) => s.header === '(no extension)');

    expect(jsSection).toBeDefined();
    expect(jsSection!.entries).toEqual([a, c]);

    expect(tsSection).toBeDefined();
    expect(tsSection!.entries).toEqual([b]);

    expect(noExtSection).toBeDefined();
    expect(noExtSection!.entries).toEqual([noExt]);
  });

  it('只有文件(无目录)时,结果里没有 Folders 段', () => {
    const a = makeEntry('a.js', { ext: '.js' });
    const b = makeEntry('b.txt', { ext: '.txt' });

    const result = groupEntries([a, b], 'type');

    expect(result.some((s) => s.header === 'Folders')).toBe(false);
    expect(result.length).toBe(2); // .js + .txt
  });
});

describe('G007 groupEntries "size" 模式', () => {
  it('按 SIZE_BUCKETS 分桶', () => {
    const tiny = makeEntry('tiny.txt', { size: 100 }); // < 1 KB
    const small = makeEntry('small.txt', { size: 5000 }); // 1 KB – 1 MB
    const medium = makeEntry('medium.bin', { size: 10 * 1024 * 1024 }); // 1 – 100 MB
    const huge = makeEntry('huge.iso', { size: 2 * 1024 * 1024 * 1024 }); // > 1 GB

    const result = groupEntries([tiny, small, medium, huge], 'size');

    const findBucket = (header: string) =>
      result.find((s: GroupSection) => s.header === header);

    expect(findBucket('Tiny (< 1 KB)')?.entries).toEqual([tiny]);
    expect(findBucket('Small (1 KB – 1 MB)')?.entries).toEqual([small]);
    expect(findBucket('Medium (1 MB – 100 MB)')?.entries).toEqual([medium]);
    expect(findBucket('Huge (> 1 GB)')?.entries).toEqual([huge]);
    // 没目录,不该有 Folders 段
    expect(result.some((s) => s.header === 'Folders')).toBe(false);
  });
});

describe('G007 groupEntries "date" 模式', () => {
  it('按 mtime 相对 today 分桶', () => {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    const todayFile = makeEntry('today.txt', { mtime: now - 60_000 }); // 1 min ago
    const yesterdayFile = makeEntry('yest.txt', { mtime: now - ONE_DAY - 60_000 });
    const thisWeekFile = makeEntry('week.txt', { mtime: now - 3 * ONE_DAY });
    const thisMonthFile = makeEntry('month.txt', { mtime: now - 10 * ONE_DAY });
    const thisYearFile = makeEntry('year.txt', { mtime: now - 100 * ONE_DAY });
    const olderFile = makeEntry('old.txt', { mtime: now - 400 * ONE_DAY });

    const result = groupEntries(
      [todayFile, yesterdayFile, thisWeekFile, thisMonthFile, thisYearFile, olderFile],
      'date',
    );

    const findBucket = (header: string) =>
      result.find((s: GroupSection) => s.header === header);

    expect(findBucket('Today')?.entries).toEqual([todayFile]);
    expect(findBucket('Yesterday')?.entries).toEqual([yesterdayFile]);
    expect(findBucket('This Week')?.entries).toEqual([thisWeekFile]);
    expect(findBucket('This Month')?.entries).toEqual([thisMonthFile]);
    expect(findBucket('This Year')?.entries).toEqual([thisYearFile]);
    expect(findBucket('Older')?.entries).toEqual([olderFile]);
  });

  it('目录总是进 Folders 段(date 模式)', () => {
    const dir = makeEntry('docs', { isDirectory: true });
    const f = makeEntry('a.txt', { mtime: Date.now() - 60_000 });

    const result = groupEntries([dir, f], 'date');

    const foldersSection = result.find((s: GroupSection) => s.header === 'Folders');
    expect(foldersSection).toBeDefined();
    expect(foldersSection!.entries).toEqual([dir]);
  });
});

describe('G007 setGroupBy action', () => {
  it('setGroupBy 更新 pane 的 groupBy 字段', () => {
    const paneId = 'pane-1';
    // 初始化 pane
    useFileStore.getState().ensurePane(paneId);

    expect(useFileStore.getState().panes[paneId]?.groupBy).toBe('none');

    useFileStore.getState().setGroupBy(paneId, 'type' satisfies GroupByMode);
    expect(useFileStore.getState().panes[paneId]?.groupBy).toBe('type');

    useFileStore.getState().setGroupBy(paneId, 'size');
    expect(useFileStore.getState().panes[paneId]?.groupBy).toBe('size');

    useFileStore.getState().setGroupBy(paneId, 'date');
    expect(useFileStore.getState().panes[paneId]?.groupBy).toBe('date');

    useFileStore.getState().setGroupBy(paneId, 'none');
    expect(useFileStore.getState().panes[paneId]?.groupBy).toBe('none');
  });

  it('setGroupBy 对不存在的 paneId 不抛错,且不影响已有 pane', () => {
    const paneId = 'pane-existing';
    useFileStore.getState().ensurePane(paneId);
    useFileStore.getState().setGroupBy(paneId, 'type');

    expect(() => {
      useFileStore.getState().setGroupBy('pane-missing', 'size');
    }).not.toThrow();

    expect(useFileStore.getState().panes[paneId]?.groupBy).toBe('type');
  });

  it('新 pane 默认 groupBy 为 "none"', () => {
    const paneId = 'pane-fresh';
    useFileStore.getState().ensurePane(paneId);

    expect(useFileStore.getState().panes[paneId]?.groupBy).toBe('none');
  });
});