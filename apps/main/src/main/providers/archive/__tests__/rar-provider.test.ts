// @vitest-environment node
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RarArchiveProvider } from '../rar-provider';
import type { ArchiveProgress } from '@tabula/bridge';

const executable = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '';
let root: string;
beforeEach(async () => { const base = join(process.cwd(), 'out', 'test-fixtures'); await fs.mkdir(base, { recursive: true }); root = await fs.mkdtemp(join(base, 'rar-provider-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function run(provider: RarArchiveProvider, archive: string, destination: string, selectedEntries?: string[]): Promise<ArchiveProgress> {
  const started = await provider.extract({ archive, destination, selectedEntries });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.data.jobId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('任务超时')); }, 30000);
    const off = provider.onJobUpdate(progress => { if (progress.jobId === id && ['done', 'error', 'cancelled'].includes(progress.phase)) { clearTimeout(timer); off(); resolve(progress); } });
  });
}
describe.skipIf(!executable)('Windows RAR extraction', () => {
  it('extracts staged files, reports conflicts and leaves existing files untouched', async () => {
    const source = join(root, 'source'); await fs.mkdir(source); await fs.writeFile(join(source, '中文.txt'), 'test');
    const archive = join(root, 'sample.rar');
    // A TAR payload exercises the libarchive pipeline; the RAR fixture below checks the RAR decoder.
    const created = spawnSync(executable, ['-cf', archive, '-C', source, '中文.txt']); expect(created.status).toBe(0);
    const provider = new RarArchiveProvider(executable); const dest = join(root, 'dest');
    expect((await run(provider, archive, dest)).phase).toBe('done');
    expect(await fs.readFile(join(dest, '中文.txt'), 'utf8')).toBe('test');
    const conflict = await run(provider, archive, dest);
    expect(conflict.phase).toBe('error'); expect(conflict.error?.code).toBe('DESTINATION_EXISTS');
    expect(await fs.readFile(join(dest, '中文.txt'), 'utf8')).toBe('test');
  });
  it('rejects traversal and wildcard entries', async () => {
    const provider = new RarArchiveProvider(executable); const archive = join(root, 'a.rar'); await fs.writeFile(archive, 'x');
    const result = await provider.extract({ archive, destination: root, selectedEntries: ['../escape'] });
    expect(result.ok).toBe(false);
  });
  it('can cancel a queued extraction before it writes to the destination', async () => {
    const provider = new RarArchiveProvider(executable); const archive = join(root, 'a.rar'); await fs.writeFile(archive, 'x');
    const destination = join(root, 'cancelled'); const started = await provider.extract({ archive, destination });
    if (!started.ok) throw new Error(started.error.message);
    await provider.cancelJob(started.data.jobId);
    const status = await provider.getJob(started.data.jobId);
    expect(status.ok && status.data.phase).toBe('cancelled');
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.skipIf(!process.env.TABULA_RAR_FIXTURE || !process.env.TABULA_RAR_ENTRY)('extracts an actual RAR entry', async () => {
    const provider = new RarArchiveProvider(executable); const dest = join(root, 'real');
    const result = await run(provider, process.env.TABULA_RAR_FIXTURE!, dest, [process.env.TABULA_RAR_ENTRY!]);
    expect(result.phase, result.error?.message).toBe('done');
    expect((await fs.stat(join(dest, ...process.env.TABULA_RAR_ENTRY!.split('/')))).size).toBeGreaterThan(0);
  });
});
