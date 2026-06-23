/**
 * 文件系统服务
 *
 * 封装 Node fs/promises,统一返回 Result<T>。
 * 后续可加缓存、权限校验、跨盘移动优化等。
 *
 * 跨平台差异:
 *  - listDrives:走 DriveProvider(Win PowerShell / macOS df+mount / Linux df+findmnt)
 *  - 其他:全平台一致(Node fs API)
 */
import { promises as fs, statfsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import type { DriveInfo, FsEntry, ListDirResult, MoveOrCopyRequest, Result, SearchRequest, SearchResult, SearchHit, FileTypeFilter } from '@tabula/bridge';
import { getDriveProvider } from '../providers/drive';

function mapError(err: unknown, path?: string): { ok: false; error: { code: any; message: string; path?: string } } {
  const e = err as NodeJS.ErrnoException;
  return {
    ok: false,
    error: {
      code: e?.code ?? 'UNKNOWN',
      message: e?.message ?? String(err),
      path,
    },
  };
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export async function listDir(path: string): Promise<Result<ListDirResult>> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true });
    const items: FsEntry[] = await Promise.all(
      entries.map(async (dirent) => {
        const full = join(path, dirent.name);
        const stats = await fs.stat(full).catch(() => null);
        const ext = dirent.isDirectory() ? '' : extname(dirent.name).toLowerCase();
        if (!stats) {
          return {
            name: dirent.name,
            path: full,
            isDirectory: dirent.isDirectory(),
            isFile: dirent.isFile(),
            isSymlink: dirent.isSymbolicLink(),
            size: 0,
            mtime: 0,
            atime: 0,
            ctime: 0,
            birthtime: 0,
            ext,
          };
        }
        return {
          name: dirent.name,
          path: full,
          isDirectory: dirent.isDirectory(),
          isFile: dirent.isFile(),
          isSymlink: dirent.isSymbolicLink(),
          size: stats.size,
          mtime: stats.mtimeMs,
          atime: stats.atimeMs,
          ctime: stats.ctimeMs,
          birthtime: stats.birthtimeMs,
          ext,
        };
      }),
    );
    return ok({ path, entries: items, total: items.length });
  } catch (err) {
    return mapError(err, path) as Result<ListDirResult>;
  }
}

export async function readFile(
  path: string,
  encoding: 'utf-8' | 'binary' = 'utf-8',
): Promise<Result<string | ArrayBuffer>> {
  try {
    if (encoding === 'binary') {
      const buf = await fs.readFile(path);
      // 转成 ArrayBuffer
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      return ok(ab);
    }
    const data = await fs.readFile(path, 'utf-8');
    return ok(data);
  } catch (err) {
    return mapError(err, path);
  }
}

export async function writeFile(path: string, data: string | ArrayBuffer): Promise<Result<void>> {
  try {
    if (typeof data === 'string') {
      await fs.writeFile(path, data, 'utf-8');
    } else {
      await fs.writeFile(path, Buffer.from(data));
    }
    return ok(undefined);
  } catch (err) {
    return mapError(err, path);
  }
}

export async function deletePaths(paths: string[], useTrash = true): Promise<Result<void>> {
  if (useTrash) {
    // Electron shell.trashItem() 跨平台支持 (Win/macOS/Linux)
    const { shell } = await import('electron');
    for (const p of paths) {
      try {
        await shell.trashItem(p);
      } catch (err) {
        return mapError(err, p);
      }
    }
    return ok(undefined);
  }
  for (const p of paths) {
    try {
      const stat = await fs.lstat(p);
      if (stat.isDirectory()) {
        await fs.rm(p, { recursive: true, force: true });
      } else {
        await fs.unlink(p);
      }
    } catch (err) {
      return mapError(err, p);
    }
  }
  return ok(undefined);
}

export async function rename(oldPath: string, newPath: string): Promise<Result<void>> {
  try {
    await fs.rename(oldPath, newPath);
    return ok(undefined);
  } catch (err) {
    return mapError(err, oldPath);
  }
}

export async function move(req: MoveOrCopyRequest): Promise<Result<void>> {
  for (const src of req.sources) {
    const dest = join(req.destination, basename(src));
    // eslint-disable-next-line no-console
    console.error('[fs-move] moving', JSON.stringify(src), '->', JSON.stringify(dest));
    try {
      await fs.rename(src, dest);
    } catch (renameErr) {
      // 跨盘 rename 失败，降级到 copy + delete
      // eslint-disable-next-line no-console
      console.error('[fs-move] rename failed, falling back to cp+rm:', renameErr);
      try {
        await fs.cp(src, dest, { recursive: true });
        await fs.rm(src, { recursive: true, force: true });
      } catch (cpErr) {
        const e = cpErr as NodeJS.ErrnoException;
        // eslint-disable-next-line no-console
        console.error('[fs-move] cp+rm ERROR code=', e.code, 'msg=', e.message);
        return mapError(cpErr, src);
      }
    }
  }
  return ok(undefined);
}

export async function copy(req: MoveOrCopyRequest): Promise<Result<void>> {
  // eslint-disable-next-line no-console
  console.error('[fscp] req.destination =', req?.destination, 'typeof =', typeof req?.destination, 'req =', req);
  for (const src of req.sources) {
    try {
      const dest = join(req.destination, basename(src));
      // eslint-disable-next-line no-console
      console.error('[fscp] src=', src, 'dest=', dest);
      await fs.cp(src, dest, { recursive: true, force: req.overwrite });
      // eslint-disable-next-line no-console
      console.error('[fscp] success:', dest);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // eslint-disable-next-line no-console
      console.error('[fscp] ERROR code=', e.code, 'msg=', e.message);
      return mapError(err, src);
    }
  }
  return ok(undefined);
}

export async function mkdir(path: string, name?: string): Promise<Result<string>> {
  try {
    const target = name ? join(path, name) : path;
    await fs.mkdir(target, { recursive: true });
    return ok(target);
  } catch (err) {
    return mapError(err, path);
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function stat(path: string): Promise<Result<FsEntry>> {
  try {
    const s = await fs.stat(path);
    const ext = s.isDirectory() ? '' : extname(path).toLowerCase();
    return ok({
      name: basename(path),
      path,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      isSymlink: false,
      size: s.size,
      mtime: s.mtimeMs,
      atime: s.atimeMs,
      ctime: s.ctimeMs,
      birthtime: s.birthtimeMs,
      ext,
    });
  } catch (err) {
    return mapError(err, path);
  }
}

// =================== P5: 驱动器列表 (P7: 委托给 DriveProvider) ===================

/** 列出所有挂载的卷/驱动器 — 实现见 providers/drive/{windows,macos,linux}.ts */
export async function listDrives(): Promise<DriveInfo[]> {
  return getDriveProvider().listDrives();
}

// =================== P4 v1: 递归搜索 ===================

/** 文件类型过滤扩展名映射 */
const FILE_TYPE_EXTENSIONS: Record<Exclude<FileTypeFilter, 'all'>, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.raw', '.heic', '.avif'],
  document: ['.doc', '.docx', '.pdf', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.md', '.markdown'],
  code: ['.js', '.ts', '.tsx', '.jsx', '.json', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.sql', '.sh', '.bash', '.ps1', '.html', '.css', '.scss', '.less', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tar.gz', '.tar.bz2'],
};

/**
 * 判断文件是否匹配类型过滤
 */
function matchesFileType(name: string, fileType?: FileTypeFilter): boolean {
  if (!fileType || fileType === 'all') return true;
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  return FILE_TYPE_EXTENSIONS[fileType]?.includes(ext) ?? false;
}

/**
 * 计算匹配分数
 * - 精确匹配(大小写): 1000
 * - 精确匹配(忽略大小写): 500
 * - 前缀匹配: 100
 * - 子串匹配: 50
 * - 模糊匹配(字符顺序): 10
 */
function computeMatchScore(name: string, query: string): { score: number; matchType: SearchHit['matchType'] } {
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (name === query) return { score: 1000, matchType: 'exact' };
  if (lowerName === lowerQuery) return { score: 500, matchType: 'exact' };
  if (lowerName.startsWith(lowerQuery)) return { score: 100, matchType: 'prefix' };
  if (lowerName.includes(lowerQuery)) return { score: 50, matchType: 'substring' };

  // 模糊匹配:query 中的字符是否按顺序出现在 name 中
  let qi = 0;
  for (let ni = 0; ni < lowerName.length && qi < lowerQuery.length; ni++) {
    if (lowerName[ni] === lowerQuery[qi]) qi++;
  }
  if (qi === lowerQuery.length) {
    return { score: 10, matchType: 'fuzzy' };
  }

  return { score: -1, matchType: 'fuzzy' };
}

/**
 * 递归搜索目录
 */
async function searchDirectory(
  dirPath: string,
  query: string,
  maxResults: number,
  fileType: FileTypeFilter | undefined,
  currentDepth: number,
  maxDepth: number,
  results: SearchHit[],
): Promise<{ truncated: boolean; scannedCount: number }> {
  if (currentDepth > maxDepth || results.length >= maxResults) {
    return { truncated: results.length >= maxResults, scannedCount: 0 };
  }

  let scannedCount = 0;
  let truncated = false;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (truncated) break;

      const fullPath = join(dirPath, entry.name);

      scannedCount++;

      // 计算匹配分数
      const matchResult = computeMatchScore(entry.name, query);
      if (matchResult.score > 0 && matchesFileType(entry.name, fileType)) {
        let stats = { size: 0, mtime: 0 };
        try {
          const s = await fs.stat(fullPath);
          stats = { size: s.size, mtime: s.mtimeMs };
        } catch {
          // stat 失败不影响搜索
        }

        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          mtime: stats.mtime,
          score: matchResult.score,
          matchType: matchResult.matchType,
        });

        if (results.length >= maxResults) {
          truncated = true;
          break;
        }
      }

      // 递归搜索子目录
      if (entry.isDirectory() && currentDepth < maxDepth) {
        const subResult = await searchDirectory(
          fullPath,
          query,
          maxResults,
          fileType,
          currentDepth + 1,
          maxDepth,
          results,
        );
        scannedCount += subResult.scannedCount;
        truncated = subResult.truncated;
      }
    }
  } catch {
    // 目录不可访问,跳过
  }

  return { truncated, scannedCount };
}

/**
 * P4 v1: 递归搜索文件
 */
export async function search(req: SearchRequest): Promise<Result<SearchResult>> {
  const startTime = Date.now();
  const { path, query, maxResults, fileType, maxDepth = 3 } = req;

  if (!query || query.trim().length === 0) {
    return ok({ entries: [], total: 0, elapsedMs: 0, truncated: false });
  }

  const results: SearchHit[] = [];
  const { truncated } = await searchDirectory(
    path,
    query.trim(),
    maxResults,
    fileType,
    0,
    maxDepth,
    results,
  );

  // 按分数降序排序
  results.sort((a, b) => b.score - a.score);

  return ok({
    entries: results,
    total: results.length,
    elapsedMs: Date.now() - startTime,
    truncated,
  });
}

// =================== 目录大小计算 (new) ===================

interface DirSizeAccumulator {
  totalSize: number;
  fileCount: number;
  dirCount: number;
}

async function accumulateDirSize(dirPath: string, accum: DirSizeAccumulator): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          accum.dirCount++;
          await accumulateDirSize(full, accum);
        } else {
          const stat = await fs.stat(full);
          accum.totalSize += stat.size;
          accum.fileCount++;
        }
      } catch {
        // 单个文件/目录访问失败，跳过
      }
    }
  } catch {
    // 目录不可读，跳过
  }
}

export async function getDirSize(path: string): Promise<Result<{ size: number; fileCount: number; dirCount: number; elapsedMs: number }>> {
  const start = Date.now();
  try {
    const accum: DirSizeAccumulator = { totalSize: 0, fileCount: 0, dirCount: 0 };
    await accumulateDirSize(path, accum);
    return ok({ size: accum.totalSize, fileCount: accum.fileCount, dirCount: accum.dirCount, elapsedMs: Date.now() - start });
  } catch (err) {
    return mapError(err, path);
  }
}
