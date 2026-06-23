/**
 * macOS TrashProvider — AppleScript 调 Finder 枚举废纸篓 + osascript 移动/清空.
 * 实际命令搬运自原 trash.ts, 接口对齐 TrashEntry 字段 (itemPath/originalPath/name/deletedTime/size/isDirectory).
 */
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import type { TrashProvider } from './types';
import { toFsErrorCode } from './types';

const execFileAsync = promisify(execFile);

/** 把 array of lines 转成单行 shell-friendly 字符串 */
function escapeForShell(script: string): string {
  return script.replace(/'/g, "'\\''");
}

export class MacosTrashProvider implements TrashProvider {
  async list(): Promise<Result<TrashListResult>> {
    try {
      const entries = await this.listEntries();
      return { ok: true, data: { entries, total: entries.length } };
    } catch (err) {
      console.warn('[trash-provider] macOS list failed:', err);
      return { ok: true, data: { entries: [], total: 0 } };
    }
  }

  private async listEntries(): Promise<TrashEntry[]> {
    const trashPath = join(homedir(), '.Trash');
    const script = [
      'tell application "Finder"',
      `  set trashPath to POSIX file "${trashPath}"`,
      '  set trashFolder to folder trashPath',
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
    const { stdout } = await execFileAsync('osascript', ['-e', escapeForShell(script)], {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    if (!stdout) return [];

    return stdout.split('\n').filter(Boolean).map((line) => {
      const parts = line.split('|');
      const name = parts[0] ?? '';
      const itemPath = parts[1] ?? '';
      const size = Number(parts[2] ?? 0);
      const isDirectory = parts[3] === 'true';

      let deletedTime = Date.now();
      try {
        const s = statSync(itemPath);
        deletedTime = s.birthtimeMs || s.mtimeMs;
      } catch { /* fallback to now */ }

      return { itemPath, originalPath: null, name, deletedTime, size, isDirectory };
    });
  }

  async restore(itemPath: string, originalPath?: string): Promise<Result<void>> {
    // 优先用 AppleScript 让 Finder 恢复
    if (originalPath) {
      const script = [
        'tell application "Finder"',
        `  set itemPath to POSIX file "${itemPath}"`,
        '  try',
        '    set targetItem to itemPath as alias',
        '    set theContainer to container of targetItem',
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
        const { stdout } = await execFileAsync('osascript', ['-e', escapeForShell(script)], {
          encoding: 'utf-8',
          timeout: 30_000,
        });
        if (stdout.trim() === 'OK' || stdout.includes('OK')) {
          return { ok: true, data: undefined };
        }
        // AppleScript 失败 → fallback 到 mv
      } catch { /* fall through */ }
    }

    // Fallback: mv 到 Desktop
    try {
      const desktop = join(homedir(), 'Desktop');
      const name = itemPath.split('/').pop() ?? 'restored';
      const dest = join(desktop, name);
      await execFileAsync('mv', [itemPath, dest], { timeout: 30_000 });
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

  async empty(): Promise<Result<void>> {
    try {
      await execFileAsync('osascript', ['-e', 'tell application "Finder" to empty trash'], {
        timeout: 60_000,
      });
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
