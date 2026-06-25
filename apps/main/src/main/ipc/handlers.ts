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

// =================== G018: 系统原生拖拽 ===================

/**
 * 与 Electron `webContents.startDrag({ file, icon })` 同形的注入点,便于单测。
 * 测试时传 mock,生产由 ipc/index.ts 包一层 `e.sender.startDrag`。
 */
export type StartDragFn = (item: { file: string; icon: string }) => void;

/**
 * `nativeImage.createFromPath(path).isEmpty()` 的最小替身,便于单测注入。
 */
export type NativeImageLike = { isEmpty(): boolean };

/**
 * `nativeImage.createFromPath` 的注入点(便于 mock)。
 */
export type CreateNativeImageFn = (path: string) => NativeImageLike;

/**
 * 解析拖拽图标的优先级:
 * 1. first 文件自身的 NativeImage(图片能拿到真实缩略图)
 * 2. 非图片 → Tabula.ico(packaged: resourcesPath/resources/Tabula.ico;
 *    dev: build-assets/icon/Tabula.ico 相对当前文件)
 */
export function resolveDragIconPath(
  firstFile: string,
  createImage: CreateNativeImageFn,
  fallbackPath: string,
): string {
  const nativeIcon = createImage(firstFile);
  if (!nativeIcon.isEmpty()) return firstFile;
  return fallbackPath;
}

/**
 * G018: 启动一次系统原生拖拽。
 *
 * 把 paths[0] 作为真实文件交给 OS drag session。webContents.startDrag 一次只支持
 * 一个文件 — 多文件选择时仅第一个文件会被 OS 作为被拖项目接受。
 *
 * 必须在渲染端 DOM `ondragstart` handler 内**同步**调用;主进程这一侧 startDragFn
 * 仍处在 OS drag 生命周期内,目标 app(桌面 / VSCode / 微信 / 7-Zip)收到的是真实文件
 * 而非路径字符串。
 *
 * **必须是同步函数**(返回 `Result<void>` 而非 Promise):`ipcRenderer.sendSync` 通过
 * `Event.returnValue` 把结果走结构化克隆回渲染端,Promise 不可克隆会抛
 * "An object could not be cloned" 导致 app 卡死。
 */
export function handleStartDrag(
  paths: string[],
  ctx: {
    startDrag: StartDragFn;
    createImage: CreateNativeImageFn;
    fallbackIconPath: string;
    statSync?: (p: string) => { isFile(): boolean; isDirectory(): boolean } | null;
  },
): Result<void> {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: { code: 'UNKNOWN', message: 'No paths' } };
  }
  const firstFile = paths[0]!;
  // 防御:文件不存在时直接 reject,避免 electron 内部抛错
  const statFn = ctx.statSync ?? defaultStatSync;
  const st = safeStatSync(statFn, firstFile);
  if (!st) {
    return { ok: false, error: { code: 'ENOENT', message: `Source file not found: ${firstFile}`, path: firstFile } };
  }
  if (!st.isFile()) {
    // 目录走 OS 原生拖拽会触发不一样行为(Windows 资源管理器会遍历目录),统一 reject
    return { ok: false, error: { code: 'UNKNOWN', message: 'Only files can be dragged out (directories not supported)', path: firstFile } };
  }
  const iconPath = resolveDragIconPath(firstFile, ctx.createImage, ctx.fallbackIconPath);
  try {
    ctx.startDrag({ file: firstFile, icon: iconPath });
    return { ok: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'UNKNOWN', message } };
  }
}

/** 默认 statSync:依赖 fs.existsSync + fs.statSync(只在主进程路径走) */
function defaultStatSync(p: string): { isFile(): boolean; isDirectory(): boolean } | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  try {
    const s = fs.statSync(p);
    return { isFile: () => s.isFile(), isDirectory: () => s.isDirectory() };
  } catch {
    return null;
  }
}

function safeStatSync(
  statFn: NonNullable<Parameters<typeof handleStartDrag>[1]['statSync']>,
  p: string,
): { isFile(): boolean; isDirectory(): boolean } | null {
  try {
    return statFn(p);
  } catch {
    return null;
  }
}

/**
 * 按平台挑一个当前 OS 真正能识别的 fallback 图标路径。
 * - Windows: .ico
 * - macOS:   .icns(macOS 不识别 .ico → nativeImage.createFromPath 返回空 → startDrag 抛错)
 * - Linux:   .png(可能不存在 → 返回 null,调用方用空 image 兜底)
 */
export function pickPlatformFallbackIcon(appRoot: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const candidates: Record<string, string[]> = {
    win32: ['build-assets/icon/Tabula.ico'],
    darwin: ['build-assets/icon/Tabula.icns'],
    linux: ['build-assets/icon/png/16.png', 'build-assets/icon/png/32.png', 'build-assets/icon/png/256.png', 'build-assets/icon/Tabula.png'],
  };
  const list = candidates[process.platform] ?? [];
  for (const rel of list) {
    const abs = path.join(appRoot, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}
