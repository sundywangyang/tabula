/**
 * 单独的 IPC handler 工厂,便于单测。
 *
 * 把 handler 主体抽出来(不依赖 electron 的 ipcMain),可由 registerIpcHandlers
 * 包装,也可在 vitest 中直接传 mock chmod 测试。
 */
import { chmod as realChmod, stat as realStat, symlink as realSymlink } from 'node:fs/promises';
import type { FsCreateSymlinkRequest, FsError, FsErrorCode, FsSetPermissionsRequest, Result } from '@tabula/bridge';

/** 与 `node:fs/promises` 的 chmod 同形,便于注入 mock */
export type ChmodFn = (
  path: string,
  mode: number,
) => Promise<void>;

/** 与 `node:fs/promises` 的 stat 同形,便于注入 mock */
export type StatFn = (
  path: string,
) => Promise<{ isDirectory(): boolean; isFile(): boolean }>;

/** 与 `node:fs/promises` 的 symlink 同形,便于注入 mock */
export type SymlinkFn = (
  target: string,
  path: string,
  type?: 'dir' | 'file' | 'junction',
) => Promise<void>;

/**
 * G010: 设置文件 read-only 权限。
 * - readonly=true  → chmod 0o444 (Windows: FS ReadOnly bit)
 * - readonly=false → chmod 0o644 (Windows: 清除 ReadOnly bit)
 *
 * 错误返回:统一的 FsError(ENOENT/EACCES/IO_ERROR 等)。
 */
export async function handleSetPermissions(
  req: FsSetPermissionsRequest,
  chmod: ChmodFn = realChmod,
): Promise<Result<void>> {
  try {
    if (!req || typeof req.path !== 'string' || req.path.length === 0) {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: 'invalid path' } };
    }
    if (typeof req.readonly !== 'boolean') {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: 'invalid readonly flag' } };
    }
    await chmod(req.path, req.readonly ? 0o444 : 0o644);
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const error: FsError = {
      code: (err.code as FsErrorCode) ?? 'IO_ERROR',
      message: err.message,
      path: req?.path,
    };
    return { ok: false, error };
  }
}

/**
 * G011: 创建符号链接 / 快捷方式。
 * - Windows: 对目录使用 NTFS `junction`(无需管理员/开发者模式),对文件使用 `file` symlink
 * - Unix: 根据 stat 结果选择 `'dir'` 或 `'file'`
 *
 * 注意:不实现真正的 .lnk 文件(需 IShellLink COM),MINIMUM VIABLE 用 fs.symlink 替代。
 */
export async function handleCreateSymlink(
  req: FsCreateSymlinkRequest,
  statFn: StatFn = realStat,
  symlinkFn: SymlinkFn = realSymlink,
): Promise<Result<string>> {
  try {
    if (!req || typeof req.target !== 'string' || req.target.length === 0) {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: 'invalid target' } };
    }
    if (typeof req.linkPath !== 'string' || req.linkPath.length === 0) {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: 'invalid linkPath' } };
    }
    const s = await statFn(req.target);
    // Windows 下 junction 仅对目录有效;'file' 用于文件;Unix 下对应 'dir'/'file'
    const type = s.isDirectory() ? 'junction' : 'file';
    await symlinkFn(req.target, req.linkPath, type);
    return { ok: true, data: req.linkPath };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const error: FsError = {
      code: (err.code as FsErrorCode) ?? 'IO_ERROR',
      message: err.message,
      path: req?.linkPath,
    };
    return { ok: false, error };
  }
}

/**
 * G015: 计算文件哈希。
 * - 大文件友好:createReadStream + crypto.createHash streaming。
 * - 算法: 'sha256' (default) | 'sha1' | 'md5'。
 * - 失败时返回统一 FsError(ENOENT / EACCES / IO_ERROR 透传)。
 *
 * 函数签名接受可注入的 stream/hash/statSync,便于单测;
 * 真实 IPC 路由处不传(走默认值)。
 */
import type { ReadStream } from 'node:fs';
import type { Hash } from 'node:crypto';
import { statSync as realStatSync } from 'node:fs';
import { createReadStream as realCreateReadStream } from 'node:fs';
import { createHash as realCreateHash } from 'node:crypto';
import type { FsChecksumRequest, FsChecksumResult } from '@tabula/bridge';

export type CreateReadStreamFn = (path: string) => ReadStream;
export type StatSyncFn = (path: string) => { size: number };
export type CreateHashFn = (algorithm: string) => Hash;

const SUPPORTED_ALGOS = new Set(['sha256', 'sha1', 'md5']);

export async function handleChecksum(
  req: FsChecksumRequest,
  createReadStreamFn: CreateReadStreamFn = realCreateReadStream,
  createHashFn: CreateHashFn = realCreateHash,
  statSyncFn: StatSyncFn = realStatSync,
): Promise<Result<FsChecksumResult>> {
  try {
    if (!req || typeof req.path !== 'string' || req.path.length === 0) {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: 'invalid path' } };
    }
    const algo = req.algorithm ?? 'sha256';
    if (!SUPPORTED_ALGOS.has(algo)) {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: `unsupported algorithm: ${algo}` } };
    }
    const start = Date.now();
    const stat = statSyncFn(req.path);
    const hash = createHashFn(algo);
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStreamFn(req.path);
      stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return {
      ok: true,
      data: {
        path: req.path,
        algorithm: algo,
        hash: hash.digest('hex'),
        size: stat.size,
        durationMs: Date.now() - start,
      },
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const error: FsError = {
      code: (err.code as FsErrorCode) ?? 'IO_ERROR',
      message: err.message,
      path: req?.path,
    };
    return { ok: false, error };
  }
}
