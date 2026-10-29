import { randomUUID } from 'node:crypto';
import type { FileTransferJob, MoveOrCopyRequest, Result } from '@tabula/bridge';
import type { FileOperations } from './operations';
import { checkCancelled, measureTransfer, type TransferControl } from './transfer-control';

interface JobState {
  info: FileTransferJob;
  request: MoveOrCopyRequest;
  controller: AbortController;
  resolve: (result: Result<void>) => void;
  result: Promise<Result<void>>;
}

export class TransferJobs {
  private jobs = new Map<string, JobState>();
  private queue: JobState[] = [];
  private running = false;
  constructor(private readonly operations: FileOperations, private readonly publish: (info: FileTransferJob) => void,
    private readonly afterSuccess?: (mode: 'copy' | 'move', request: MoveOrCopyRequest) => Promise<void>) {}

  start(mode: 'copy' | 'move', request: MoveOrCopyRequest): { id: string; result: Promise<Result<void>> } {
    const id = randomUUID();
    let resolve!: (result: Result<void>) => void;
    const result = new Promise<Result<void>>((done) => { resolve = done; });
    const job: JobState = { request: structuredClone(request), controller: new AbortController(), resolve, result,
      info: { id, mode, status: 'queued', totalItems: request.sources.length, completedItems: 0, totalBytes: null, completedBytes: 0, currentPath: null, bytesPerSecond: null, remainingSeconds: null, error: null, warning: null } };
    this.jobs.set(id, job); this.queue.push(job); this.emit(job); void this.pump();
    return { id, result };
  }

  list(): FileTransferJob[] { return [...this.jobs.values()].map((job) => ({ ...job.info })); }
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || !['queued', 'running'].includes(job.info.status)) return false;
    job.controller.abort(); job.info.status = 'cancelling'; this.emit(job);
    return true;
  }
  retry(id: string): string | null {
    const job = this.jobs.get(id);
    return job && ['failed', 'cancelled'].includes(job.info.status) && !job.info.error?.includes('回滚未完成')
      ? this.start(job.info.mode, job.request).id : null;
  }
  cancelAll(): void { for (const job of this.jobs.values()) this.cancel(job.info.id); }
  async waitForIdle(): Promise<void> { await Promise.all([...this.jobs.values()].map((job) => job.result)); }

  private emit(job: JobState): void {
    try { this.publish({ ...job.info }); }
    catch (error) { console.warn('文件任务状态通知失败', error); }
  }
  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        const started = Date.now();
        let lastUpdate = 0;
        const update = (force = false) => {
          const now = Date.now();
          const elapsed = (now - started) / 1000;
          job.info.bytesPerSecond = elapsed > 0 && job.info.completedBytes > 0 ? job.info.completedBytes / elapsed : null;
          job.info.remainingSeconds = job.info.totalBytes !== null && job.info.bytesPerSecond ? Math.max(0, job.info.totalBytes - job.info.completedBytes) / job.info.bytesPerSecond : null;
          if (force || now - lastUpdate >= 150) { lastUpdate = now; this.emit(job); }
        };
        let result: Result<void>;
        try {
          checkCancelled(job.controller.signal);
          job.info.status = 'running'; this.emit(job);
          job.info.totalBytes = await measureTransfer(job.request.sources, job.controller.signal); update(true);
          const control: TransferControl = {
            signal: job.controller.signal,
            onFile: (path) => { job.info.currentPath = path; update(true); lastUpdate = 0; },
            onBytes: (count) => { job.info.completedBytes += count; update(); },
            onItem: () => { job.info.completedItems++; update(true); },
          };
          result = await this.operations[job.info.mode](job.request, control);
        } catch (error) {
          result = { ok: false, error: { code: (error as NodeJS.ErrnoException).code === 'ABORT_ERR' ? 'ABORT_ERR' : 'UNKNOWN', message: String(error) } };
        }
        if (result.ok) {
          job.info.status = 'completed'; job.info.completedItems = job.info.totalItems;
          if (job.info.totalBytes !== null) job.info.completedBytes = job.info.totalBytes;
          update(true);
          try { await this.afterSuccess?.(job.info.mode, job.request); }
          catch (error) { job.info.warning = `文件已移动，但剪贴板清理失败: ${String(error)}`; }
        } else {
          // Rollback errors must remain visible even when cancellation was requested.
          const rollbackFailed = result.error.message.includes('回滚未完成');
          job.info.status = result.error.code === 'ABORT_ERR' && !rollbackFailed ? 'cancelled' : 'failed';
          job.info.error = job.info.status === 'failed' ? result.error.message : null;
        }
        job.info.currentPath = null; job.info.remainingSeconds = null; update(true);
        job.resolve(result);
      }
    } finally { this.running = false; }
  }
}
