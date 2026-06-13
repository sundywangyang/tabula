/**
 * 文件系统服务
 *
 * 封装 Node fs/promises,统一返回 Result<T>。
 * 后续可加缓存、权限校验、跨盘移动优化等。
 */
import { promises as fs, statfsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, basename, extname } from 'node:path';
import type { DriveInfo, FsEntry, ListDirResult, MoveOrCopyRequest, Result, SearchRequest, SearchResult, SearchHit, FileTypeFilter } from '@tabula/bridge';

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

// =================== P5: 驱动器列表 ===================

/**
 * 列出所有挂载的卷/驱动器 (跨平台)
 * Windows: PowerShell Get-PSDrive
 * macOS:   df -h 输出所有挂载点
 * Linux:   df -h
 */
export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform === 'win32') {
    return windowsListDrives();
  }
  if (process.platform === 'darwin') {
    return macosListDrives();
  }
  return linuxListDrives();
}

async function windowsListDrives(): Promise<DriveInfo[]> {
  try {
    const ps = execSync(
      'powershell.exe -NoProfile -NonInteractive -Command ' +
        '"Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{n=\'Label\';e={$_.VolumeLabel}},@{n=\'Total\';e={if($_.Used+$_.Free){$_.Used+$_.Free}else{0}}},@{n=\'Free\';e={if($_.Free){$_.Free}else{0}}},@{n=\'Root\';e={$_.Root}} | ConvertTo-Json -Compress"',
      { encoding: 'utf-8', timeout: 5000, windowsHide: true },
    ).trim();
    if (!ps) return [{ mount: 'C:\\', label: 'C:', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
    const parsed = JSON.parse(ps);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const drives: DriveInfo[] = arr
      .filter((d: any) => d && d.Root)
      .map((d: any) => {
        const mount: string = d.Root;
        const total = Number(d.Total) || 0;
        const free = Number(d.Free) || 0;
        return {
          mount,
          label: d.Label && String(d.Label).trim() ? String(d.Label) : mount.replace(/\\$/, ''),
          totalBytes: total,
          freeBytes: free,
          type: 'fixed',
        };
      });
    if (drives.length === 0) return [{ mount: 'C:\\', label: 'C:', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
    return drives;
  } catch (err) {
    console.warn('[fs] windowsListDrives failed, fallback:', (err as Error).message);
    return [{ mount: 'C:\\', label: 'C:', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
}

async function macosListDrives(): Promise<DriveInfo[]> {
  // macOS: df 列出所有挂载卷;label 和 type 从 mount 命令拿
  // - df: Filesystem 1024-blocks Used Avail Capacity iused ifree %iused Mounted
  // - mount: 形如 /dev/disk1s1 on / (apfs, sealed, local, read-only, journaled) ...
  const SKIP_MOUNTS = ['devfs', '/dev/', 'fdesc', 'procfs', 'autofs', 'tmpfs', 'sysfs', 'map auto', '/System/Volumes/Preboot', '/System/Volumes/VM', '/System/Volumes/Update', '/System/Volumes/xarts', '/System/Volumes/iSCPreboot', '/System/Volumes/Hardware'];
  try {
    const dfOut = execSync('df -k', { encoding: 'utf-8', timeout: 5000 }).trim();
    const lines = dfOut.split('\n').slice(1);
    const drives: DriveInfo[] = [];

    // 读 mount 输出拿文件系统类型
    const mountOut = execSync('mount', { encoding: 'utf-8', timeout: 5000 }).trim();
    const mountMap = new Map<string, string>(); // mount point -> fs type
    for (const m of mountOut.split('\n')) {
      // 形如: /dev/disk1s1 on / (apfs, ...) or map auto_home on /System/Volumes/Data/home (autofs, ...)
      const match = m.match(/ on (\S+) \(([^,)]+)/);
      if (match) {
        mountMap.set(match[1], match[2]);
      }
    }

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;
      const mount = parts[parts.length - 1];
      // 跳过虚拟文件系统
      if (SKIP_MOUNTS.some((s) => mount.startsWith(s) || mount.includes(s + '/'))) continue;

      // df -k 用 1024 字节块为单位
      const totalBytes = Number(parts[1]) * 1024;
      const freeBytes = Number(parts[3]) * 1024;

      // 从 mount 拿 fs 类型和设备
      const fsInfo = mountMap.get(mount) ?? '';
      const fsType = fsInfo.split(' ')[0] ?? 'unknown';

      // 判断是否外部卷 (USB/Thunderbolt/外置磁盘)
      const mountLine = mountOut.split('\n').find((m) => m.includes(` on ${mount} `)) ?? '';
      const isExternal = /\bexternal\b/i.test(mountLine) || /\/dev\/disk[2-9]/.test(mountLine);
      const isReadOnly = /\bread-only\b/.test(mountLine);
      const type: 'fixed' | 'removable' = isExternal || isReadOnly ? 'removable' : 'fixed';

      // label = 挂载点最后一段
      const label = mount === '/' ? 'Macintosh HD' : (mount.split('/').pop() || mount);

      drives.push({
        mount,
        label,
        totalBytes,
        freeBytes,
        type,
        fsType,
      });
    }

    if (drives.length === 0) {
      return [{ mount: '/', label: 'Macintosh HD', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
    }
    return drives;
  } catch (err) {
    console.warn('[fs] macosListDrives failed:', (err as Error).message);
    return [{ mount: '/', label: 'Macintosh HD', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
}

async function linuxListDrives(): Promise<DriveInfo[]> {
  // Linux: df + findmnt (util-linux) 拿 fs 类型
  // - df -k: Filesystem 1024-blocks Used Available Use% Mounted
  // - findmnt: TARGET SOURCE FSTYPE OPTIONS
  const SKIP_MOUNTS = ['devfs', 'fdesc', 'procfs', 'autofs', 'devtmpfs', 'tmpfs', 'overlay', 'shm', 'efivarfs', 'cgroup', 'cgroup2', 'pstore', 'bpf', 'configfs', 'debugfs', 'fusectl', 'hugetlbfs', 'mqueue', 'nsfs', 'pipefs', 'proc', 'ramfs', 'rpc_pipefs', 'securityfs', 'selinuxfs', 'sockfs', 'sysfs', 'tracefs', 'vboxsf'];
  try {
    const dfOut = execSync('df -k', { encoding: 'utf-8', timeout: 5000 }).trim();
    const lines = dfOut.split('\n').slice(1);
    const drives: DriveInfo[] = [];

    // 读 findmnt 拿 fs 类型 (如不可用,降级到 /proc/mounts)
    let mountMap = new Map<string, string>();
    try {
      const findmntOut = execSync('findmnt -rn -o TARGET,FSTYPE,SIZE', { encoding: 'utf-8', timeout: 5000 }).trim();
      for (const m of findmntOut.split('\n')) {
        const parts = m.split(/\s+/);
        if (parts.length >= 2) mountMap.set(parts[0], parts[1]);
      }
    } catch {
      // 降级到 /proc/mounts
      try {
        const { readFileSync } = await import('node:fs');
        const procOut = readFileSync('/proc/mounts', 'utf-8');
        for (const m of procOut.split('\n')) {
          const parts = m.split(/\s+/);
          if (parts.length >= 3) mountMap.set(parts[1], parts[2]);
        }
      } catch {
        // ignore
      }
    }

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const mount = parts[parts.length - 1];
      // 跳过虚拟文件系统
      if (SKIP_MOUNTS.some((s) => mount === '/' + s || mount === s)) continue;
      if (mount.startsWith('/sys/') || mount.startsWith('/proc/') || mount.startsWith('/run/')) continue;

      const totalBytes = Number(parts[1]) * 1024;
      const freeBytes = Number(parts[3]) * 1024;

      const fsType = mountMap.get(mount) ?? 'unknown';
      // 光盘、远程、外部盘算 removable
      const type: 'fixed' | 'removable' = (
        fsType === 'iso9660' || fsType === 'udf' ||
        fsType === 'nfs' || fsType === 'nfs4' || fsType === 'cifs' || fsType === 'smbfs' ||
        fsType === 'vfat' || fsType === 'exfat' || fsType === 'fuseblk' ||
        fsType === 'usbfs' || fsType === 'devpts'
      ) ? 'removable' : 'fixed';

      const label = mount === '/' ? '根分区' : (mount.split('/').pop() || mount);

      drives.push({
        mount,
        label,
        totalBytes,
        freeBytes,
        type,
        fsType,
      });
    }

    if (drives.length === 0) {
      return [{ mount: '/', label: '根分区', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
    }
    return drives;
  } catch (err) {
    console.warn('[fs] linuxListDrives failed:', (err as Error).message);
    return [{ mount: '/', label: '根分区', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
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
