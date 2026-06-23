/**
 * ZipArchiveProvider — 基于 fflate 的 ZIP 归档实现。
 *
 * 设计要点:
 * - 三个公开方法都立即返回 jobId(同步),实际工作在下一 microtask 跑
 * - 进度通过 `listeners` 集合推送;UI 端订阅 onJobUpdate
 * - 取消通过 fflate 返回的 terminator + 内部 cancelled flag 双保险
 * - 路径安全: 解压时校验 entry 路径不脱出 destination(Zip Slip)
 * - 跨平台: 压缩前 `split(sep).join('/')` 把 Win 路径转 POSIX
 * - 中文文件名: fflate 默认开 UTF-8 flag,无需手动处理
 *
 * 内存压力: 单文件全量加载 Uint8Array → 适合 GB 级以下;
 *           TB 级暂未支持(留给 v2 流式 streaming)。
 */
import { randomUUID } from 'node:crypto';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { zip, unzip, Unzip } from 'fflate';
import type {
  ArchiveError,
  ArchiveErrorCode,
  ArchiveInfo,
  ArchiveProgress,
  CompressRequest,
  ExtractRequest,
  Result,
} from '@tabula/bridge';
import type { ArchiveJobInternal, ArchiveProvider } from './types';

/** 当前支持的格式(只 zip) */
const SUPPORTED_EXT = new Set(['.zip', '.zipx']);

/** 检查文件扩展名是否为支持的归档格式 */
export function isArchivePath(p: string): boolean {
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
  return SUPPORTED_EXT.has(ext);
}

/** 错误构造助手: 让所有 error 路径走同一条出口 */
function err(code: ArchiveErrorCode, message: string, path?: string): ArchiveError {
  return { code, message, ...(path ? { path } : {}) };
}

/** fflate FlateError → ArchiveError 映射 */
function mapFlateError(e: unknown): ArchiveError {
  const errObj = e as { code?: number; message?: string };
  if (errObj?.code === 8 /* InvalidUTF8 */) {
    return err('ARCHIVE_UNSUPPORTED', '归档包含非 UTF-8 文件名,暂不支持', undefined);
  }
  // fflate code 13 = InvalidZipData
  if (errObj?.code === 13) {
    return err('ARCHIVE_INVALID', 'ZIP 数据损坏或不是有效的 ZIP 格式', undefined);
  }
  return err('ARCHIVE_INVALID', errObj?.message ?? 'ZIP 解析失败', undefined);
}

/** 把 NodeJS.ErrnoException → ArchiveError */
function mapIoError(e: unknown, path?: string): ArchiveError {
  const eObj = e as NodeJS.ErrnoException;
  if (eObj?.code === 'ENOENT') return err('ARCHIVE_NOT_FOUND', eObj.message, path);
  return err('IO_ERROR', eObj?.message ?? String(e), path);
}

/** 把 Win / POSIX 路径分隔符统一为 / (ZIP 协议要求) */
function toZipPath(p: string): string {
  return p.split(sep).join('/');
}

/** 递归扫描目录,产出所有 entry 路径(相对于 baseDir) */
async function scanDir(
  baseDir: string,
  currentDir: string,
  out: Array<{ absPath: string; relPath: string; isDirectory: boolean }>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch (e) {
    throw mapIoError(e, currentDir);
  }
  for (const entry of entries) {
    const abs = join(currentDir, entry.name);
    if (entry.isSymbolicLink()) {
      // 跳过符号链接(避免 Zip Slip 风险 + 递归炸弹)
      continue;
    }
    const rel = relative(baseDir, abs);
    if (entry.isDirectory()) {
      out.push({ absPath: abs, relPath: toZipPath(rel), isDirectory: true });
      await scanDir(baseDir, abs, out);
    } else if (entry.isFile()) {
      out.push({ absPath: abs, relPath: toZipPath(rel), isDirectory: false });
    }
  }
}

export class ZipArchiveProvider implements ArchiveProvider {
  private jobs = new Map<string, ArchiveJobInternal>();
  private listeners = new Set<(p: ArchiveProgress) => void>();

  // =============== 公共 API ===============

  async list(archivePath: string): Promise<Result<ArchiveInfo, ArchiveError>> {
    let buffer: Uint8Array;
    try {
      const buf = await fs.readFile(archivePath);
      buffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (e) {
      return { ok: false, error: mapIoError(e, archivePath) };
    }

    // 快速校验 ZIP magic: 局部文件头 0x504b0304 (PK\x03\x04) 或
    // 目录结束记录 0x504b0506 (PK\x05\x06)。任一出现即可视为有效 ZIP 起始。
    if (buffer.length < 4) {
      return { ok: false, error: err('ARCHIVE_INVALID', '文件太小,不是有效的 ZIP') };
    }
    const magic = (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
    // ZIP 起始 magic 可能是 LFH (0x504b0304) 或 EOCD (0x504b0506)
    // 注: 加密 ZIP 的 LFH general purpose flag bit 0 set, 不影响 magic
    const isZipStart =
      magic === 0x504b0304 ||
      magic === 0x504b0506 ||
      // 数据描述符 (用于 streaming 写入,无 LFH) 的 magic 也是 0x504b0708 — 同样算有效
      magic === 0x504b0708;
    if (!isZipStart) {
      return { ok: false, error: err('ARCHIVE_INVALID', '不是有效的 ZIP 格式(签名不匹配)') };
    }

    const entries: ArchiveInfo['entries'] = [];
    let totalSize = 0;
    let totalCompressedSize = 0;

    // 使用 streaming Unzip 来获取每个 entry 的 compressedSize
    const uz = new Unzip((file) => {
      const isDir = file.name.endsWith('/');
      entries.push({
        path: file.name,
        // fflate 在 Unzip 回调中 size/originalSize 是 optional(目录条目可能没有)
        size: file.originalSize ?? 0,
        compressedSize: file.size ?? 0,
        isDirectory: isDir,
      });
      totalSize += file.originalSize ?? 0;
      totalCompressedSize += file.size ?? 0;
      // 必须挂 ondata 即使不写数据(否则 stream 不会推进)
      file.ondata = () => {
        // 丢弃数据,只采集元信息
      };
    });

    try {
      // 分块推送避免大文件一次性 push 全部
      const CHUNK = 256 * 1024;
      let offset = 0;
      while (offset < buffer.length) {
        const end = Math.min(offset + CHUNK, buffer.length);
        const isLast = end === buffer.length;
        uz.push(buffer.subarray(offset, end), isLast);
        offset = end;
      }
    } catch (e) {
      return { ok: false, error: mapFlateError(e) };
    }

    // 排序: 目录先,文件按路径
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    return {
      ok: true,
      data: {
        format: 'zip',
        totalEntries: entries.length,
        totalSize,
        totalCompressedSize,
        entries,
      },
    };
  }

  async compress(req: CompressRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    // 1. 校验 sources 全部存在
    if (!req.sources?.length) {
      return { ok: false, error: err('IO_ERROR', 'sources 不能为空') };
    }
    if (!req.destination) {
      return { ok: false, error: err('IO_ERROR', 'destination 不能为空') };
    }
    for (const src of req.sources) {
      try {
        await fs.access(src);
      } catch (e) {
        return { ok: false, error: mapIoError(e, src) };
      }
    }

    // 2. 检查 destination 父目录
    const destParent = dirname(req.destination);
    try {
      await fs.mkdir(destParent, { recursive: true });
    } catch (e) {
      return { ok: false, error: mapIoError(e, destParent) };
    }

    const jobId = randomUUID();
    const job: ArchiveJobInternal = {
      jobId,
      phase: 'pending',
      processed: 0,
      total: -1,
      cancelled: false,
    };
    this.jobs.set(jobId, job);
    this.broadcast(job, 'pending');

    // 3. 异步执行(下一 microtask,让调用方先收到 jobId)
    queueMicrotask(() => {
      void this.runCompress(job, req);
    });

    return { ok: true, data: { jobId } };
  }

  async extract(req: ExtractRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    if (!req.archive) {
      return { ok: false, error: err('IO_ERROR', 'archive 不能为空') };
    }
    if (!req.destination) {
      return { ok: false, error: err('IO_ERROR', 'destination 不能为空') };
    }
    // 检查归档是否存在
    try {
      await fs.access(req.archive);
    } catch (e) {
      return { ok: false, error: mapIoError(e, req.archive) };
    }

    // 检查 destination 是否已存在(目录)
    // 如果 destination 存在且 overwrite=false,扫描 entries 后会发现冲突(下面)
    // 这里只先确保 destination 父目录存在;destination 本身会在解压时按 entry 创建
    const destParent = dirname(req.destination);
    try {
      await fs.mkdir(destParent, { recursive: true });
    } catch (e) {
      return { ok: false, error: mapIoError(e, destParent) };
    }

    const jobId = randomUUID();
    const job: ArchiveJobInternal = {
      jobId,
      phase: 'pending',
      processed: 0,
      total: -1,
      cancelled: false,
      destination: req.destination,
    };
    this.jobs.set(jobId, job);
    this.broadcast(job, 'pending');

    queueMicrotask(() => {
      void this.runExtract(job, req);
    });

    return { ok: true, data: { jobId } };
  }

  async getJob(jobId: string): Promise<Result<ArchiveProgress, ArchiveError>> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { ok: false, error: err('JOB_NOT_FOUND', `job ${jobId} 不存在`) };
    }
    return { ok: true, data: this.toProgress(job) };
  }

  async cancelJob(jobId: string): Promise<Result<void, ArchiveError>> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { ok: false, error: err('JOB_NOT_FOUND', `job ${jobId} 不存在`) };
    }
    job.cancelled = true;
    if (job.terminator) {
      try {
        job.terminator();
      } catch {
        // ignore
      }
    }
    return { ok: true, data: undefined };
  }

  onJobUpdate(listener: (p: ArchiveProgress) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // =============== 内部 ===============

  private toProgress(job: ArchiveJobInternal): ArchiveProgress {
    const p: ArchiveProgress = {
      jobId: job.jobId,
      phase: job.phase,
      processed: job.processed,
      total: job.total,
    };
    if (job.currentEntry !== undefined) p.currentEntry = job.currentEntry;
    if (job.phase === 'error' && job.lastError) {
      p.error = job.lastError;
    }
    if (job.phase !== 'done' && job.phase !== 'error' && job.phase !== 'cancelled') {
      if (job.total > 0) {
        p.percent = Math.floor((job.processed / job.total) * 100);
      }
    }
    return p;
  }

  private broadcast(job: ArchiveJobInternal, phase: ArchiveProgress['phase']): void {
    job.phase = phase;
    const progress = this.toProgress(job);
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch {
        // 单个 listener 异常不影响其他
      }
    }
  }

  private broadcastError(job: ArchiveJobInternal, error: ArchiveError): void {
    job.phase = 'error';
    job.lastError = error;
    const progress: ArchiveProgress = {
      jobId: job.jobId,
      phase: 'error',
      processed: job.processed,
      total: job.total,
      error,
    };
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch {
        // ignore
      }
    }
  }

  private async runCompress(
    job: ArchiveJobInternal,
    req: CompressRequest,
  ): Promise<void> {
    try {
      // 阶段 1: 扫描 sources
      const entries: Array<{ absPath: string; relPath: string; isDirectory: boolean }> = [];

      // 决定 entry 的"根路径": 如果只传一个文件夹,用文件夹名作为顶级目录
      // 多个 source 时,每个 source 自己作为顶级 entry(目录或文件)
      const isSingleFolder = req.sources.length === 1;
      let singleFolderName = '';
      if (isSingleFolder) {
        try {
          const stat = await fs.stat(req.sources[0]);
          if (stat.isDirectory()) {
            singleFolderName = basename(req.sources[0]);
          }
        } catch {
          // ignore;按多 source 处理
        }
      }

      for (const src of req.sources) {
        const stat = await fs.stat(src);
        if (stat.isDirectory()) {
          const baseName = basename(src);
          const subs: Array<{ absPath: string; relPath: string; isDirectory: boolean }> = [];
          await scanDir(src, src, subs);
          // 子项的 relPath 前面拼上 baseName
          for (const s of subs) {
            entries.push({
              absPath: s.absPath,
              relPath: s.isDirectory
                ? `${toZipPath(baseName)}/${s.relPath.replace(/\/$/, '')}`.replace(/\/+$/, '')
                : `${toZipPath(baseName)}/${s.relPath}`,
              isDirectory: s.isDirectory,
            });
          }
          // 顶级目录 entry
          entries.unshift({
            absPath: src,
            relPath: toZipPath(baseName),
            isDirectory: true,
          });
        } else {
          // 文件 — 顶层,文件名 = basename
          entries.push({
            absPath: src,
            relPath: toZipPath(basename(src)),
            isDirectory: false,
          });
        }
      }

      job.total = entries.length;
      this.broadcast(job, 'reading');

      // 阶段 2: 读文件到内存 + 构建 Zippable
      // 注意: fflate 的 AsyncZippable 支持 Uint8Array | [Uint8Array, AsyncZipOptions]
      // 单文件最大 GB 级;超此限制需要 streaming(v2)
      const zippable: Record<string, [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {};
      const level = (req.level ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

      let processed = 0;
      for (const entry of entries) {
        if (job.cancelled) {
          this.broadcast(job, 'cancelled');
          return;
        }
        job.currentEntry = entry.relPath;
        if (entry.isDirectory) {
          // 目录在 Zippable 里就用空 Uint8Array + 以 / 结尾的 key
          zippable[`${entry.relPath}/`] = [new Uint8Array(0), { level: 0 }];
        } else {
          try {
            const buf = await fs.readFile(entry.absPath);
            // 转 Uint8Array(fflate 接受)
            zippable[entry.relPath] = [new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { level }];
          } catch (e) {
            this.broadcastError(job, mapIoError(e, entry.absPath));
            return;
          }
        }
        processed++;
        job.processed = processed;
        this.broadcast(job, 'reading');
      }

      if (job.cancelled) {
        this.broadcast(job, 'cancelled');
        return;
      }

      // 阶段 3: 压缩
      this.broadcast(job, 'compressing');

      const zipBuffer = await new Promise<Uint8Array>((resolve, reject) => {
        const terminator = zip(zippable, { level }, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
        job.terminator = () => terminator();
      });

      if (job.cancelled) {
        this.broadcast(job, 'cancelled');
        return;
      }

      // 阶段 4: 写入磁盘
      this.broadcast(job, 'writing');
      try {
        await fs.writeFile(req.destination, zipBuffer);
      } catch (e) {
        this.broadcastError(job, mapIoError(e, req.destination));
        return;
      }

      // 完成
      job.processed = job.total;
      this.broadcast(job, 'done');
      // 清理: 终态后保留 5 分钟用于 UI 查询,真正清理留给 getJob 调用者超时
      setTimeout(() => this.jobs.delete(job.jobId), 5 * 60 * 1000);
    } catch (e) {
      this.broadcastError(job, err('UNKNOWN', (e as Error)?.message ?? String(e)));
    }
  }

  private async runExtract(
    job: ArchiveJobInternal,
    req: ExtractRequest,
  ): Promise<void> {
    try {
      // 阶段 1: 读归档
      let buffer: Uint8Array;
      try {
        const buf = await fs.readFile(req.archive);
        buffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (e) {
        this.broadcastError(job, mapIoError(e, req.archive));
        return;
      }

      if (job.cancelled) {
        this.broadcast(job, 'cancelled');
        return;
      }

      // 阶段 2: 用 fflate 的 async unzip 一次性解压(避免 streaming Unzip 的 decoder 异步复杂性)
      this.broadcast(job, 'reading');

      const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        unzip(buffer, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      }).catch((e) => {
        // fflate 异步错误
        if (e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 8) {
          throw err('ARCHIVE_UNSUPPORTED', '归档包含非 UTF-8 文件名,暂不支持');
        }
        throw mapFlateError(e);
      });

      const normDest = resolve(req.destination);
      const fileList: Array<{ name: string; isDirectory: boolean }> = [];
      const collected = new Map<string, Uint8Array>();

      for (const name of Object.keys(unzipped)) {
        const target = resolve(req.destination, name);
        // Zip Slip 校验
        if (!target.startsWith(normDest + sep) && target !== normDest) {
          throw err('ARCHIVE_INVALID', `非法 entry 路径(可能 Zip Slip): ${name}`);
        }
        // selectedEntries 过滤
        if (req.selectedEntries && req.selectedEntries.length > 0 && !req.selectedEntries.includes(name)) {
          continue;
        }
        const isDir = name.endsWith('/');
        fileList.push({ name, isDirectory: isDir });
        if (!isDir) {
          collected.set(name, unzipped[name]);
        }
      }

      if (job.cancelled) {
        this.broadcast(job, 'cancelled');
        return;
      }

      job.total = fileList.length;
      this.broadcast(job, 'extracting');

      // 阶段 3: 写盘
      const overwrite = req.overwrite ?? false;
      let processed = 0;

      // overwrite=false 时先扫一遍冲突
      if (!overwrite) {
        for (const entry of fileList) {
          if (entry.isDirectory) continue;
          const target = resolve(req.destination, entry.name);
          try {
            await fs.access(target);
            this.broadcastError(
              job,
              err('DESTINATION_EXISTS', `目标已存在: ${target}(设置 overwrite=true 强制覆盖)`, target),
            );
            return;
          } catch {
            // 不存在 → ok
          }
        }
      }

      // 确保 destination 根目录存在
      try {
        await fs.mkdir(req.destination, { recursive: true });
      } catch (e) {
        this.broadcastError(job, mapIoError(e, req.destination));
        return;
      }

      for (const entry of fileList) {
        if (job.cancelled) {
          this.broadcast(job, 'cancelled');
          return;
        }
        job.currentEntry = entry.name;
        const target = resolve(req.destination, entry.name);
        try {
          await fs.mkdir(dirname(target), { recursive: true });
          if (entry.isDirectory) {
            // 目录条目:确保目录存在
            await fs.mkdir(target, { recursive: true });
          } else {
            const data = collected.get(entry.name);
            if (data === undefined || data.length === 0) {
              // 空文件: 创建空文件
              await fs.writeFile(target, new Uint8Array(0));
            } else {
              await fs.writeFile(target, data);
            }
          }
        } catch (e) {
          this.broadcastError(job, mapIoError(e, target));
          return;
        }
        processed++;
        job.processed = processed;
        this.broadcast(job, 'extracting');
      }

      job.processed = job.total;
      this.broadcast(job, 'done');
      setTimeout(() => this.jobs.delete(job.jobId), 5 * 60 * 1000);
    } catch (e) {
      this.broadcastError(job, err('UNKNOWN', (e as Error)?.message ?? String(e)));
    }
  }

  // =============== 仅供测试 ===============

  /** 测试辅助: 获取 job 数 */
  __getJobCount(): number {
    return this.jobs.size;
  }

  /** 测试辅助: 强制清理所有 job */
  __clearAllJobs(): void {
    for (const job of this.jobs.values()) {
      if (job.terminator) {
        try {
          job.terminator();
        } catch {
          // ignore
        }
      }
    }
    this.jobs.clear();
  }
}

// 移除 unused 警告(保留 streaming 工具以备 v2)
void createReadStream;
void createWriteStream;
void pipeline;