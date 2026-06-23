/**
 * Windows TrashProvider — PowerShell + Shell.Application COM 枚举 Recycle Bin,
 * 移动 + 清空. 字段对齐 TrashEntry.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import type { TrashProvider } from './types';
import { toFsErrorCode } from './types';

const execFileAsync = promisify(execFile);

/** 把多行 PowerShell 命令拼成单行 -Command 字符串 (转义内部双引号) */
function psInline(script: string): string {
  return script.replace(/"/g, '\\"');
}

export class WindowsTrashProvider implements TrashProvider {
  async list(): Promise<Result<TrashListResult>> {
    try {
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
        'if($delTimeStr){try{$deletedAt=[DateTime]::Parse($delTimeStr).ToUniversalTime().ToFileTimeUtc()}catch{}}',
        '  $items+=[PSCustomObject]@{recyclePath=$recyclePath;origPath=$origPath;deletedAt=$deletedAt;size=$size;isDir=$isDir}',
        '}',
        '$items|ConvertTo-Json -Compress -Depth 3',
      ].join(';');
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psInline(ps)],
        { encoding: 'utf-8', timeout: 15_000, windowsHide: true },
      );
      if (!stdout || stdout === 'null') {
        return { ok: true, data: { entries: [], total: 0 } };
      }
      const parsed = JSON.parse(stdout);
      const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
      const entries: TrashEntry[] = arr
        .filter((item) => item && item.recyclePath)
        .map((item) => {
          let deletedTime = 0;
          if (item.deletedAt && item.deletedAt > 0) {
            try {
              // FILETIME 100ns intervals since 1601-01-01 → ms since epoch
              deletedTime = Math.floor((Number(item.deletedAt) - 116444736000000000) / 10000);
            } catch { deletedTime = 0; }
          }

          const recyclePath = String(item.recyclePath ?? '');
          const origPath: string | null = item.origPath && String(item.origPath).length > 0
            ? String(item.origPath)
            : null;
          const name = origPath
            ? (origPath.match(/[^\\/]+$/)?.[0] ?? recyclePath.match(/[^\\/]+$/)?.[0] ?? recyclePath)
            : (recyclePath.match(/[^\\/]+$/)?.[0] ?? recyclePath);

          return {
            itemPath: recyclePath,
            originalPath: origPath,
            name: String(name),
            deletedTime,
            size: Number(item.size ?? 0),
            isDirectory: Boolean(item.isDir ?? false),
          };
        });
      return { ok: true, data: { entries, total: entries.length } };
    } catch (err) {
      console.warn('[trash-provider] Windows list failed:', err);
      return { ok: true, data: { entries: [], total: 0 } };
    }
  }

  async restore(itemPath: string, _originalPath?: string): Promise<Result<void>> {
    try {
      const ps = [
        '$s=New-Object -Com Shell.Application',
        '$rb=$s.Namespace(0xa)',
        '$item=$rb.ParseName("' + itemPath.replace(/"/g, '') + '")',
        'if($item){$item.InvokeVerb($item.Verbs().Item(0).Name)}',
        'if(-not $item){exit 1}',
      ].join(';');
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psInline(ps)],
        { encoding: 'utf-8', timeout: 30_000, windowsHide: true },
      );
      return { ok: true, data: undefined };
    } catch (err) {
      const msg = String((err as Error).message ?? '');
      if (msg.includes('exit code 1') || (err as any).status === 1) {
        return {
          ok: false,
          error: { code: 'ENOENT', message: `Item not found in recycle bin: ${itemPath}` },
        };
      }
      return {
        ok: false,
        error: {
          code: toFsErrorCode((err as NodeJS.ErrnoException).code),
          message: (err as Error).message,
        },
      };
    }
  }

  async empty(): Promise<Result<void>> {
    try {
      const ps = 'Get-PSDrive -PSProvider FileSystem | ForEach-Object { if($_.Root){Clear-RecycleBin -DriveLetter $_.Name[0] -Force -ErrorAction SilentlyContinue} }';
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psInline(ps)],
        { encoding: 'utf-8', timeout: 60_000, windowsHide: true },
      );
      return { ok: true, data: undefined };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: toFsErrorCode((err as NodeJS.ErrnoException).code),
          message: (err as Error).message,
        },
      };
    }
  }
}
