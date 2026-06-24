/**
 * G016: 后台异步目录大小计算 + 取消支持。
 *
 * 设计要点(参考 archive/archive-manager.ts 的 JOB PATTERN):
 * 1. 用一个 Map<jobId, DirSizeJob> 持有活动 job;每个 job 自带 cancelled 标志位
 * 2. startDirSize() 立即返回 jobId,实际 walk 在后台 async 执行
 * 3. walk 每读 100 个文件广播一次进度(总字节数 / 已处理 entry 数)
 * 4. cancelDirSize() 把 cancelled 置 true,下一次 walk 步进检查时立刻返回
 * 5. 完成后 60s 清理(jobs.delete),避免长跑任务的 Map 泄漏
 * 6. 进度同时通过 BrowserWindow.webContents.send 推送给所有渲染窗口,
 *    也通过 listener Set 暴露给同进程的订阅者(便于单测)
 *
 * 与 archiveManager 区别:dir-size 没有「总 entry 数」(目录大小是流式的,
 * 唯一合理的进度指标是 processedEntries / totalBytes),因此 progress 形态
 * 简化成 processedEntries + totalBytes + done + cancelled。
 */
import { BrowserWindow } from 'electron';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IpcChannels } from '@tabula/bridge';
import type { DirSizeProgress, Result } from '@tabula/bridge';

/** 单个活动的目录大小计算任务 */
interface DirSizeJob {
  id: string;
  path: string;
  cancelled: boolean;
  totalBytes: number;
  processedEntries: number;
  startedAt: number;
}

/** job 注册表 + 订阅者 */
const jobs = new Map<string, DirSizeJob>();
const listeners = new Set<(p: DirSizeProgress) => void>();

/** 每处理 N 个文件广播一次进度 */
const PROGRESS_INTERVAL = 100;

/** job 完成后等待多久才从 Map 清除(给 UI 来得及拉一次终态) */
const CLEANUP_DELAY_MS = 60_000;

/** 仅用于单测 / 内部 — 取当前 job 快照 */
export function getJob(id: string): DirSizeJob | undefined {
  return jobs.get(id);
}

/** 仅用于单测 — 当前活动 job 数 */
export function activeJobCount(): number {
  return jobs.size;
}

/**
 * 启动一个后台目录大小计算任务。立即返回 jobId。
 * 实际 walk 在后台异步执行,通过 `onDirSizeProgress` + IPC `fs:dir-size-progress`
 * 推送进度。最终一次事件 `done=true`。
 */
export function startDirSize(rootPath: string): string {
  const id = randomUUID();
  const job: DirSizeJob = {
    id,
    path: rootPath,
    cancelled: false,
    totalBytes: 0,
    processedEntries: 0,
    startedAt: Date.now(),
  };
  jobs.set(id, job);

  // 后台跑;不阻塞 caller
  void (async () => {
    try {
      await walk(job, rootPath);
      // walk 内部在 cancelled 时也会广播 done,这里只在未被 cancelled 时广播
      if (!job.cancelled) {
        broadcast(toProgress(job, { done: true }));
      }
    } catch (e) {
      // walk 内部已 try/catch 吞掉单文件错误,这里通常不会触发;保险起见广播 error
      if (!job.cancelled) {
        broadcast(
          toProgress(job, {
            done: true,
            error: (e as Error)?.message ?? String(e),
          }),
        );
      }
    } finally {
      // 60s 后清理,让 UI 有机会拉终态
      setTimeout(() => jobs.delete(id), CLEANUP_DELAY_MS).unref?.();
    }
  })();

  return id;
}

/**
 * 取消一个进行中的任务。下一次 walk 步进检查会立即返回,
 * 并立刻广播一次 done=true + cancelled=true 的终态事件。
 * 已不存在的 jobId 返回 false。
 */
export function cancelDirSize(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.cancelled) return true; // 幂等
  job.cancelled = true;
  broadcast(toProgress(job, { done: true, cancelled: true }));
  return true;
}

/** 订阅本进程的进度事件(IPC 推送是另一条路径,通过 BrowserWindow.send) */
export function onDirSizeProgress(fn: (p: DirSizeProgress) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 递归 walk。
 * - 每读一个文件 → stat → 累加 totalBytes,processedEntries += 1
 * - 每 PROGRESS_INTERVAL 个 entry 广播一次进度(广播 = listeners + IPC)
 * - cancelled 标志位在每层目录入口检查,实现「最快下次取消生效」
 */
async function walk(job: DirSizeJob, p: string): Promise<void> {
  if (job.cancelled) return;

  let entries;
  try {
    entries = await readdir(p, { withFileTypes: true });
  } catch {
    // 单目录不可读,跳过(权限不足 / 链接死循环等)
    return;
  }

  for (const e of entries) {
    if (job.cancelled) return;

    const child = join(p, e.name);
    if (e.isDirectory()) {
      await walk(job, child);
    } else if (e.isFile()) {
      try {
        const s = await stat(child);
        job.totalBytes += s.size;
      } catch {
        // 单文件不可读,跳过
      }
      job.processedEntries += 1;
      if (job.processedEntries % PROGRESS_INTERVAL === 0) {
        broadcast(toProgress(job, { done: false }));
      }
    }
    // 其它类型(symlink / socket / block 等)忽略
  }
}

/** 把一个 job 映射成对外的 DirSizeProgress 事件 */
function toProgress(job: DirSizeJob, extra: Partial<DirSizeProgress> = {}): DirSizeProgress {
  return {
    jobId: job.id,
    path: job.path,
    processedEntries: job.processedEntries,
    totalBytes: job.totalBytes,
    cancelled: job.cancelled,
    done: false,
    ...extra,
  };
}

/** 广播:本地 listener + 所有渲染窗口 webContents.send */
function broadcast(p: DirSizeProgress): void {
  // 本进程订阅者
  for (const fn of listeners) {
    try {
      fn(p);
    } catch {
      // 单 listener 抛错不影响其他
    }
  }

  // 跨进程推送(主窗口 / 子窗口都收)
  const channel = IpcChannels.FS_DIR_SIZE_PROGRESS;
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, p);
    } catch {
      // 单窗口失败不影响其他
    }
  }
}

/**
 * IPC handler 直接调用:把 ok/data 包成 Result 返回。
 * getDirSize 立即返回 { jobId };UI 通过 onDirSizeProgress 收进度。
 */
export function handleGetDirSize(path: string): Result<{ jobId: string }> {
  if (!path || typeof path !== 'string') {
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: 'invalid path' },
    };
  }
  const jobId = startDirSize(path);
  return { ok: true, data: { jobId } };
}

/** IPC handler 直接调用:把 boolean 包成 Result 返回 */
export function handleCancelDirSize(jobId: string): Result<void> {
  if (!jobId || typeof jobId !== 'string') {
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: 'invalid jobId' },
    };
  }
  const cancelled = cancelDirSize(jobId);
  if (!cancelled) {
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: 'job not found' },
    };
  }
  return { ok: true, data: undefined };
}