/**
 * macOS 平台适配器
 *
 * 涵盖:
 *  - 主窗口 / dock icon(用 .icns)
 *  - 系统保留键(Meta+Q 退出、Meta+Tab 切应用、Meta+Space Spotlight 等)
 *  - 回收站(osascript 调 Finder, ~/.Trash 目录)
 *  - 驱动器列表(df + mount 解析)
 *  - 终端(`open -a Terminal <path>`)
 *  - 用程序打开文件(`open -a <program> <file>`)
 */
import { execSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseKeyCombo } from '../keymap/keymap-parser';
import type { KeyCombo, Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import type { PlatformAdapter, ResolvePathContext } from './types';

/* ─────────────────────────────────────────────────────────────────────────
 * Window chrome
 * ───────────────────────────────────────────────────────────────────────── */

function macGetIconPath(ctx: ResolvePathContext): string {
  // macOS BrowserWindow.icon 在 macOS 上无效(用 Info.plist / dock icon)
  // 这里仍返回 .icns 路径以保持接口统一;实际生效的是 getDockIconPath
  return join(ctx.appRoot, '..', '..', '..', '..', 'build-assets', 'icon', 'Tabula.icns');
}

function macGetDockIconPath(ctx: ResolvePathContext): string {
  return join(ctx.appRoot, '..', '..', '..', '..', 'build-assets', 'icon', 'Tabula.icns');
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shortcuts(macOS 特有保留键)
 * ───────────────────────────────────────────────────────────────────────── */

function macReservedKeyCombos(): KeyCombo[] {
  const base: KeyCombo[] = [
    parseKeyCombo('Alt+F4')!,
    parseKeyCombo('Alt+Tab')!,
    parseKeyCombo('Ctrl+Alt+Delete')!,
  ];
  return [
    ...base,
    parseKeyCombo('Meta+Q')!,        // 退出
    parseKeyCombo('Meta+Tab')!,      // 切应用
    parseKeyCombo('Meta+Escape')!,   // Mission Control
    parseKeyCombo('Meta+L')!,        // 锁屏
    parseKeyCombo('Meta+M')!,        // 最小化窗口
    parseKeyCombo('Meta+H')!,        // 隐藏窗口
    parseKeyCombo('Meta+Space')!,    // Spotlight
  ];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Trash(Finder AppleScript + ~/.Trash)
 * ───────────────────────────────────────────────────────────────────────── */

async function macTrashList(): Promise<Result<TrashListResult>> {
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

  try {
    const out = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 15_000,
    }).trim();
    if (!out) return { ok: true, data: { entries: [], total: 0 } };

    const entries: TrashEntry[] = out.split('\n').filter(Boolean).map((line: string) => {
      const parts = line.split('|');
      const name = parts[0] ?? '';
      const itemPath = parts[1] ?? '';
      const size = Number(parts[2] ?? 0);
      const isDir = parts[3] === 'true';
      let deletedAt = Date.now();
      try {
        const s = statSync(itemPath);
        deletedAt = s.birthtimeMs || s.mtimeMs;
      } catch { /* fallback to now */ }
      return {
        itemPath,
        originalPath: null,
        name,
        deletedTime: deletedAt,
        size,
        isDirectory: isDir,
      } satisfies TrashEntry;
    });
    return { ok: true, data: { entries, total: entries.length } };
  } catch (err) {
    console.warn('[platform:mac] trash.list failed:', err);
    return { ok: true, data: { entries: [], total: 0 } };
  }
}

async function macTrashRestore(itemPath: string, originalPath?: string): Promise<Result<void>> {
  // 优先用 AppleScript 让 Finder "put back"
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
      '    return "ERROR: " & errMsg',
      '  end try',
      '  return "OK"',
      'end tell',
    ].join('\n');
    try {
      const out = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf-8', timeout: 30_000,
      }).trim();
      if (out === 'OK' || out.includes('OK')) return { ok: true, data: undefined };
    } catch { /* fall through to mv fallback */ }
  }
  // Fallback: mv 到 ~/Desktop
  try {
    const desktop = join(homedir(), 'Desktop');
    const name = itemPath.split('/').pop() ?? 'restored';
    const dest = join(desktop, name);
    execSync(`mv "${itemPath}" "${dest}"`, { encoding: 'utf-8', timeout: 30_000 });
    return { ok: true, data: undefined };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err), path: itemPath } };
  }
}

async function macTrashEmpty(): Promise<Result<void>> {
  const trashPath = join(homedir(), '.Trash');
  try {
    execSync(`rm -rf "${trashPath}"/*`, { encoding: 'utf-8', timeout: 60_000 });
    return { ok: true, data: undefined };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Drives(df + mount 解析)
 * ───────────────────────────────────────────────────────────────────────── */

async function macListDrives(): Promise<import('@tabula/bridge').DriveInfo[]> {
  const SKIP_MOUNTS = [
    'devfs', '/dev/', 'fdesc', 'procfs', 'autofs', 'tmpfs', 'sysfs', 'map auto',
    '/System/Volumes/Preboot', '/System/Volumes/VM', '/System/Volumes/Update',
    '/System/Volumes/xarts', '/System/Volumes/iSCPreboot', '/System/Volumes/Hardware',
    '/System/Volumes/Data',
    '/private/var',
  ];
  try {
    const dfOut = execSync('df -k', { encoding: 'utf-8', timeout: 5_000 }).trim();
    const lines = dfOut.split('\n').slice(1);
    const drives: import('@tabula/bridge').DriveInfo[] = [];

    const mountOut = execSync('mount', { encoding: 'utf-8', timeout: 5_000 }).trim();
    const mountMap = new Map<string, string>();
    for (const m of mountOut.split('\n')) {
      const match = m.match(/ on (\S+) \(([^,)]+)/);
      if (match) mountMap.set(match[1], match[2]);
    }

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;
      const mount = parts[parts.length - 1];
      if (SKIP_MOUNTS.some((s) => mount === s || mount.startsWith(s + '/'))) continue;
      const totalBytes = Number(parts[1]) * 1024;
      const freeBytes = Number(parts[3]) * 1024;
      const fsInfo = mountMap.get(mount) ?? '';
      const fsType = fsInfo.split(' ')[0] ?? 'unknown';
      const mountLine = mountOut.split('\n').find((m) => m.includes(` on ${mount} `)) ?? '';
      const isExternal = /\bexternal\b/i.test(mountLine) || /\/dev\/disk[2-9]/.test(mountLine);
      const isReadOnly = /\bread-only\b/.test(mountLine);
      const type: 'fixed' | 'removable' = isExternal || isReadOnly ? 'removable' : 'fixed';
      const label = mount === '/' ? 'Macintosh HD' : (mount.split('/').pop() || mount);
      drives.push({ mount, label, totalBytes, freeBytes, type, fsType });
    }
    if (drives.length === 0) return [{ mount: '/', label: 'Macintosh HD', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
    return drives;
  } catch (err) {
    console.warn('[platform:mac] drive.list failed:', (err as Error).message);
    return [{ mount: '/', label: 'Macintosh HD', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shell
 * ───────────────────────────────────────────────────────────────────────── */

async function macOpenTerminal(path: string): Promise<Result<void>> {
  if (!path || typeof path !== 'string') {
    return { ok: false, error: { code: 'UNKNOWN', message: '路径为空' } };
  }
  try {
    const child = spawn('open', ['-a', 'Terminal', path], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'UNKNOWN', message } };
  }
}

async function macOpenWith(filePath: string, program: string): Promise<Result<void>> {
  try {
    const child = spawn('open', ['-a', program, filePath], { detached: true, stdio: 'ignore' });
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

export const macAdapter: PlatformAdapter = {
  id: 'darwin',
  name: 'macos',
  defaultRootPath: '/',
  quitOnAllWindowsClosed: false,  // macOS 习惯:Cmd+Q 才退出,关窗不退

  window: {
    getIconPath: macGetIconPath,
    getDockIconPath: macGetDockIconPath,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: false,        // macOS 菜单栏在屏幕顶部,不自动隐藏
  },

  shortcut: {
    getReservedKeyCombos: macReservedKeyCombos,
  },

  trash: {
    list: macTrashList,
    restore: macTrashRestore,
    empty: macTrashEmpty,
  },

  drive: {
    list: macListDrives,
  },

  shell: {
    openTerminal: macOpenTerminal,
    openWith: macOpenWith,
  },
};
