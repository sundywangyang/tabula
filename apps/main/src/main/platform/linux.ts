/**
 * Linux 平台适配器
 *
 * 涵盖:
 *  - 主窗口 icon(用 png/512.png;Linux 桌面没有 .icns/.ico 标准)
 *  - 系统保留键(Meta+L 锁屏、Meta+Tab 切应用 等)
 *  - 回收站(XDG Trash spec: $XDG_DATA_HOME/Trash,gio 优先)
 *  - 驱动器列表(df + findmnt 拿 fs 类型)
 *  - 终端(依次尝试 x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal,xterm 兜底)
 *  - 用程序打开文件(`xdg-open <file>`)
 */
import { execSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseKeyCombo } from '../keymap/keymap-parser';
import type { DriveInfo, KeyCombo, Result, TrashEntry, TrashListResult } from '@tabula/bridge';
import type { PlatformAdapter, ResolvePathContext } from './types';

/* ─────────────────────────────────────────────────────────────────────────
 * Window chrome
 * ───────────────────────────────────────────────────────────────────────── */

function linuxGetIconPath(ctx: ResolvePathContext): string {
  return join(ctx.appRoot, '..', '..', '..', '..', 'build-assets', 'icon', 'png', '512.png');
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shortcuts(Linux 桌面环境保留键)
 * ───────────────────────────────────────────────────────────────────────── */

function linuxReservedKeyCombos(): KeyCombo[] {
  const base: KeyCombo[] = [
    parseKeyCombo('Alt+F4')!,
    parseKeyCombo('Alt+Tab')!,
    parseKeyCombo('Ctrl+Alt+Delete')!,
  ];
  return [
    ...base,
    parseKeyCombo('Meta+L')!,        // GNOME/KDE 锁屏
    parseKeyCombo('Ctrl+Alt+L')!,   // 一些桌面锁屏
    parseKeyCombo('Meta+Tab')!,      // 切应用
  ];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Trash(XDG Trash spec + gio)
 * ───────────────────────────────────────────────────────────────────────── */

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
      const out = execSync('gio list trash://', { encoding: 'utf-8', timeout: 15_000 }).trim();
      if (out) {
        names = out
          .split('\n')
          .filter(Boolean)
          .map((uri) => {
            const m = uri.match(/\/files\/(.+)$/);
            return m ? m[1] : uri.split('/').pop() ?? '';
          });
      }
    } catch {
      // 降级: 直接读 files/ 目录
      try {
        names = readdirSync(filesDir);
      } catch {
        return { ok: true, data: { entries: [], total: 0 } };
      }
    }

    const entries: TrashEntry[] = [];
    for (const name of names) {
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
        try {
          const s = statSync(itemPath);
          deletedTime = s.mtimeMs;
        } catch { /* ignore */ }
      }

      let size = 0;
      let isDir = false;
      try {
        const s = statSync(itemPath);
        size = s.size;
        isDir = s.isDirectory();
      } catch { /* ignore */ }

      entries.push({ itemPath, originalPath, name, deletedTime, size, isDirectory: isDir });
    }
    return { ok: true, data: { entries, total: entries.length } };
  } catch (err) {
    console.warn('[platform:linux] trash.list failed:', err);
    return { ok: true, data: { entries: [], total: 0 } };
  }
}

async function linuxTrashRestore(itemPath: string, originalPath?: string): Promise<Result<void>> {
  // 优先 gio trash --restore(需要 .trashinfo 中有 Path=)
  try {
    execSync(`gio trash --restore "${itemPath}"`, { encoding: 'utf-8', timeout: 30_000 });
    return { ok: true, data: undefined };
  } catch {
    if (originalPath) {
      try {
        execSync(`mv "${itemPath}" "${originalPath}"`, { encoding: 'utf-8', timeout: 30_000 });
        const infoPath = join(linuxTrashHome(), 'info', `${itemPath.split('/').pop()}.trashinfo`);
        try { unlinkSync(infoPath); } catch { /* ignore */ }
        return { ok: true, data: undefined };
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err), path: itemPath } };
      }
    }
    return { ok: false, error: { code: 'ENOENT', message: 'Cannot restore: no original path known', path: itemPath } };
  }
}

async function linuxTrashEmpty(): Promise<Result<void>> {
  try {
    execSync('gio trash --empty', { encoding: 'utf-8', timeout: 60_000 });
    return { ok: true, data: undefined };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Drives(df + findmnt 拿 fs 类型)
 * ───────────────────────────────────────────────────────────────────────── */

async function linuxListDrives(): Promise<DriveInfo[]> {
  const SKIP_MOUNTS = [
    'devfs', 'fdesc', 'procfs', 'autofs', 'devtmpfs', 'tmpfs', 'overlay', 'shm', 'efivarfs',
    'cgroup', 'cgroup2', 'pstore', 'bpf', 'configfs', 'debugfs', 'fusectl', 'hugetlbfs',
    'mqueue', 'nsfs', 'pipefs', 'proc', 'ramfs', 'rpc_pipefs', 'securityfs', 'selinuxfs',
    'sockfs', 'sysfs', 'tracefs', 'vboxsf',
  ];
  try {
    const dfOut = execSync('df -k', { encoding: 'utf-8', timeout: 5_000 }).trim();
    const lines = dfOut.split('\n').slice(1);
    const drives: DriveInfo[] = [];

    let mountMap = new Map<string, string>();
    try {
      const findmntOut = execSync('findmnt -rn -o TARGET,FSTYPE,SIZE', { encoding: 'utf-8', timeout: 5_000 }).trim();
      for (const m of findmntOut.split('\n')) {
        const parts = m.split(/\s+/);
        if (parts.length >= 2) mountMap.set(parts[0], parts[1]);
      }
    } catch {
      try {
        const procOut = readFileSync('/proc/mounts', 'utf-8');
        for (const m of procOut.split('\n')) {
          const parts = m.split(/\s+/);
          if (parts.length >= 3) mountMap.set(parts[1], parts[2]);
        }
      } catch { /* ignore */ }
    }

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const mount = parts[parts.length - 1];
      if (SKIP_MOUNTS.some((s) => mount === '/' + s || mount === s)) continue;
      if (mount.startsWith('/sys/') || mount.startsWith('/proc/') || mount.startsWith('/run/')) continue;

      const totalBytes = Number(parts[1]) * 1024;
      const freeBytes = Number(parts[3]) * 1024;
      const fsType = mountMap.get(mount) ?? 'unknown';
      const type: 'fixed' | 'removable' = (
        fsType === 'iso9660' || fsType === 'udf' || fsType === 'smbfs' || fsType === 'nfs' || fsType === 'cifs'
      ) ? 'removable' : 'fixed';
      const label = mount === '/' ? 'Root' : (mount.split('/').pop() || mount);
      drives.push({ mount, label, totalBytes, freeBytes, type, fsType });
    }
    return drives;
  } catch (err) {
    console.warn('[platform:linux] drive.list failed:', (err as Error).message);
    return [];
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shell
 * ───────────────────────────────────────────────────────────────────────── */

async function linuxOpenTerminal(path: string): Promise<Result<void>> {
  if (!path || typeof path !== 'string') {
    return { ok: false, error: { code: 'UNKNOWN', message: '路径为空' } };
  }
  // 依次尝试常见终端,首个 spawn 成功的胜出
  const candidates: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['x-terminal-emulator', [`--working-directory=${path}`]],
    ['gnome-terminal', [`--working-directory=${path}`]],
    ['konsole', ['--workdir', path]],
    ['xfce4-terminal', [`--working-directory=${path}`]],
  ];
  for (const [cmd, args] of candidates) {
    try {
      const child = spawn(cmd, [...args], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, data: undefined };
    } catch {
      // 该终端不存在,继续试下一个
    }
  }
  // 兜底:xterm + bash -c "cd <path> && bash"
  try {
    const safePath = path.replace(/'/g, "'\\''");
    const child = spawn('xterm', ['-e', `bash -c "cd '${safePath}' && bash"`], {
      detached: true, stdio: 'ignore',
    });
    child.unref();
    return { ok: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'UNKNOWN', message } };
  }
}

async function linuxOpenWith(filePath: string, _program: string): Promise<Result<void>> {
  try {
    const child = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' });
    child.unref();
    // 备注:Linux 下"指定程序"语义需要 desktop entry 解析,这版先走 xdg-open 默认关联
    return { ok: true, data: undefined };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 组装 adapter
 * ───────────────────────────────────────────────────────────────────────── */

export const linuxAdapter: PlatformAdapter = {
  id: 'linux',
  name: 'linux',
  defaultRootPath: '/',
  quitOnAllWindowsClosed: true,

  window: {
    getIconPath: linuxGetIconPath,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
  },

  shortcut: {
    getReservedKeyCombos: linuxReservedKeyCombos,
  },

  trash: {
    list: linuxTrashList,
    restore: linuxTrashRestore,
    empty: linuxTrashEmpty,
  },

  drive: {
    list: linuxListDrives,
  },

  shell: {
    openTerminal: linuxOpenTerminal,
    openWith: linuxOpenWith,
  },
};
