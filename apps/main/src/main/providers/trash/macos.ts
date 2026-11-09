/** macOS 废纸篓：Finder 枚举，原子无覆盖恢复，Finder 清空。 */
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import type { TrashProvider } from './types';
import { toFsErrorCode } from './types';

const execFileAsync = promisify(execFile);
type ScriptRunner = (args: string[], timeout: number) => Promise<string>;

const runScript: ScriptRunner = async (args, timeout) => {
  const { stdout } = await execFileAsync('/usr/bin/osascript', args, {
    encoding: 'utf-8', timeout, maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
};

// File names never enter source code or a delimiter-separated format.
const LIST_SCRIPT = `function run() {
  var finder = Application('Finder');
  return JSON.stringify(finder.trash.items().map(function(item) {
    return {
      name: item.name(), url: item.url(), size: item.size(),
      isDirectory: item.class() === 'folder'
    };
  }));
}`;

// RENAME_EXCL checks the destination inside the rename operation itself.
// A separate existence check (including NSFileManager / mv -n) can lose a race.
const RESTORE_SCRIPT = `ObjC.bindFunction('renamex_np', ['int', ['char *', 'char *', 'unsigned int']]);
ObjC.bindFunction('__error', ['int *', []]);
ObjC.bindFunction('strerror', ['char *', ['int']]);
function run(argv) {
  if ($.renamex_np(argv[0], argv[1], 4) === 0) {
    return JSON.stringify({ ok: true });
  }
  var error = $.__error()[0];
  return JSON.stringify({ ok: false, errno: error, message: $.strerror(error) });
}`;

interface FinderTrashItem {
  name: string;
  url: string;
  size: number;
  isDirectory: boolean;
}

function isFinderTrashItem(value: unknown): value is FinderTrashItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === 'string' && typeof item.url === 'string'
    && typeof item.size === 'number' && Number.isFinite(item.size)
    && typeof item.isDirectory === 'boolean';
}

export class MacosTrashProvider implements TrashProvider {
  constructor(private readonly run: ScriptRunner = runScript, private readonly home: () => string = homedir) {}

  async list(): Promise<Result<TrashListResult>> {
    try {
      const stdout = await this.run(['-l', 'JavaScript', '-e', LIST_SCRIPT], 15_000);
      const items: unknown = JSON.parse(stdout);
      if (!Array.isArray(items) || !items.every(isFinderTrashItem)) {
        throw new Error('Finder 返回了无效的废纸篓列表');
      }
      const entries: TrashEntry[] = items.map((item: FinderTrashItem) => {
        const itemPath = fileURLToPath(item.url);
        let deletedTime = Date.now();
        try {
          const stat = statSync(itemPath);
          deletedTime = stat.birthtimeMs || stat.mtimeMs;
        } catch { /* Finder may list items inaccessible to this process. */ }
        return {
          itemPath, originalPath: null, name: item.name, deletedTime,
          size: item.size, isDirectory: item.isDirectory,
        };
      });
      return { ok: true, data: { entries, total: entries.length } };
    } catch (err) {
      return this.failure(err);
    }
  }

  async restore(itemPath: string, originalPath?: string): Promise<Result<void>> {
    try {
      if (!isAbsolute(itemPath) || (originalPath !== undefined && !isAbsolute(originalPath))) {
        throw new Error('恢复文件需要绝对路径');
      }
      const source = resolve(itemPath);
      const destination = originalPath ? resolve(originalPath) : join(this.home(), 'Desktop', basename(source));
      const stdout = await this.run(['-l', 'JavaScript', '-e', RESTORE_SCRIPT, '--', source, destination], 30_000);
      const result: unknown = JSON.parse(stdout);
      if (!result || typeof result !== 'object' || !('ok' in result)) throw new Error('无效的恢复结果');
      const status = result as { ok: unknown; errno?: unknown; message?: unknown };
      if (status.ok === true) return { ok: true, data: undefined };
      const code = status.errno === 17 ? 'EEXIST' : status.errno === 2 ? 'ENOENT'
        : status.errno === 1 || status.errno === 13 ? 'EACCES' : 'UNKNOWN';
      return {
        ok: false,
        error: {
          code,
          message: code === 'EEXIST' ? `目标已存在，文件仍保留在废纸篓: ${destination}`
            : status.errno === 18 ? '无法跨磁盘恢复，文件仍保留在废纸篓，请在 Finder 中恢复'
              : status.errno === 45 ? '此文件系统不支持安全恢复，文件仍保留在废纸篓，请在 Finder 中恢复'
                : typeof status.message === 'string' ? status.message : '无法恢复废纸篓项目',
        },
      };
    } catch (err) {
      return this.failure(err);
    }
  }

  async empty(): Promise<Result<void>> {
    try {
      await this.run(['-e', 'tell application "Finder" to empty trash'], 60_000);
      return { ok: true, data: undefined };
    } catch (err) {
      return this.failure(err);
    }
  }

  private failure(err: unknown): Result<never> {
    return {
      ok: false,
      error: { code: toFsErrorCode((err as NodeJS.ErrnoException).code), message: (err as Error).message },
    };
  }
}
