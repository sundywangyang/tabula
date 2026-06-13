/**
 * 回收站服务 (跨平台)
 *
 * Windows: PowerShell + Shell.Application COM
 * macOS:   osascript AppleScript 读取 ~/.Trash
 * Linux:   gio trash-* 命令 (或直接操作 $XDG_DATA_HOME/Trash)
 */
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import { ok, mapError } from './result';

/* ─────────────────────────────────────────────────────────────────────────────
 * macOS helpers
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 用 osascript AppleScript 列出 ~/.Trash 里的文件元数据
 *
 * 注意: 用 POSIX file 引用而非直接传路径给 folder 命令(AppleScript 的
 * folder 不接受 POSIX path 字符串)。遍历用 'every item' 包含文件+文件夹。
 */
export async function macosTrashList(): Promise<TrashEntry[]> {
  const trashPath = join(homedir(), '.Trash');

  // AppleScript: 告诉 Finder 枚举废纸篓内容,用 POSIX file 转换路径
  const script = [
    'tell application "Finder"',
    `  set trashPath to POSIX file "${trashPath}"`,
    `  set trashFolder to folder trashPath`,
    '  set itemList to every item of trashFolder',
    '  set outList to {}',
    '  repeat with anItem in itemList',
    '    set itemName to name of anItem',
    '    set itemPath to POSIX path of anItem',
    '    set itemSize to size of anItem',
    '    set itemIsDir to (class of anItem is folder)',
    '    set end of outList to itemName & "|" & itemPath & "|" & (itemSize as string) & "|" & itemIsDir',
    '  end repeat',
    '  return outList',
    'end tell',
  ].join('\n');

  try {
    const out = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();

    if (!out) return [];

    const { statSync } = await import('node:fs');
    return out.split('\n').filter(Boolean).map((line: string) => {
      const parts = line.split('|');
      const name = parts[0] ?? '';
      const itemPath = parts[1] ?? '';
      const size = Number(parts[2] ?? 0);
      const isDir = parts[3] === 'true';

      // 用文件系统 stat 拿删除时间 (AppleScript 中 deleted item 的 creation date 不可靠)
      let deletedAt = Date.now();
      try {
        const s = statSync(itemPath);
        deletedAt = s.birthtimeMs || s.mtimeMs;
      } catch {
        // fallback 用当前时间
      }

      return {
        itemPath,
        originalPath: null,
        name,
        deletedTime: deletedAt,
        size,
        isDirectory: isDir,
      } satisfies TrashEntry;
    });
  } catch (err) {
    console.warn('[trash] macosTrashList failed:', err);
    return [];
  }
}

/**
 * macOS 恢复: 用 AppleScript 调 Finder "put back" 命令(从废纸篓恢复到原位置)
 * 如果文件不在 Finder trash (例如直接 mdt 删的),fallback 到 shell.trashItem 反向
 */
async function macosTrashRestore(itemPath: string, originalPath?: string): Promise<Result<void>> {
  // 优先用 AppleScript 让 Finder 恢复
  if (originalPath) {
    const script = [
      'tell application "Finder"',
      `  set itemPath to POSIX file "${itemPath}"`,
      '  try',
      '    set targetItem to itemPath as alias',
      '    set theContainer to container of targetItem',
      '    -- 遍历原位置找匹配名称',
      `    set origFolder to folder (POSIX file "${originalPath.replace(/[^/]+$/, '')}")`,
      '    set origName to name of targetItem',
      '    set targetOrig to (item origName of origFolder)',
      '    set the name of targetItem to (do shell script "echo " & quoted form of origName)',
      '    set targetOrig to original item of targetItem',
      '    move targetOrig to origFolder',
      '  on error errMsg',
      `    return "ERROR: " & errMsg`,
      '  end try',
      '  return "OK"',
      'end tell',
    ].join('\n');

    try {
      const out = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf-8',
        timeout: 30000,
      }).trim();
      if (out === 'OK' || out.includes('OK')) {
        return ok(undefined);
      }
      // AppleScript 失败,降级到 mv
    } catch {
      // 继续 mv fallback
    }
  }

  // Fallback: 直接 mv 到 ~/Desktop 或上层目录 (无原位置信息时)
  try {
    const { execSync: exec } = await import('node:child_process');
    const desktop = join(homedir(), 'Desktop');
    const name = itemPath.split('/').pop() ?? 'restored';
    const dest = join(desktop, name);
    exec(`mv "${itemPath}" "${dest}"`, { encoding: 'utf-8', timeout: 30000 });
    return ok(undefined);
  } catch (err) {
    return mapError(err, itemPath);
  }
}

/**
 * macOS 清空废纸篓: 直接 rm -rf ~/.Trash/*
 */
async function macosTrashEmpty(): Promise<Result<void>> {
  const { execSync: exec } = await import('node:child_process');
  const trashPath = join(homedir(), '.Trash');
  try {
    exec(`rm -rf "${trashPath}"/*`, { encoding: 'utf-8', timeout: 60000 });
    return ok(undefined);
  } catch (err) {
    return mapError(err);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Windows helpers
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Windows: PowerShell + Shell.Namespace(0xa)
 */
async function windowsTrashList(): Promise<Result<TrashListResult>> {
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

    return ok({ entries, total: entries.length });
  } catch (err) {
    console.warn('[trash] windowsTrashList failed:', err);
    return ok({ entries: [], total: 0 });
  }
}

async function windowsTrashRestore(
  itemPath: string,
  _originalPath?: string,
): Promise<Result<void>> {
  try {
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

async function windowsTrashEmpty(): Promise<Result<void>> {
  try {
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Linux helpers (XDG Trash spec)
 *
 * 标准: $XDG_DATA_HOME/Trash/
 *   - files/  实际文件
 *   - info/   对应 .trashinfo 文件 (Key=Value 格式: Path, DeletionDate)
 * 优先级: gio > 直接解析 XDG
 * ───────────────────────────────────────────────────────────────────────────── */

function linuxTrashHome(): string {
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'Trash')
    : join(homedir(), '.local', 'share', 'Trash');
}

async function linuxTrashList(): Promise<Result<TrashListResult>> {
  try {
    const trashHome = linuxTrashHome();
    const filesDir = join(trashHome, 'files');
    const infoDir = join(trashHome, 'info');

    // 优先用 gio 拿列表
    let names: string[] = [];
    try {
      const out = execSync('gio list trash://', {
        encoding: 'utf-8',
        timeout: 15000,
      }).trim();
      if (out) {
        // gio list trash:// 每行一个 trash:// URI
        names = out
          .split('\n')
          .filter(Boolean)
          .map((uri) => {
            // 提取 files/ 后的文件名
            const m = uri.match(/\/files\/(.+)$/);
            return m ? m[1] : uri.split('/').pop() ?? '';
          });
      }
    } catch {
      // 降级: 直接读 files/ 目录
      try {
        const { readdirSync, statSync } = await import('node:fs');
        const list = readdirSync(filesDir);
        names = list;
      } catch {
        return ok({ entries: [], total: 0 });
      }
    }

    const entries: TrashEntry[] = [];
    for (const name of names) {
      const itemPath = join(filesDir, name);
      const infoPath = join(infoDir, `${name}.trashinfo`);

      // 读 .trashinfo 拿原路径和删除时间
      let originalPath: string | null = null;
      let deletedTime = Date.now();
      try {
        const { readFileSync, statSync } = await import('node:fs');
        const info = readFileSync(infoPath, 'utf-8');
        // 格式: [Trash Info]\nPath=...\nDeletionDate=ISO8601
        const pathMatch = info.match(/^Path=(.+)$/m);
        const dateMatch = info.match(/^DeletionDate=(.+)$/m);
        if (pathMatch) originalPath = pathMatch[1].trim();
        if (dateMatch) deletedTime = new Date(dateMatch[1].trim()).getTime();
      } catch {
        // .trashinfo 不存在时尝试 stat 文件
        try {
          const { statSync } = await import('node:fs');
          const s = statSync(itemPath);
          deletedTime = s.mtimeMs;
        } catch {
          // ignore
        }
      }

      let size = 0;
      let isDir = false;
      try {
        const { statSync } = await import('node:fs');
        const s = statSync(itemPath);
        size = s.size;
        isDir = s.isDirectory();
      } catch {
        // ignore
      }

      entries.push({
        itemPath,
        originalPath,
        name,
        deletedTime,
        size,
        isDirectory: isDir,
      });
    }

    return ok({ entries, total: entries.length });
  } catch (err) {
    console.warn('[trash] linuxTrashList failed:', err);
    return ok({ entries: [], total: 0 });
  }
}

async function linuxTrashRestore(
  itemPath: string,
  originalPath?: string,
): Promise<Result<void>> {
  // 优先 gio trash --restore (需要 .trashinfo 中有 Path=)
  try {
    execSync(`gio trash --restore "${itemPath}"`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return ok(undefined);
  } catch {
    // gio 失败,用 mv 恢复
    if (originalPath) {
      try {
        const { execSync: exec } = await import('node:child_process');
        exec(`mv "${itemPath}" "${originalPath}"`, {
          encoding: 'utf-8',
          timeout: 30000,
        });
        // 删除对应的 .trashinfo
        const { unlinkSync } = await import('node:fs');
        const infoPath = join(linuxTrashHome(), 'info', `${itemPath.split('/').pop()}.trashinfo`);
        try { unlinkSync(infoPath); } catch { /* ignore */ }
        return ok(undefined);
      } catch (err) {
        return mapError(err, itemPath);
      }
    }
    return mapError({ code: 'ENOENT', message: 'Cannot restore: no original path known' }, itemPath);
  }
}

async function linuxTrashEmpty(): Promise<Result<void>> {
  try {
    execSync('gio trash --empty', { encoding: 'utf-8', timeout: 60000 });
    return ok(undefined);
  } catch (err) {
    return mapError(err);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Public API
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 列出回收站内容 (跨平台)
 */
export async function trashList(): Promise<Result<TrashListResult>> {
  if (process.platform === 'win32') {
    return windowsTrashList();
  }
  if (process.platform === 'darwin') {
    const entries = await macosTrashList();
    return ok({ entries, total: entries.length });
  }
  // Linux
  return linuxTrashList();
}

/**
 * 从回收站恢复文件 (跨平台)
 */
export async function trashRestore(
  itemPath: string,
  originalPath?: string,
): Promise<Result<void>> {
  if (process.platform === 'win32') {
    return windowsTrashRestore(itemPath, originalPath);
  }
  if (process.platform === 'darwin') {
    return macosTrashRestore(itemPath, originalPath);
  }
  // Linux
  return linuxTrashRestore(itemPath, originalPath);
}

/**
 * 清空回收站 (跨平台)
 */
export async function trashEmpty(): Promise<Result<void>> {
  if (process.platform === 'win32') {
    return windowsTrashEmpty();
  }
  if (process.platform === 'darwin') {
    return macosTrashEmpty();
  }
  // Linux
  return linuxTrashEmpty();
}
