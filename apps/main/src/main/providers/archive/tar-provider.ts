import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { gzip, gunzipSync } from 'fflate';
import { decodeTar, encodeTar, validateArchiveName, type TarFile } from '@tabula/core';
import type { ArchiveError, ArchiveInfo, ArchiveProgress, CompressRequest, ExtractRequest, Result } from '@tabula/bridge';
import type { ArchiveProvider } from './types';

const failure = (error: unknown): { ok: false; error: ArchiveError } => ({ ok: false, error: {
  code: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'ARCHIVE_NOT_FOUND' : (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'DESTINATION_EXISTS' : 'ARCHIVE_INVALID', message: (error as Error).message ?? String(error),
} });
export const isTarPath = (path: string) => /\.(?:tar|tgz|tar\.gz)$/i.test(path);
const cancelled = (job: ArchiveProgress) => job.phase === 'cancelled';
export class TarArchiveProvider implements ArchiveProvider {
  private jobs = new Map<string, ArchiveProgress & { stop?: () => void }>();
  private listeners = new Set<(p: ArchiveProgress) => void>();
  onJobUpdate(listener: (p: ArchiveProgress) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(job: ArchiveProgress, update: Partial<ArchiveProgress>) { Object.assign(job, update); const { stop, ...progress } = job as ArchiveProgress & { stop?: () => void }; for (const listener of this.listeners) listener(progress); }
  async getJob(id: string): Promise<Result<ArchiveProgress, ArchiveError>> { const job = this.jobs.get(id); return job ? { ok: true, data: { ...job, stop: undefined } as ArchiveProgress } : { ok: false, error: { code: 'JOB_NOT_FOUND', message: '找不到任务' } }; }
  async cancelJob(id: string): Promise<Result<void, ArchiveError>> {
    const job = this.jobs.get(id); if (!job) return { ok: false, error: { code: 'JOB_NOT_FOUND', message: '找不到任务' } };
    if (!['done', 'error', 'cancelled'].includes(job.phase)) { job.stop?.(); this.emit(job, { phase: 'cancelled' }); }
    return { ok: true, data: undefined };
  }
  private async read(path: string) { const stat = await fs.stat(path); if (stat.size > 1024 ** 3) throw new Error('归档超过 1 GB 上限'); const bytes = await fs.readFile(path); return decodeTar(/\.(tgz|gz)$/i.test(path) ? gunzipSync(bytes) : bytes); }
  async list(path: string): Promise<Result<ArchiveInfo, ArchiveError>> {
    try { const files = await this.read(path); return { ok: true, data: { format: /\.tar$/i.test(path) ? 'tar' : 'tgz', totalEntries: files.length, totalSize: files.reduce((s, f) => s + f.data.length, 0), totalCompressedSize: (await fs.stat(path)).size,
      entries: files.map(f => ({ path: f.name, size: f.data.length, compressedSize: f.data.length, isDirectory: f.directory })) } }; } catch (e) { return failure(e); }
  }
  private start(work: (job: ArchiveProgress & { stop?: () => void }) => Promise<void>): Result<{ jobId: string }, ArchiveError> {
    const job = { jobId: randomUUID(), phase: 'pending' as const, total: -1, processed: 0 } as ArchiveProgress & { stop?: () => void };
    this.jobs.set(job.jobId, job);
    setImmediate(async () => { try { if (cancelled(job)) return; await work(job); if (!cancelled(job)) this.emit(job, { phase: 'done' }); }
      catch (e) { if (!cancelled(job)) this.emit(job, { phase: 'error', error: failure(e).error }); }
      finally { setTimeout(() => this.jobs.delete(job.jobId), 60000).unref(); } });
    return { ok: true, data: { jobId: job.jobId } };
  }
  async compress(request: CompressRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    if (!request.sources?.length || !isTarPath(request.destination)) return failure(new Error('请选择来源及 TAR/TGZ 输出路径'));
    return this.start(async job => {
      const files: TarFile[] = []; const names = new Set<string>(); let bytes = 0;
      const visit = async (path: string, name: string): Promise<void> => {
        if (job.phase === 'cancelled') return;
        const stat = await fs.lstat(path); if (stat.isSymbolicLink()) return;
        if (resolve(path) === resolve(request.destination)) throw new Error('输出归档不能位于来源目录内');
        if (names.has(name)) throw new Error(`重复归档名称: ${name}`); names.add(name);
        if (stat.isDirectory()) {
          files.push({ name: name + '/', data: new Uint8Array(), directory: true });
          for (const child of await fs.readdir(path)) await visit(join(path, child), name + '/' + child);
        } else if (stat.isFile()) {
          bytes += stat.size; if (bytes > 1024 ** 3) throw new Error('归档原始数据超过 1 GB 上限');
          files.push({ name, data: new Uint8Array(await fs.readFile(path)), directory: false });
        }
        this.emit(job, { phase: 'reading', processed: files.length, currentEntry: name });
      };
      for (const source of request.sources) {
        if (relative(source, request.destination) && !relative(source, request.destination).startsWith('..') && (await fs.stat(source)).isDirectory()) throw new Error('归档目标不能放在被压缩的目录中');
        await visit(source, basename(source));
      }
      if (cancelled(job)) return;
      this.emit(job, { phase: 'compressing', total: files.length, processed: files.length });
      const tar = encodeTar(files);
      const output = /\.tar$/i.test(request.destination) ? tar : await new Promise<Uint8Array>((resolveZip, reject) => { const stop = gzip(tar, (error, data) => error ? reject(error) : resolveZip(data)); job.stop = () => { stop(); resolveZip(new Uint8Array()); }; });
      if (cancelled(job)) return;
      this.emit(job, { phase: 'writing' });
      await fs.writeFile(request.destination, output, { flag: 'wx' });
    });
  }
  async extract(request: ExtractRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    if (!request.archive || !request.destination) return failure(new Error('请选择归档和解压目录'));
    return this.start(async job => {
      const files = (await this.read(request.archive)).filter(f => !request.selectedEntries?.length || request.selectedEntries.includes(f.name));
      const root = resolve(request.destination); const seen = new Set<string>();
      const safe = async (path: string) => {
        let current = resolve(path);
        while (true) {
          const st = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
          if (st?.isSymbolicLink()) throw new Error(`禁止经过符号链接解压: ${current}`);
          const parent = dirname(current); if (parent === current) break; current = parent;
        }
      };
      for (const file of files) {
        const target = resolve(root, validateArchiveName(file.name));
        if (target !== root && !target.startsWith(root + sep)) throw new Error('归档路径超出目标');
        const key = process.platform === 'win32' ? target.toLowerCase() : target;
        if (seen.has(key)) throw new Error('归档包含重复路径'); seen.add(key);
        await safe(target);
        const stat = await fs.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
        if (stat && (!file.directory && (!request.overwrite || !stat.isFile()) || file.directory && !stat.isDirectory())) throw Object.assign(new Error(`目标已存在: ${target}`), { code: 'EEXIST' });
      }
      this.emit(job, { phase: 'extracting', total: files.length, processed: 0 });
      for (const [index, file] of files.entries()) {
        if (job.phase === 'cancelled') return;
        const target = resolve(root, file.name); await safe(target);
        if (file.directory) await fs.mkdir(target, { recursive: true });
        else { await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, file.data, { flag: request.overwrite ? 'w' : 'wx' }); }
        this.emit(job, { processed: index + 1, currentEntry: file.name });
      }
    });
  }
}
