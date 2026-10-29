// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileOperations } from '../operations';
import { TransferJobs } from '../transfer-jobs';
import { UndoManager } from '../../undo/undo-manager';
import type { FileTransferJob } from '@tabula/bridge';

let dir: string;
let source: string;
let destination: string;
beforeEach(async () => {
  const root = join(process.cwd(), 'out', 'test-fixtures');
  await mkdir(root, { recursive: true });
  dir = await mkdtemp(join(root, 'tabula-transfer-'));
  source = join(dir, '源'); destination = join(dir, '目标');
  await mkdir(source); await mkdir(destination);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('file transfer jobs', () => {
  it('copies real files and supports undo and redo', async () => {
    const path = join(source, '测试.txt'); await writeFile(path, 'hello');
    const history = new UndoManager();
    const operations = new FileOperations(join(dir, 'backups'), async () => {}, history);
    const events: FileTransferJob[] = [];
    const jobs = new TransferJobs(operations, (event) => events.push(event));
    const job = jobs.start('copy', { sources: [path], destination });
    expect(await job.result).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(destination, '测试.txt'), 'utf8')).toBe('hello');
    expect(events.at(-1)).toMatchObject({ status: 'completed', completedItems: 1, totalItems: 1 });
    await history.undo(); expect(await readdir(destination)).toEqual([]);
    await history.redo(); expect(await readFile(join(destination, '测试.txt'), 'utf8')).toBe('hello');
  });

  it('cancels a large copy, rolls back the whole batch and permits retry', async () => {
    const first = join(source, 'a.txt'), second = join(source, 'big.bin');
    await writeFile(first, 'first'); await writeFile(second, Buffer.alloc(8 * 1024 * 1024, 7));
    const history = new UndoManager();
    let cancel = true;
    let jobs!: TransferJobs;
    jobs = new TransferJobs(new FileOperations(join(dir, 'backups'), async () => {}, history), (job) => {
      if (cancel && job.completedItems === 1 && job.completedBytes > 5) { cancel = false; jobs.cancel(job.id); }
    });
    const job = jobs.start('copy', { sources: [first, second], destination });
    expect((await job.result).ok).toBe(false);
    expect(jobs.list()[0]).toMatchObject({ status: 'cancelled', error: null });
    expect(await readdir(destination)).toEqual([]);
    expect(await readFile(first, 'utf8')).toBe('first');
    expect(history.getUndoSize()).toBe(0);
    const retry = jobs.retry(job.id)!;
    await jobs.waitForIdle();
    expect(jobs.list().find((item) => item.id === retry)?.status).toBe('completed');
    expect((await readdir(destination)).sort()).toEqual(['a.txt', 'big.bin']);
  });

  it('restores both the source and an overwritten target when a move is cancelled', async () => {
    const first = join(source, 'a.txt'), second = join(source, 'b.txt');
    const existing = join(destination, 'a.txt');
    await writeFile(first, 'new'); await writeFile(second, 'second'); await writeFile(existing, 'old');
    const history = new UndoManager();
    let jobs!: TransferJobs;
    jobs = new TransferJobs(new FileOperations(join(dir, 'backups'), async () => {}, history), (job) => {
      if (job.status === 'running' && job.completedItems === 1) jobs.cancel(job.id);
    });
    const job = jobs.start('move', { sources: [first, second], destination, overwrites: [true, false] });
    expect((await job.result).ok).toBe(false);
    expect(jobs.list()[0].status).toBe('cancelled');
    expect(await readFile(first, 'utf8')).toBe('new');
    expect(await readFile(second, 'utf8')).toBe('second');
    expect(await readFile(existing, 'utf8')).toBe('old');
    expect(await readdir(destination)).toEqual(['a.txt']);
    expect(history.getUndoSize()).toBe(0);
  });

  it('preserves an externally edited target if cancellation cannot safely roll it back', async () => {
    const first = join(source, 'a.txt'), second = join(source, 'b.txt');
    await writeFile(first, 'original'); await writeFile(second, 'second');
    let jobs!: TransferJobs;
    jobs = new TransferJobs(new FileOperations(join(dir, 'backups'), async () => {}, new UndoManager()), (job) => {
      if (job.status === 'running' && job.completedItems === 1) {
        writeFileSync(join(destination, 'a.txt'), 'external edit');
        jobs.cancel(job.id);
      }
    });
    const job = jobs.start('copy', { sources: [first, second], destination });
    expect((await job.result).ok).toBe(false);
    expect(jobs.list()[0].error).toContain('回滚未完成');
    expect(await readFile(join(destination, 'a.txt'), 'utf8')).toBe('external edit');
    expect(jobs.retry(job.id)).toBeNull();
  });

  it.skipIf(!process.env.TABULA_CROSS_VOLUME_TEST_ROOT)('moves a folder across volumes and supports undo and redo', async () => {
    const other = await mkdtemp(join(process.env.TABULA_CROSS_VOLUME_TEST_ROOT!, 'tabula-cross-volume-'));
    try {
      const folder = join(source, '中文目录'); await mkdir(folder);
      await writeFile(join(folder, '资料.txt'), 'cross-volume');
      const history = new UndoManager();
      const jobs = new TransferJobs(new FileOperations(join(dir, 'backups'), async () => {}, history), () => {});
      const job = jobs.start('move', { sources: [folder], destination: other });
      expect(await job.result).toEqual({ ok: true, data: undefined });
      expect(await readFile(join(other, '中文目录', '资料.txt'), 'utf8')).toBe('cross-volume');
      expect(await readdir(source)).toEqual([]);
      await history.undo();
      expect(await readFile(join(folder, '资料.txt'), 'utf8')).toBe('cross-volume');
      await history.redo();
      expect(await readFile(join(other, '中文目录', '资料.txt'), 'utf8')).toBe('cross-volume');
    } finally { await rm(other, { recursive: true, force: true }); }
  });
});
