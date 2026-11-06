// @vitest-environment node
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MacosTrashProvider } from '../macos';

describe('macOS trash listing', () => {
  it('round-trips multiple Finder entries and special characters through JSON', async () => {
    const names = ['first, file|.txt', 'line\n"quote\' #%.txt', 'folder|,\n"'];
    const items = names.map((name, index) => ({
      name, itemPath: join(tmpdir(), 'tabula-trash-fixture', name),
      size: index + 1, isDirectory: index === 2,
    }));
    const run = vi.fn(async (args: string[]) => {
      const finder = {
        trash: { items: () => items.map(item => ({
          name: () => item.name, url: () => pathToFileURL(item.itemPath).href,
          size: () => item.size, class: () => item.isDirectory ? 'folder' : 'document file',
        })) },
      };
      return String(runInNewContext(`${args[3]}\nrun();`, {
        Application: (name: string) => { expect(name).toBe('Finder'); return finder; },
      }));
    });
    const result = await new MacosTrashProvider(run).list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(3);
    expect(result.data.entries).toEqual(items.map(item => ({ ...item, originalPath: null, deletedTime: expect.any(Number) })));
  });

  it('returns an empty list for empty Finder trash', async () => {
    expect(await new MacosTrashProvider(async () => '[]\n').list())
      .toEqual({ ok: true, data: { entries: [], total: 0 } });
  });

  it('reports failed enumeration instead of claiming the trash is empty', async () => {
    const error = Object.assign(new Error('Automation permission denied'), { code: 'EACCES' });
    expect(await new MacosTrashProvider(async () => { throw error; }).list())
      .toMatchObject({ ok: false, error: { code: 'EACCES', message: error.message } });
    expect((await new MacosTrashProvider(async () => '[{"name":"incomplete"}]').list()).ok).toBe(false);
  });

  it('reports cross-volume or unsupported exclusive renames without retrying a destructive move', async () => {
    for (const errno of [18, 45]) {
      const run = vi.fn(async () => JSON.stringify({ ok: false, errno }));
      const source = join(tmpdir(), 'trash', 'saved.txt');
      const destination = join(tmpdir(), 'other-volume', 'saved.txt');
      const result = await new MacosTrashProvider(run).restore(source, destination);
      expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('文件仍保留在废纸篓') } });
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
});

// These integration cases invoke only renamex_np on temporary fixtures.
// No test sends Finder an event or accesses the user's real Desktop / Trash.
describe.skipIf(process.platform !== 'darwin')('macOS trash restore safety', () => {
  let root: string;
  let provider: MacosTrashProvider;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'tabula-trash-'));
    await fs.mkdir(join(root, 'Desktop'));
    await fs.mkdir(join(root, '.Trash'));
    provider = new MacosTrashProvider(undefined, () => root);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('preserves both files and reports EEXIST when Desktop contains the same name', async () => {
    const source = join(root, '.Trash', 'report.txt');
    const destination = join(root, 'Desktop', 'report.txt');
    await fs.writeFile(source, 'old trashed content');
    await fs.writeFile(destination, 'current desktop content');
    expect(await provider.restore(source)).toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readFile(source, 'utf8')).toBe('old trashed content');
    expect(await fs.readFile(destination, 'utf8')).toBe('current desktop content');
  });

  it('restores a file with quotes, delimiters and a newline without interpreting its name', async () => {
    const name = '中文😀,|\n"quote\' #%.txt';
    const source = join(root, '.Trash', name);
    await fs.writeFile(source, 'saved');
    expect(await provider.restore(source)).toEqual({ ok: true, data: undefined });
    expect(await fs.readFile(join(root, 'Desktop', name), 'utf8')).toBe('saved');
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the supplied original path instead of Desktop', async () => {
    const source = join(root, '.Trash', 'renamed.txt');
    const destination = join(root, 'original.txt');
    await fs.writeFile(source, 'saved');
    expect(await provider.restore(source, destination)).toEqual({ ok: true, data: undefined });
    expect(await fs.readFile(destination, 'utf8')).toBe('saved');
    await expect(fs.lstat(join(root, 'Desktop', 'renamed.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not merge a restored folder into an existing folder', async () => {
    const source = join(root, '.Trash', 'folder');
    const destination = join(root, 'Desktop', 'folder');
    await fs.mkdir(source);
    await fs.mkdir(destination);
    await fs.writeFile(join(source, 'saved.txt'), 'saved');
    await fs.writeFile(join(destination, 'current.txt'), 'current');
    expect(await provider.restore(`${source}/`)).toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readdir(destination)).toEqual(['current.txt']);
    expect(await fs.readFile(join(source, 'saved.txt'), 'utf8')).toBe('saved');
  });

  it('does not overwrite a dangling symlink at the destination', async () => {
    const source = join(root, '.Trash', 'report.txt');
    const destination = join(root, 'Desktop', 'report.txt');
    const target = join(root, 'missing');
    await fs.writeFile(source, 'saved');
    await fs.symlink(target, destination);
    expect(await provider.restore(source)).toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readlink(destination)).toBe(target);
    expect(await fs.readFile(source, 'utf8')).toBe('saved');
  });

  it('keeps the source when the destination parent is missing', async () => {
    const source = join(root, '.Trash', 'report.txt');
    await fs.writeFile(source, 'saved');
    expect((await provider.restore(source, join(root, 'missing', 'report.txt'))).ok).toBe(false);
    expect(await fs.readFile(source, 'utf8')).toBe('saved');
  });

  it('preserves the losing source when two restores race for the same destination', async () => {
    const sources = [join(root, '.Trash', 'first.txt'), join(root, '.Trash', 'second.txt')];
    const destination = join(root, 'Desktop', 'report.txt');
    await Promise.all(sources.map((source, index) => fs.writeFile(source, String(index))));
    const results = await Promise.all(sources.map(source => provider.restore(source, destination)));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const failedIndex = results.findIndex(result => !result.ok);
    expect(results[failedIndex]).toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readFile(sources[failedIndex], 'utf8')).toBe(String(failedIndex));
    expect(await fs.readFile(destination, 'utf8')).toBe(String(1 - failedIndex));
  });
});
