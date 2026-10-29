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
import type { DriveInfo, FsEntry, ListDirResult, Result, SearchRequest, SearchResult, SearchHit, FileTypeFilter } from '@tabula/bridge';
import { getDriveProvider } from '../providers/drive';
export { move } from './move';
export { copy } from './copy';

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
            mode: 0,
          };
        }
        return {
          name: dirent.name,
          path: full,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          isSymlink: dirent.isSymbolicLink(),
          size: stats.size,
          mtime: stats.mtimeMs,
          atime: stats.atimeMs,
          ctime: stats.ctimeMs,
          birthtime: stats.birthtimeMs,
          ext: stats.isDirectory() ? '' : ext,
          mode: stats.mode,
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
      isSymlink: (await fs.lstat(path)).isSymbolicLink(),
      size: s.size,
      mtime: s.mtimeMs,
      atime: s.atimeMs,
      ctime: s.ctimeMs,
      birthtime: s.birthtimeMs,
      ext,
      // POSIX 模式位(Windows 下 fs.stat 不暴露 mode,Node 返回 0;0o400 测试需要时用 unix 平台)
      mode: s.mode,
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
  criteria: SearchRequest,
  budget: { scanned: number },
): Promise<{ truncated: boolean; scannedCount: number }> {
  if (currentDepth > maxDepth || results.length >= maxResults || budget.scanned >= 100000) {
    return { truncated: results.length >= maxResults || budget.scanned >= 100000, scannedCount: 0 };
  }

  let scannedCount = 0;
  let truncated = false;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (truncated) break;

      const fullPath = join(dirPath, entry.name);

      scannedCount++;
      budget.scanned++;
      if (budget.scanned > 100000) { truncated = true; break; }

      // 计算匹配分数
      const matchResult = computeMatchScore(entry.name, query);
      if (matchResult.score > 0 && matchesFileType(entry.name, fileType)) {
        let stats: { size: number; mtime: number } | null = null;
        try {
          const s = await fs.stat(fullPath);
          stats = { size: s.size, mtime: s.mtimeMs };
        } catch {
          // 无法读取元数据的条目无法可靠匹配尺寸或日期条件。
        }

        const sizeFilter = criteria.minSize !== undefined || criteria.maxSize !== undefined;
        const matchesMetadata = (!sizeFilter || !entry.isDirectory())
          && (stats !== null || (!sizeFilter && criteria.modifiedAfter === undefined && criteria.modifiedBefore === undefined))
          && (criteria.minSize === undefined || (stats !== null && stats.size >= criteria.minSize))
          && (criteria.maxSize === undefined || (stats !== null && stats.size <= criteria.maxSize))
          && (criteria.modifiedAfter === undefined || (stats !== null && stats.mtime >= criteria.modifiedAfter))
          && (criteria.modifiedBefore === undefined || (stats !== null && stats.mtime < criteria.modifiedBefore));
        if (matchesMetadata) results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats?.size ?? 0,
          mtime: stats?.mtime ?? 0,
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
          criteria,
          budget,
        );
        scannedCount += subResult.scannedCount;
        truncated = subResult.truncated;
      }
    }
  } catch (error) {
    if (currentDepth === 0) throw error;
    // 子目录不可访问时继续搜索其他目录。
  }

  return { truncated, scannedCount };
}

/**
 * P4 v1: 递归搜索文件
 */
export async function search(req: SearchRequest): Promise<Result<SearchResult>> {
  const startTime = Date.now();
  const { path, query, maxResults, fileType, maxDepth = 3 } = req;

  const invalidNumber = (n: number | undefined) => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0);
  if (typeof path !== 'string' || typeof query !== 'string' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10000 ||
    !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 20 ||
    invalidNumber(req.minSize) || invalidNumber(req.maxSize) || invalidNumber(req.modifiedAfter) || invalidNumber(req.modifiedBefore) ||
    (req.minSize !== undefined && req.maxSize !== undefined && req.minSize > req.maxSize) ||
    (req.modifiedAfter !== undefined && req.modifiedBefore !== undefined && req.modifiedAfter >= req.modifiedBefore)) {
    return mapError(Object.assign(new Error('搜索条件无效'), { code: 'INVALID_ARGUMENT' }), path);
  }
  if (!query.trim() && (!fileType || fileType === 'all') && req.minSize === undefined && req.maxSize === undefined && req.modifiedAfter === undefined && req.modifiedBefore === undefined) {
    return ok({ entries: [], total: 0, elapsedMs: 0, truncated: false });
  }

  const results: SearchHit[] = [];
  let truncated: boolean;
  try {
    ({ truncated } = await searchDirectory(
    path,
    query.trim(),
    maxResults,
    fileType,
    0,
    maxDepth,
    results,
    req,
    { scanned: 0 },
    ));
  } catch (error) {
    return mapError(error, path);
  }

  // 按分数降序排序
  results.sort((a, b) => b.score - a.score);

  return ok({
    entries: results,
    total: results.length,
    elapsedMs: Date.now() - startTime,
    truncated,
  });
}

// =================== 目录大小计算 ===================
// G016: 已迁移到 apps/main/src/main/fs/dir-size.ts(后台异步 + 取消支持)
// 老版本阻塞式 getDirSize 移除,改由 dir-size.ts 的 startDirSize / cancelDirSize 提供。
