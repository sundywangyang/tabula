// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { IpcChannels } from '@tabula/bridge';
import { FileOperations } from '../operations';
import { copy, move } from '../filesystem';
import { batchRename } from '../batch-rename';
import { UndoManager } from '../../undo/undo-manager';
import { registerFileOperationHandlers } from '../../ipc/file-operations';
import { pathExists } from '../path-safety';
import { readRtf } from '../rtf';

let root: string;
let history: UndoManager;
let operations: FileOperations;
let handlers: Map<string, (event: unknown, ...args: any[]) => any>;
let trashIndex = 0;
const fixtureParent = resolve('out', 'test-fixtures');

async function file(name: string, contents = name): Promise<string> {
  const path = join(root, name);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, contents);
  return path;
}

beforeEach(async () => {
  // Workspace fixtures exercise native rename semantics; the managed Windows temp folder restricts rename.
  await fs.mkdir(fixtureParent, { recursive: true });
  root = await fs.mkdtemp(join(fixtureParent, 'tabula-operations-'));
  history = new UndoManager();
  operations = new FileOperations(join(root, 'backups'), async (path) => {
    const recycled = join(root, 'recycle', String(++trashIndex));
    await fs.mkdir(dirname(recycled), { recursive: true });
    await fs.rename(path, recycled);
  }, history);
  handlers = new Map();
  registerFileOperationHandlers((channel, handler) => handlers.set(channel, handler), operations);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Never remove anything except the fixture directory created by this test.
  if (dirname(resolve(root)) !== fixtureParent || !basename(root).startsWith('tabula-operations-')) throw new Error('Invalid fixture root');
  await fs.rm(root, { recursive: true, force: true });
});

describe('actual file-operation IPC boundary', () => {
  it('rejects a conflicting move with overwrite=false without changing either file', async () => {
    const source = await file('source/a.txt', 'SOURCE');
    const target = await file('target/a.txt', 'TARGET');
    const result = await handlers.get(IpcChannels.FS_MOVE)!(null, { sources: [source], destination: dirname(target), overwrite: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readFile(source, 'utf8')).toBe('SOURCE');
    expect(await fs.readFile(target, 'utf8')).toBe('TARGET');
    expect(history.getUndoSize()).toBe(0);
  });

  it('the exported filesystem service also protects existing directories', async () => {
    const source = await file('source/folder/a.txt', 'SOURCE');
    const target = await file('target/folder/a.txt', 'TARGET');
    expect(await move({ sources: [dirname(source)], destination: dirname(dirname(target)), overwrite: false }))
      .toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readFile(source, 'utf8')).toBe('SOURCE');
    expect(await fs.readFile(target, 'utf8')).toBe('TARGET');
  });

  it('copy conflicts are errors rather than silent successful skips', async () => {
    const source = await file('source/a.txt', 'SOURCE');
    const target = await file('target/a.txt', 'TARGET');
    expect(await copy({ sources: [source], destination: dirname(target), overwrite: false }))
      .toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readFile(target, 'utf8')).toBe('TARGET');
  });

  it('uses explicit move destinations and supports undo and redo through the same history', async () => {
    const source = await file('source/a.txt', 'ORIGINAL');
    const destination = join(root, 'target', 'renamed.txt');
    await fs.mkdir(dirname(destination));
    expect(await handlers.get(IpcChannels.FS_MOVE)!(null, { sources: [source], destination: dirname(destination), destinations: [destination] })).toMatchObject({ ok: true });
    expect(await pathExists(source)).toBe(false);
    expect(await fs.readFile(destination, 'utf8')).toBe('ORIGINAL');
    await history.undo();
    expect(await fs.readFile(source, 'utf8')).toBe('ORIGINAL');
    expect(await pathExists(destination)).toBe(false);
    await history.redo();
    expect(await fs.readFile(destination, 'utf8')).toBe('ORIGINAL');
  });

  it('copies a same-directory duplicate to its explicit name and undoes only the copy', async () => {
    const source = await file('a.txt', 'ORIGINAL');
    const destination = join(root, 'a - 副本.txt');
    expect(await handlers.get(IpcChannels.FS_COPY)!(null, { sources: [source], destination: root, destinations: [destination] })).toMatchObject({ ok: true });
    await history.undo();
    expect(await pathExists(destination)).toBe(false);
    expect(await fs.readFile(source, 'utf8')).toBe('ORIGINAL');
    await history.redo();
    expect(await fs.readFile(destination, 'utf8')).toBe('ORIGINAL');
  });

  it('backs up overwritten content and restores it on undo', async () => {
    const source = await file('source/a.txt', 'NEW');
    const target = await file('target/a.txt', 'OLD');
    expect(await operations.copy({ sources: [source], destination: dirname(target), overwrite: true })).toMatchObject({ ok: true });
    expect(await fs.readFile(target, 'utf8')).toBe('NEW');
    await history.undo();
    expect(await fs.readFile(target, 'utf8')).toBe('OLD');
    await history.redo();
    expect(await fs.readFile(target, 'utf8')).toBe('NEW');
  });

  it('records one entry for a batch with mixed overwrite decisions', async () => {
    const first = await file('source/a.txt', 'NEW_A');
    const second = await file('source/b.txt', 'NEW_B');
    const old = await file('target/a.txt', 'OLD_A');
    const renamed = join(root, 'target', 'b-new.txt');
    expect(await operations.copy({ sources: [first, second], destination: dirname(old), destinations: [old, renamed], overwrites: [true, false] })).toMatchObject({ ok: true });
    expect(history.getUndoSize()).toBe(1);
    await history.undo();
    expect(await fs.readFile(old, 'utf8')).toBe('OLD_A');
    expect(await pathExists(renamed)).toBe(false);
  });

  it('does not undo a directory copy after a nested file was edited', async () => {
    const sourceFile = await file('source/folder/nested/a.txt', 'OLD');
    await fs.mkdir(join(root, 'target'));
    expect(await operations.copy({ sources: [join(root, 'source', 'folder')], destination: join(root, 'target') })).toMatchObject({ ok: true });
    const target = join(root, 'target', 'folder', 'nested', 'a.txt');
    await fs.writeFile(target, 'USER_EDITED_CONTENT');
    await expect(history.undo()).rejects.toThrow('文件已发生变化');
    expect(await fs.readFile(target, 'utf8')).toBe('USER_EDITED_CONTENT');
    expect(await pathExists(sourceFile)).toBe(true);
    expect(history.getUndoSize()).toBe(1);
  });

  it('rolls back completed moves when a later item fails', async () => {
    const first = await file('source/a.txt', 'A');
    const second = await file('source/b.txt', 'B');
    const target = join(root, 'target');
    await fs.mkdir(target);
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === second) throw Object.assign(new Error('blocked'), { code: 'EACCES' });
      return rename(from, to);
    });
    expect(await operations.move({ sources: [first, second], destination: target })).toMatchObject({ ok: false });
    expect(await fs.readFile(first, 'utf8')).toBe('A');
    expect(await fs.readFile(second, 'utf8')).toBe('B');
    expect(await fs.readdir(target)).toEqual([]);
    expect(history.getUndoSize()).toBe(0);
  });

  it('falls back to copy/delete only for EXDEV and keeps no-overwrite protection', async () => {
    const source = await file('source/a.txt', 'A');
    const destination = join(root, 'target');
    await fs.mkdir(destination);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('cross volume'), { code: 'EXDEV' }));
    expect(await move({ sources: [source], destination })).toMatchObject({ ok: true });
    expect(await pathExists(source)).toBe(false);
    expect(await fs.readFile(join(destination, 'a.txt'), 'utf8')).toBe('A');
  });

  it('does not copy/delete after a permission error', async () => {
    const source = await file('source/a.txt', 'A');
    const destination = join(root, 'target');
    await fs.mkdir(destination);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const cp = vi.spyOn(fs, 'cp');
    expect(await move({ sources: [source], destination })).toMatchObject({ ok: false, error: { code: 'EACCES' } });
    expect(cp).not.toHaveBeenCalled();
    expect(await fs.readFile(source, 'utf8')).toBe('A');
  });

  it('preserves a destination created by another program during a copy', async () => {
    const source = await file('source/a.txt', 'SOURCE');
    const destination = join(root, 'target', 'a.txt');
    await fs.mkdir(dirname(destination));
    const cp = fs.cp.bind(fs);
    vi.spyOn(fs, 'cp').mockImplementation(async (from, to, options) => {
      await cp(from, to, options);
      if (from === source) await fs.writeFile(destination, 'OTHER_PROGRAM');
    });
    expect(await operations.copy({ sources: [source], destination: dirname(destination) })).toMatchObject({ ok: false });
    expect(await fs.readFile(destination, 'utf8')).toBe('OTHER_PROGRAM');
    expect(await fs.readFile(source, 'utf8')).toBe('SOURCE');
    expect(await fs.readdir(dirname(destination))).toEqual(['a.txt']);
    expect(history.getUndoSize()).toBe(0);
  });

  it('retains the recovery copy when a cross-volume source deletion fails', async () => {
    const source = await file('source/a.txt', 'SOURCE');
    const destination = join(root, 'target');
    await fs.mkdir(destination);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('cross volume'), { code: 'EXDEV' }));
    const rm = fs.rm.bind(fs);
    vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
      if (path === source) throw Object.assign(new Error('source busy'), { code: 'EBUSY' });
      return rm(path, options);
    });
    const result = await operations.move({ sources: [source], destination });
    expect(result.ok).toBe(false);
    expect(await fs.readFile(source, 'utf8')).toBe('SOURCE');
    const recovery = (await fs.readdir(destination)).find((name) => name.startsWith('.tabula-transfer-'))!;
    expect(await fs.readFile(join(destination, recovery), 'utf8')).toBe('SOURCE');
    if (!result.ok) expect(result.error.message).toContain(recovery);
    expect(history.getUndoSize()).toBe(0);
  });

  it('restores trash deletions and supports redo without overwriting an occupied original path', async () => {
    const source = await file('a.txt', 'DELETED');
    expect(await operations.delete([source])).toMatchObject({ ok: true });
    expect(await pathExists(source)).toBe(false);
    await file('a.txt', 'OTHER_FILE');
    await expect(history.undo()).rejects.toThrow('目标已存在');
    expect(await fs.readFile(source, 'utf8')).toBe('OTHER_FILE');
    await fs.unlink(source);
    await history.undo();
    expect(await fs.readFile(source, 'utf8')).toBe('DELETED');
    await history.redo();
    expect(await pathExists(source)).toBe(false);
  });

  it('undoes and redoes writeFile and mkdir through their registered IPC handlers', async () => {
    const existing = await file('existing.txt', 'OLD');
    expect(await handlers.get(IpcChannels.FS_WRITE_FILE)!(null, existing, 'NEW')).toMatchObject({ ok: true });
    await history.undo();
    expect(await fs.readFile(existing, 'utf8')).toBe('OLD');
    await history.redo();
    expect(await fs.readFile(existing, 'utf8')).toBe('NEW');
    expect(await handlers.get(IpcChannels.FS_MKDIR)!(null, root, 'created')).toMatchObject({ ok: true });
    await history.undo();
    expect(await pathExists(join(root, 'created'))).toBe(false);
    await history.redo();
    expect(await pathExists(join(root, 'created'))).toBe(true);
  });
});

describe('transactional batch rename', () => {
  it('preserves both files in the reviewed a -> aa -> aaaa chain, including undo and redo', async () => {
    const first = await file('a.txt', 'FIRST');
    const second = await file('aa.txt', 'SECOND');
    const final = join(root, 'aaaa.txt');
    expect(await handlers.get(IpcChannels.FS_BATCH_RENAME)!(null, [{ oldPath: first, newPath: second }, { oldPath: second, newPath: final }])).toMatchObject({ ok: true });
    expect(await fs.readFile(second, 'utf8')).toBe('FIRST');
    expect(await fs.readFile(final, 'utf8')).toBe('SECOND');
    await history.undo();
    expect(await fs.readFile(first, 'utf8')).toBe('FIRST');
    expect(await fs.readFile(second, 'utf8')).toBe('SECOND');
    await history.redo();
    expect(await fs.readFile(final, 'utf8')).toBe('SECOND');
  });

  it('supports name swaps', async () => {
    const first = await file('a.txt', 'A');
    const second = await file('b.txt', 'B');
    expect(await batchRename([{ oldPath: first, newPath: second }, { oldPath: second, newPath: first }])).toMatchObject({ ok: true });
    expect(await fs.readFile(first, 'utf8')).toBe('B');
    expect(await fs.readFile(second, 'utf8')).toBe('A');
  });

  it('rolls back staged and committed names if a final rename fails', async () => {
    const first = await file('a.txt', 'A');
    const second = await file('aa.txt', 'B');
    const final = join(root, 'aaaa.txt');
    const rename = fs.rename.bind(fs);
    let failed = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === final && !failed) { failed = true; throw Object.assign(new Error('blocked'), { code: 'EACCES' }); }
      return rename(from, to);
    });
    expect(await batchRename([{ oldPath: first, newPath: second }, { oldPath: second, newPath: final }])).toMatchObject({ ok: false });
    expect(await fs.readFile(first, 'utf8')).toBe('A');
    expect(await fs.readFile(second, 'utf8')).toBe('B');
    expect((await fs.readdir(root)).sort()).toEqual(['a.txt', 'aa.txt']);
  });

  it('rejects unrelated occupied destinations before staging any source', async () => {
    const source = await file('a.txt', 'A');
    const occupied = await file('b.txt', 'B');
    expect(await batchRename([{ oldPath: source, newPath: occupied }])).toMatchObject({ ok: false, error: { code: 'EEXIST' } });
    expect(await fs.readFile(source, 'utf8')).toBe('A');
    expect(await fs.readFile(occupied, 'utf8')).toBe('B');
  });
});

describe('RTF converter in the main process', () => {
  it('returns the HTML delivered through the real callback API', async () => {
    const path = await file('sample.rtf', '{\\rtf1\\ansi Hello \\b world\\b0}');
    const result = await readRtf(path);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.data).toContain('Hello'); expect(result.data).toContain('world'); }
  });

  it('reports malformed and missing RTF files', async () => {
    expect(await readRtf(await file('bad.rtf', 'plain text'))).toMatchObject({ ok: false });
    expect(await readRtf(join(root, 'missing.rtf'))).toMatchObject({ ok: false, error: { code: 'ENOENT' } });
  });
});
