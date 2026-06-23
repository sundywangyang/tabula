/**
 * Linux TrashProvider — gio trash-cli (freedesktop.org Trash 规范).
 * 字段对齐 TrashEntry, 解析 .trashinfo 拿原路径 + 删除时间.
 */
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import type { TrashProvider } from './types';
import { toFsErrorCode } from './types';

const execFileAsync = promisify(execFile);

function trashHome(): string {
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'Trash')
    : join(homedir(), '.local', 'share', 'Trash');
}

export class LinuxTrashProvider implements TrashProvider {
  async list(): Promise<Result<TrashListResult>> {
    try {
      const home = trashHome();
      const filesDir = join(home, 'files');
      const infoDir = join(home, 'info');

      // 优先 gio 拿 names, 降级读 files/
      let names: string[] = [];
      try {
        const { stdout } = await execFileAsync('gio', ['list', 'trash://'], {
          encoding: 'utf-8', timeout: 15_000,
        });
        names = stdout
          .trim().split('\n').filter(Boolean)
          .map((uri) => uri.match(/\/files\/(.+)$/)?.[1] ?? basename(uri));
      } catch {
        try { names = readdirSync(filesDir); }
        catch { return { ok: true, data: { entries: [], total: 0 } }; }
      }

      const entries: TrashEntry[] = names.map((name) => {
        const itemPath = join(filesDir, name);
        const infoPath = join(infoDir, `${name}.trashinfo`);

        let originalPath: string | null = null;
        let deletedTime = Date.now();
        try {
          const info = readFileSync(infoPath, 'utf-8');
          const pathMatch = info.match(/^Path=(.+)$/m);
          const dateMatch = info.match(/^DeletionDate=(.+)$/m);
          if (pathMatch) originalPath = pathMatch[1].trim();
          if (dateMatch) deletedTime = new Date(dateMatch[1].trim()).getTime();
        } catch {
          try { deletedTime = statSync(itemPath).mtimeMs; } catch { /* ignore */ }
        }

        let size = 0;
        let isDirectory = false;
        try {
          const s = statSync(itemPath);
          size = s.size;
          isDirectory = s.isDirectory();
        } catch { /* ignore */ }

        return { itemPath, originalPath, name, deletedTime, size, isDirectory };
      });

      return { ok: true, data: { entries, total: entries.length } };
    } catch (err) {
      console.warn('[trash-provider] Linux list failed:', err);
      return { ok: true, data: { entries: [], total: 0 } };
    }
  }

  async restore(itemPath: string, originalPath?: string): Promise<Result<void>> {
    // 优先 gio --restore
    try {
      await execFileAsync('gio', ['trash', '--restore', itemPath], { timeout: 30_000 });
      return { ok: true, data: undefined };
    } catch {
      // gio 失败, mv 到 originalPath
      if (originalPath) {
        try {
          await execFileAsync('mv', [itemPath, originalPath], { timeout: 30_000 });
          try {
            unlinkSync(join(trashHome(), 'info', `${basename(itemPath)}.trashinfo`));
          } catch { /* ignore */ }
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
      return {
        ok: false,
        error: { code: 'ENOENT', message: 'Cannot restore: no original path known' },
      };
    }
  }

  async empty(): Promise<Result<void>> {
    try {
      await execFileAsync('gio', ['trash', '--empty'], { timeout: 60_000 });
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
