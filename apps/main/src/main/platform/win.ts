/**
 * Windows 平台适配器
 *
 * 涵盖:
 *  - 主窗口 / dock icon(用 .ico)
 *  - 系统保留键(Alt+F4, Alt+Tab, Ctrl+Alt+Delete)
 *  - 回收站(PowerShell + Shell.Application COM)
 *  - 驱动器列表(PowerShell Get-PSDrive)
 *  - 终端(cmd /c start "" /D <path> powershell.exe -NoExit)
 *  - 用程序打开文件(spawn detached)
 *
 * 所有 PowerShell 调用都走 `-File <tmp.ps1>` 模式,避开 bash / cmd 的
 * 双引号 `$variable` 展开陷阱(详见 apps/main/src/main/fs/open-with.ts)。
 */
import { execFile, spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { app } from 'electron';
import { parseKeyCombo } from '../keymap/keymap-parser';
import type { KeyCombo, Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import type { PlatformAdapter, ResolvePathContext } from './types';

const execFileAsync = promisify(execFile);

/* ─────────────────────────────────────────────────────────────────────────
 * Window chrome
 * ───────────────────────────────────────────────────────────────────────── */

function winGetIconPath(ctx: ResolvePathContext): string {
  // Windows:始终用 .ico(dev / 打包都从 build-assets/icon 找)
  return join(ctx.appRoot, '..', '..', '..', '..', 'build-assets', 'icon', 'Tabula.ico');
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shortcuts(系统保留键)
 * ───────────────────────────────────────────────────────────────────────── */

function winReservedKeyCombos(): KeyCombo[] {
  return [
    parseKeyCombo('Alt+F4')!,         // 关闭
    parseKeyCombo('Alt+Tab')!,        // 切应用
    parseKeyCombo('Ctrl+Alt+Delete')!, // 任务管理器
  ];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Trash(PowerShell + Shell.Application COM)
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * 把 PowerShell 脚本写到临时 .ps1 文件再 `-File` 执行,
 * 避开 bash/cmd 把 `$variable` 当成自己的变量展开。
 */
async function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  const tmpFile = join(app.getPath('temp'), `tabula-win-${Date.now()}-${process.pid}.ps1`);
  writeFileSync(tmpFile, script, 'utf8');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpFile],
      { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.trim();
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

async function winTrashList(): Promise<Result<TrashListResult>> {
  try {
    const script = [
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
    const out = await runPowerShell(script, 15_000);
    if (!out || out === 'null') return { ok: true, data: { entries: [], total: 0 } };

    const parsed = JSON.parse(out);
    const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
    const entries: TrashEntry[] = arr
      .filter((item) => item && item.recyclePath)
      .map((item) => {
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
    return { ok: true, data: { entries, total: entries.length } };
  } catch (err) {
    console.warn('[platform:win] trash.list failed:', err);
    return { ok: true, data: { entries: [], total: 0 } };
  }
}

async function winTrashRestore(itemPath: string, _originalPath?: string): Promise<Result<void>> {
  try {
    const script = [
      '$s=New-Object -Com Shell.Application',
      '$rb=$s.Namespace(0xa)',
      `$item=$rb.ParseName("${itemPath.replace(/"/g, '')}")`,
      'if($item){$item.InvokeVerb($item.Verbs().Item(0).Name)}',
      'if(-not $item){exit 1}',
    ].join(';');
    await runPowerShell(script, 30_000);
    return { ok: true, data: undefined };
  } catch (err: any) {
    const msg = String(err.message ?? '');
    if (msg.includes('exit code 1') || err.status === 1) {
      return { ok: false, error: { code: 'ENOENT', message: `Item not found in recycle bin: ${itemPath}`, path: itemPath } };
    }
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err), path: itemPath } };
  }
}

async function winTrashEmpty(): Promise<Result<void>> {
  try {
    const script = [
      'Get-PSDrive -PSProvider FileSystem | ForEach-Object {',
      '  if($_.Root){Clear-RecycleBin -DriveLetter $_.Name[0] -Force -ErrorAction SilentlyContinue}',
      '}',
    ].join(' ');
    await runPowerShell(script, 60_000);
    return { ok: true, data: undefined };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Drives(PowerShell Get-PSDrive)
 * ───────────────────────────────────────────────────────────────────────── */

async function winListDrives(): Promise<import('@tabula/bridge').DriveInfo[]> {
  try {
    const script = [
      'Get-PSDrive -PSProvider FileSystem | Select-Object Name,',
      "@{n='Label';e={$_.VolumeLabel}},",
      "@{n='Total';e={if($_.Used+$_.Free){$_.Used+$_.Free}else{0}}},",
      "@{n='Free';e={if($_.Free){$_.Free}else{0}}},",
      "@{n='Root';e={$_.Root}} | ConvertTo-Json -Compress",
    ].join(' ');
    const out = await runPowerShell(script, 5_000);
    if (!out) return [{ mount: 'C:\\', label: 'C:', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const drives = arr
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
          type: 'fixed' as const,
        };
      });
    if (drives.length === 0) return [{ mount: 'C:\\', label: 'C:', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
    return drives;
  } catch (err) {
    console.warn('[platform:win] drive.list failed:', (err as Error).message);
    return [{ mount: 'C:\\', label: 'C:', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shell
 * ───────────────────────────────────────────────────────────────────────── */

async function winOpenTerminal(path: string): Promise<Result<void>> {
  if (!path || typeof path !== 'string') {
    return { ok: false, error: { code: 'UNKNOWN', message: '路径为空' } };
  }
  try {
    // cmd.exe 的 start 是内置命令,必须经 cmd 触发
    // 第一个 "" 是 start 的 title 槽位(必须给,否则它会以为第一个参数是 title)
    // /D 后跟工作目录,后面是要启动的程序及其参数
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '""', '/D', path, 'powershell.exe', '-NoExit'],
      { detached: true, stdio: 'ignore', windowsHide: false },
    );
    child.unref();
    return { ok: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'UNKNOWN', message } };
  }
}

async function winOpenWith(filePath: string, program: string): Promise<Result<void>> {
  try {
    const child = spawn(program, [filePath], { detached: true, windowsHide: true });
    child.unref();
    return { ok: true, data: undefined };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 组装 adapter
 * ───────────────────────────────────────────────────────────────────────── */

export const winAdapter: PlatformAdapter = {
  id: 'win32',
  name: 'windows',
  defaultRootPath: 'C:\\Users',
  quitOnAllWindowsClosed: true,

  window: {
    getIconPath: winGetIconPath,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
  },

  shortcut: {
    getReservedKeyCombos: winReservedKeyCombos,
  },

  trash: {
    list: winTrashList,
    restore: winTrashRestore,
    empty: winTrashEmpty,
  },

  drive: {
    list: winListDrives,
  },

  shell: {
    openTerminal: winOpenTerminal,
    openWith: winOpenWith,
  },
};
