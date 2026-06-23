/**
 * macOS DriveProvider — df 列出所有挂载卷, mount 拿 fs 类型 + 设备路径,
 * 跳过虚拟 FS + APFS 系统子卷 (Data/Preboot/VM/Update...) 避免 sidebar 重复显示。
 *
 * macOS 13+ 把主卷拆成 / (sealed, read-only) + /System/Volumes/Data (rw),
 * 这俩共享同一物理磁盘, 必须把 Data 也跳过。
 */
import { execSync } from 'node:child_process';
import type { DriveInfo } from '@tabula/bridge';
import type { DriveProvider } from './types';

const SKIP_MOUNTS = [
  'devfs', '/dev/', 'fdesc', 'procfs', 'autofs', 'tmpfs', 'sysfs', 'map auto',
  // APFS 系统子卷 — 全部在 /System/Volumes/ 下, 一次性 prefix 过滤
  '/System/Volumes/Preboot', '/System/Volumes/VM', '/System/Volumes/Update',
  '/System/Volumes/xarts', '/System/Volumes/iSCPreboot', '/System/Volumes/Hardware',
  '/System/Volumes/Data',
  // 旧版 macOS (12 及之前) 的 /private/var/* 子挂载
  '/private/var',
];

export class MacosDriveProvider implements DriveProvider {
  async listDrives(): Promise<DriveInfo[]> {
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
        // 跳过虚拟文件系统 + APFS 子卷
        if (SKIP_MOUNTS.some((s) => mount === s || mount.startsWith(s + '/'))) continue;

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

        drives.push({ mount, label, totalBytes, freeBytes, type, fsType });
      }
      return drives.length === 0 ? this.fallback() : drives;
    } catch (err) {
      console.warn('[drive-provider] macOS listDrives failed:', (err as Error).message);
      return this.fallback();
    }
  }

  private fallback(): DriveInfo[] {
    return [{ mount: '/', label: 'Macintosh HD', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
}
