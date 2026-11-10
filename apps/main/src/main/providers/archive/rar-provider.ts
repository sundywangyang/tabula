import { spawn, type ChildProcess } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ArchiveError, ArchiveInfo, ArchiveProgress, CompressRequest, ExtractRequest, Result } from '@tabula/bridge';
import type { ArchiveProvider } from './types';

const unsupported = (message: string): ArchiveError => ({ code: 'ARCHIVE_UNSUPPORTED', message });
const errorFor = (error: unknown): ArchiveError => {
  const e = error as NodeJS.ErrnoException;
  return { code: e.code === 'ENOENT' ? 'ARCHIVE_NOT_FOUND' : e.code === 'EEXIST' ? 'DESTINATION_EXISTS' : 'ARCHIVE_INVALID', message: e.message ?? String(error) };
};
type Job = ArchiveProgress & { child?: ChildProcess; cancelled?: boolean };

/** Windows includes libarchive's bsdtar, which can read RAR archives. */
export class RarArchiveProvider implements ArchiveProvider {
  private jobs = new Map<string, Job>();
  private listeners = new Set<(progress: ArchiveProgress) => void>();
  constructor(private executable = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '') {}
  private emit(job: Job, patch: Partial<ArchiveProgress>) {
    Object.assign(job, patch);
    const { child, cancelled, ...progress } = job;
    for (const listener of this.listeners) listener(progress);
  }
  onJobUpdate(listener: (progress: ArchiveProgress) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async getJob(id: string): Promise<Result<ArchiveProgress, ArchiveError>> {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, error: { code: 'JOB_NOT_FOUND', message: '找不到任务' } };
    const { child, cancelled, ...progress } = job; return { ok: true, data: progress };
  }
  async cancelJob(id: string): Promise<Result<void, ArchiveError>> {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, error: { code: 'JOB_NOT_FOUND', message: '找不到任务' } };
    if (!['done', 'error', 'cancelled'].includes(job.phase)) { job.cancelled = true; job.child?.kill(); this.emit(job, { phase: 'cancelled' }); }
    return { ok: true, data: undefined };
  }
  async list(_path: string): Promise<Result<ArchiveInfo, ArchiveError>> {
    return { ok: false, error: unsupported('RAR 文件列表暂不支持，请使用其他应用打开') };
  }
  async compress(_request: CompressRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    return { ok: false, error: unsupported('暂不支持创建 RAR 文件') };
  }
  async extract(request: ExtractRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    if (!this.executable) return { ok: false, error: unsupported('当前系统不支持内置 RAR 解压，请使用其他应用打开') };
    if (!request.archive || !request.destination || !isAbsolute(request.archive) || !isAbsolute(request.destination)) return { ok: false, error: { code: 'IO_ERROR', message: '请选择有效的归档和解压目录' } };
    try { await fs.access(this.executable); }
    catch { return { ok: false, error: unsupported('未找到 Windows 解压组件，请使用其他应用打开 RAR') }; }
    try { await fs.access(request.archive); }
    catch (error) { return { ok: false, error: errorFor(error) }; }
    if (request.selectedEntries?.some(name => !name || name.startsWith('-') || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.') || /[*?\[\]:\x00-\x1f]/.test(name))) {
      return { ok: false, error: { code: 'ARCHIVE_INVALID', message: '归档条目路径无效' } };
    }
    const job: Job = { jobId: randomUUID(), phase: 'pending', total: -1, processed: 0 };
    this.jobs.set(job.jobId, job);
    setImmediate(() => void this.run(job, request));
    return { ok: true, data: { jobId: job.jobId } };
  }
  private async run(job: Job, request: ExtractRequest) {
    let staging: string | undefined;
    try {
      if (job.cancelled) return;
      staging = await fs.mkdtemp(join(tmpdir(), 'tabula-rar-'));
      this.emit(job, { phase: 'reading' });
      await new Promise<void>((resolveDone, reject) => {
        const args = ['-xf', request.archive, '-C', staging!, '--no-same-owner', '--no-same-permissions', '--', ...(request.selectedEntries ?? [])];
        const child = spawn(this.executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        job.child = child; let stderr = '';
        child.stderr?.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString(); });
        child.once('error', reject);
        child.once('close', code => code === 0 || job.cancelled ? resolveDone() : reject(new Error(stderr.trim() || `RAR 解压程序退出 (${code})`)));
        if (job.cancelled) child.kill();
      });
      job.child = undefined;
      if (job.cancelled) return;
      const root = resolve(request.destination);
      const files: { source: string; target: string; directory: boolean }[] = [];
      const visit = async (directory: string): Promise<void> => {
        for (const item of await fs.readdir(directory, { withFileTypes: true })) {
          const source = join(directory, item.name); const stat = await fs.lstat(source);
          if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`归档包含不支持的链接或特殊文件: ${item.name}`);
          const target = resolve(root, relative(staging!, source));
          if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('归档路径超出目标目录');
          files.push({ source, target, directory: stat.isDirectory() });
          if (stat.isDirectory()) await visit(source);
        }
      };
      await visit(staging);
      const checkPath = async (path: string) => {
        let current = path;
        while (true) {
          const stat = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
          if (stat?.isSymbolicLink()) throw new Error(`解压路径不能经过链接: ${current}`);
          const parent = dirname(current); if (parent === current) break; current = parent;
        }
      };
      await checkPath(root);
      for (const file of files) {
        await checkPath(file.target);
        const stat = await fs.lstat(file.target).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
        if (stat && (file.directory ? !stat.isDirectory() : !request.overwrite || !stat.isFile())) throw Object.assign(new Error(`目标已存在: ${file.target}`), { code: 'EEXIST' });
      }
      this.emit(job, { phase: 'extracting', processed: 0, total: files.length });
      await fs.mkdir(root, { recursive: true });
      for (const file of files) {
        if (job.cancelled) return;
        await checkPath(file.target);
        if (file.directory) await fs.mkdir(file.target, { recursive: true });
        else { await fs.mkdir(dirname(file.target), { recursive: true }); await fs.copyFile(file.source, file.target, request.overwrite ? 0 : constants.COPYFILE_EXCL); }
        this.emit(job, { processed: job.processed + 1, currentEntry: relative(root, file.target), percent: Math.round((job.processed + 1) * 100 / files.length) });
      }
      if (!job.cancelled) this.emit(job, { phase: 'done' });
    } catch (error) {
      if (!job.cancelled) this.emit(job, { phase: 'error', error: errorFor(error) });
    } finally {
      if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      setTimeout(() => this.jobs.delete(job.jobId), 60000).unref();
    }
  }
}
