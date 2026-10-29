// @vitest-environment node
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { search } from '../filesystem';

let root: string;
beforeEach(async () => {
  const base = join(process.cwd(), 'out', 'test-fixtures'); await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, 'search-'));
  await mkdir(join(root, '子目录'));
  await writeFile(join(root, '子目录', '大文件.txt'), '1234567890');
  await writeFile(join(root, '子目录', '小文件.txt'), 'x');
  await writeFile(join(root, '子目录', '大图片.png'), '1234567890');
  await utimes(join(root, '子目录', '大文件.txt'), new Date('2026-10-25T00:00:00Z'), new Date('2026-10-25T00:00:00Z'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('combined filename search', () => {
  it('filters before limiting results and traverses directories that do not match a size filter', async () => {
    const result = await search({ path: root, query: '', fileType: 'document', maxResults: 10, maxDepth: 5,
      minSize: 5, maxSize: 20, modifiedAfter: Date.parse('2026-10-20'), modifiedBefore: Date.parse('2026-10-28') });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.entries.map(entry => entry.name)).toEqual(['大文件.txt']);
  });
  it('combines name and size and reports truncation', async () => {
    const result = await search({ path: root, query: '大', maxResults: 1, maxDepth: 5, minSize: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.data.entries).toHaveLength(1); expect(result.data.truncated).toBe(true); }
  });
  it('reports invalid ranges and missing search roots instead of a false empty result', async () => {
    expect((await search({ path: root, query: '文件', maxResults: 10, minSize: 100, maxSize: 10 })).ok).toBe(false);
    expect((await search({ path: join(root, '不存在'), query: '文件', maxResults: 10 })).ok).toBe(false);
  });
});
