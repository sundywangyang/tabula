// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const { stores } = vi.hoisted(() => ({ stores: new Map<string, Record<string, unknown>>() }));
vi.mock('electron-store', () => ({ default: class {
  state: Record<string, unknown>;
  constructor(options: { name: string; defaults?: Record<string, unknown> }) { if (!stores.has(options.name)) stores.set(options.name, structuredClone(options.defaults ?? {})); this.state = stores.get(options.name)!; }
  get(key: string, fallback?: unknown) { return this.state[key] ?? fallback; }
  set(key: string, value: unknown) { this.state[key] = value; }
} }));
import { FileOperations } from '../../fs/operations';
import { UndoManager } from '../../undo/undo-manager';
import { getTags, setTags, migrateTags } from '../tags-store';
import { recordActivity, listActivity } from '../activity-store';
let root: string;
const parent = resolve('out/test-fixtures');
beforeEach(async () => { await fs.mkdir(parent, { recursive: true }); root = await fs.mkdtemp(join(parent, 'metadata-')); });
afterEach(async () => { if (dirname(root) !== parent) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }); });
describe('file operation metadata', () => {
  it('migrates file and directory-descendant tags through rename, move, undo and redo, and journals phases', async () => {
    const history = new UndoManager(); const operations = new FileOperations(join(root, 'backups'), async () => {}, history, { migrate: migrateTags, record: recordActivity });
    const source = join(root, 'old'); const renamed = join(root, 'renamed'); await fs.mkdir(source); await fs.writeFile(join(source, 'file.txt'), 'content');
    setTags(join(source, 'file.txt'), ['work']); expect((await operations.rename(source, renamed)).ok).toBe(true);
    expect(getTags(join(renamed, 'file.txt'))).toEqual(['work']); expect(getTags(join(source, 'file.txt'))).toEqual([]);
    await history.undo(); expect(getTags(join(source, 'file.txt'))).toEqual(['work']);
    await history.redo(); expect(getTags(join(renamed, 'file.txt'))).toEqual(['work']);
    const target = join(root, 'target'); await fs.mkdir(target);
    expect((await operations.move({ sources: [renamed], destination: target })).ok).toBe(true);
    expect(getTags(join(target, 'renamed', 'file.txt'))).toEqual(['work']);
    await history.undo(); expect(getTags(join(renamed, 'file.txt'))).toEqual(['work']);
    expect(listActivity(root).map(e => e.phase)).toEqual(['undo', 'do', 'redo', 'undo', 'do']);
  });
  it('does not confuse dotted paths or chained simultaneous renames', () => {
    const a = join(root, 'foo'); const b = join(root, 'foo.txt'); const c = join(root, 'third.txt');
    setTags(a, ['one']); setTags(b, ['two']); expect(getTags(a)).toEqual(['one']); expect(getTags(b)).toEqual(['two']);
    migrateTags([{ source: a, destination: b }, { source: b, destination: c }]);
    expect(getTags(b)).toEqual(['one']); expect(getTags(c)).toEqual(['two']);
  });
});
