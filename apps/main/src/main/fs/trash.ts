/**
 * 回收站服务 (Windows)
 *
 * v1 简化实现:通过 PowerShell + Shell.Application COM 访问回收站。
 * Shell.Namespace(0xa) 是回收站的 CLSID，对应 "Shell.FolderNameSpace" 对象。
 */
import { execSync } from 'node:child_process';
import type { Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import { ok, mapError } from './result';

/**
 * 列出回收站内容(P3 v1: Windows only)。
 * 用 PowerShell Shell.Namespace(0xa) 取回收站条目及元数据。
 */
export async function trashList(): Promise<Result<TrashListResult>> {
  if (process.platform !== 'win32') {
    return ok({ entries: [], total: 0 });
  }

  try {
    // PowerShell 单行: 用 Shell.Application 枚举回收站
    const ps = [
      '$s=New-Object -Com Shell.Application',
      '$rb=$s.Namespace(0xa)',
      '$items=@()',
      'foreach($i in $rb.Items()){',
      '  $recyclePath=$i.Path',
      '  $origPath=$rb.GetDetailsOf($i,1)',
      '  $delTimeStr=$rb.GetDetailsOf($i,2)',
      '  $size=[long]$i.Size',
      '  $isDir=[bool]$i.IsFolder',
      '  $deletedAt=0',
      '  if($delTimeStr){try{$deletedAt=[DateTime]::Parse($delTimeStr).ToUniversalTime().ToFileTimeUtc()}catch{}}',
      '  $items+=[PSCustomObject]@{recyclePath=$recyclePath;origPath=$origPath;deletedAt=$deletedAt;size=$size;isDir=$isDir}',
      '}',
      '$items|ConvertTo-Json -Compress -Depth 3',
    ].join(';');

    const out = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 15000, windowsHide: true },
    ).trim();

    if (!out || out === 'null') return ok({ entries: [], total: 0 });

    const parsed = JSON.parse(out);
    const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];

    const entries: TrashEntry[] = arr
      .filter((item) => item && item.recyclePath)
      .map((item) => {
        // Windows FILETIME to Unix ms
        let deletedMs = 0;
        if (item.deletedAt && item.deletedAt > 0) {
          try {
            deletedMs = Math.floor((Number(item.deletedAt) - 116444736000000000) / 10000);
          } catch {
            deletedMs = 0;
          }
        }

        const recyclePath = String(item.recyclePath ?? '');
        const origPath: string | null = item.origPath && String(item.origPath).length > 0
          ? String(item.origPath)
          : null;

        // Derive name from original path or recycle path
        const name = origPath
          ? (origPath.match(/[^\\/]+$/)?.[0] ?? recyclePath.match(/[^\\/]+$/)?.[0] ?? recyclePath)
          : (recyclePath.match(/[^\\/]+$/)?.[0] ?? recyclePath);

        return {
          itemPath: recyclePath,
          originalPath: origPath,
          name: String(name),
          deletedTime: deletedMs,
          size: Number(item.size ?? 0),
          isDirectory: Boolean(item.isDir ?? false),
        } satisfies TrashEntry;
      });

    return ok({ entries, total: entries.length });
  } catch (err) {
    console.warn('[trash] trashList failed:', err);
    return ok({ entries: [], total: 0 }); // v1: 出错返回空列表,不阻塞 UI
  }
}

/**
 * 从回收站恢复文件(P3 v1: Windows only)。
 * 通过 Shell.Namespace(0xa).ParseName + InvokeVerb 触发还原动词。
 * @param itemPath 回收站中的完整路径
 * @param originalPath 原始路径(可选;用于记录)
 */
export async function trashRestore(
  itemPath: string,
  _originalPath?: string,
): Promise<Result<void>> {
  if (process.platform !== 'win32') {
    return mapError({ code: 'UNKNOWN', message: 'Recycle bin not supported on this platform' }, itemPath);
  }

  try {
    // PowerShell: 用 Shell.Application 找到回收站条目并执行默认动词(还原)
    const ps = [
      '$s=New-Object -Com Shell.Application',
      '$rb=$s.Namespace(0xa)',
      '$item=$rb.ParseName("' + itemPath.replace(/"/g, '') + '")',
      'if($item){$item.InvokeVerb($item.Verbs().Item(0).Name)}',
      'if(-not $item){exit 1}',
    ].join(';');

    execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 30000, windowsHide: true },
    );

    return ok(undefined);
  } catch (err: any) {
    const msg = String(err.message ?? '');
    if (msg.includes('exit code 1') || err.status === 1) {
      return mapError({ code: 'ENOENT', message: `Item not found in recycle bin: ${itemPath}` }, itemPath);
    }
    return mapError(err, itemPath);
  }
}

/**
 * 清空回收站(P3 v1: Windows only)。
 * 通过 Clear-RecycleBin PowerShell cmdlet 清空所有驱动器。
 */
export async function trashEmpty(): Promise<Result<void>> {
  if (process.platform !== 'win32') {
    return mapError({ code: 'UNKNOWN', message: 'Recycle bin not supported on this platform' });
  }

  try {
    // 清空所有驱动器回收站，静默执行
    const ps = [
      'Get-PSDrive -PSProvider FileSystem | ForEach-Object {',
      '  if($_.Root){Clear-RecycleBin -DriveLetter $_.Name[0] -Force -ErrorAction SilentlyContinue}',
      '}',
    ].join(' ');

    execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 60000, windowsHide: true },
    );

    return ok(undefined);
  } catch (err) {
    return mapError(err);
  }
}
