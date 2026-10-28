// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { TarArchiveProvider } from '../tar-provider';
import { encodeTar } from '@tabula/core';
import type { ArchiveProgress } from '@tabula/bridge';
let root: string;
const parent = resolve('out/test-fixtures');
beforeEach(async () => { await fs.mkdir(parent, { recursive: true }); root = await fs.mkdtemp(join(parent, 'tar-provider-')); });
afterEach(async () => { if (dirname(root) !== parent) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }); });
const terminal = (provider: TarArchiveProvider, id: string): Promise<ArchiveProgress> => new Promise((resolveDone, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('Archive job timed out')); }, 10000);
  const off = provider.onJobUpdate(progress => { if (progress.jobId === id && ['done', 'error', 'cancelled'].includes(progress.phase)) { clearTimeout(timer); off(); resolveDone(progress); } });
});
describe('TAR/TGZ archive jobs', () => {
  it.each(['tar', 'tgz'])('roundtrips %s with Chinese names, nested files and empty directories', async format => {
    const source = join(root, 'source'); await fs.mkdir(join(source, '空目录'), { recursive: true }); await fs.writeFile(join(source, '中文.txt'), '文件内容');
    const provider = new TarArchiveProvider(); const archive = join(root, `test.${format}`);
    const task = await provider.compress({ sources: [source], destination: archive }); if (!task.ok) throw new Error(task.error.message);
    expect((await terminal(provider, task.data.jobId)).phase).toBe('done');
    const list = await provider.list(archive); expect(list.ok && list.data.entries.map(e => e.path)).toContain('source/空目录/');
    const output = join(root, 'output'); const extract = await provider.extract({ archive, destination: output }); if (!extract.ok) throw new Error(extract.error.message);
    expect((await terminal(provider, extract.data.jobId)).phase).toBe('done'); expect(await fs.readFile(join(output, 'source', '中文.txt'), 'utf8')).toBe('文件内容');
    expect((await fs.stat(join(output, 'source', '空目录'))).isDirectory()).toBe(true);
  });
  it('preflights conflicts, respects overwrite and cancellation', async () => {
    const archive = join(root, 'a.tar'); await fs.writeFile(archive, encodeTar([{ name: 'a.txt', directory: false, data: new TextEncoder().encode('new') }]));
    const output = join(root, 'out'); await fs.mkdir(output); await fs.writeFile(join(output, 'a.txt'), 'old'); const provider = new TarArchiveProvider();
    const start = await provider.extract({ archive, destination: output }); if (!start.ok) throw new Error(start.error.message);
    expect((await terminal(provider, start.data.jobId)).error?.code).toBe('DESTINATION_EXISTS'); expect(await fs.readFile(join(output, 'a.txt'), 'utf8')).toBe('old');
    const overwrite = await provider.extract({ archive, destination: output, overwrite: true }); if (!overwrite.ok) throw new Error(overwrite.error.message);
    expect((await terminal(provider, overwrite.data.jobId)).phase).toBe('done'); expect(await fs.readFile(join(output, 'a.txt'), 'utf8')).toBe('new');
    const cancel = await provider.extract({ archive, destination: join(root, 'cancelled') }); if (!cancel.ok) throw new Error(cancel.error.message);
    await provider.cancelJob(cancel.data.jobId); expect((await provider.getJob(cancel.data.jobId)).ok).toBe(true); expect(await fs.access(join(root, 'cancelled')).then(() => true, () => false)).toBe(false);
  });
  it('rejects an unsafe TAR member before touching the output tree', async () => {
    const bytes = encodeTar([{ name: 'safe.txt', directory: false, data: new Uint8Array([1]) }]);
    bytes.fill(0, 0, 100); bytes.set(new TextEncoder().encode('../escape.txt')); bytes.fill(32, 148, 156);
    const checksum = bytes.subarray(0, 512).reduce((a, b) => a + b, 0); bytes.set(new TextEncoder().encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);
    const archive = join(root, 'bad.tar'); await fs.writeFile(archive, bytes); const provider = new TarArchiveProvider();
    const task = await provider.extract({ archive, destination: join(root, 'out') }); if (!task.ok) throw new Error(task.error.message);
    expect((await terminal(provider, task.data.jobId)).phase).toBe('error'); expect(await fs.access(join(root, 'escape.txt')).then(() => true, () => false)).toBe(false);
  });
});
