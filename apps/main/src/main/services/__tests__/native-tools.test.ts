// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const { stores, openExternal } = vi.hoisted(() => ({ stores: new Map<string, Record<string, unknown>>(), openExternal: vi.fn(async () => {}) }));
vi.mock('electron-store', () => ({ default: class {
  state: Record<string, unknown>;
  constructor(opts: { name: string; defaults?: Record<string, unknown> }) { if (!stores.has(opts.name)) stores.set(opts.name, structuredClone(opts.defaults ?? {})); this.state = stores.get(opts.name)!; }
  get(key: string, fallback?: unknown) { return this.state[key] ?? fallback; }
  set(key: string, value: unknown) { this.state[key] = value; }
} }));
vi.mock('electron', () => ({ shell: { openExternal }, nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize() { return this; }, toPNG: () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=', 'base64') }) } }));
import { createLink, linkInfo, retargetLink } from '../links';
import { setFolderIcon, folderIcons } from '../folder-icons';
import { FileToolsService } from '../file-tools';
let root: string;
const parent = resolve('out/test-fixtures');
beforeEach(async () => { await fs.mkdir(parent, { recursive: true }); root = await fs.mkdtemp(join(parent, 'native-tools-')); });
afterEach(async () => { if (dirname(root) !== parent) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }); });
describe('native file tools', () => {
  it('creates real hard links and identifies shared file data', async () => {
    const source = join(root, 'source.txt'), link = join(root, 'hard.txt'); await fs.writeFile(source, 'first');
    const result = await createLink(source, link, 'hardlink'); expect(result.kind).toBe('hardlink'); expect(result.links).toBe(2);
    await fs.writeFile(link, 'changed'); expect(await fs.readFile(source, 'utf8')).toBe('changed');
    expect((await linkInfo(source)).inode).toBe(result.inode);
    await expect(createLink(source, link, 'hardlink')).rejects.toThrow();
  });
  it('retargets a real directory junction while preserving the original targets', async () => {
    const a = join(root, 'a'), b = join(root, 'b'), link = join(root, 'link'); await fs.mkdir(a); await fs.mkdir(b);
    await createLink(a, link, 'symlink'); await retargetLink(link, b);
    expect(await fs.realpath(link)).toBe(await fs.realpath(b)); expect((await fs.stat(a)).isDirectory()).toBe(true);
    await fs.unlink(link);
  });
  it('writes a Windows folder icon, shows it in the app, and restores the original desktop.ini', async () => {
    const directory = join(root, 'folder'); await fs.mkdir(directory); const original = Buffer.from('[.ShellClassInfo]\r\nInfoTip=Keep this\r\n', 'utf8');
    await fs.writeFile(join(directory, 'desktop.ini'), original);
    const run = vi.fn(async () => ''); const data = await setFolderIcon(directory, join(root, 'image.png'), false, run);
    expect(data).toMatch(/^data:image\/png;base64,/); expect(folderIcons([directory])[directory]).toBe(data);
    if (process.platform === 'win32') { expect(await fs.readFile(join(directory, '.tabula-folder.ico')).then(b => b.readUInt16LE(2))).toBe(1); expect(run).toHaveBeenCalledWith('attrib.exe', ['+r', directory]); }
    await setFolderIcon(directory, undefined, true, run); expect(folderIcons([directory])).toEqual({});
    expect(await fs.readFile(join(directory, 'desktop.ini'))).toEqual(original);
  });
  it('returns Result failures and opens the supported Windows default-app selection page', async () => {
    const service = new FileToolsService(() => {});
    expect((await service.run('linkInfo', { path: join(root, 'missing') })).ok).toBe(false);
    if (process.platform === 'win32') { expect((await service.run('defaultApplication', { path: join(root, 'a.txt') })).ok).toBe(true); expect(openExternal).toHaveBeenCalledWith('ms-settings:defaultapps?fileExt=.txt'); }
  });
});
