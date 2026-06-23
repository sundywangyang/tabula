/**
 * Linux DriveProvider — df 列出挂载, findmnt (util-linux) 拿 fs 类型
 * (不可用时降级 /proc/mounts).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { DriveInfo } from '@tabula/bridge';
import type { DriveProvider } from './types';

const SKIP_MOUNTS = [
  'devfs', 'fdesc', 'procfs', 'autofs', 'devtmpfs', 'tmpfs', 'overlay', 'shm',
  'efivarfs', 'cgroup', 'cgroup2', 'pstore', 'bpf', 'configfs', 'debugfs',
  'fusectl', 'hugetlbfs', 'mqueue', 'nsfs', 'pipefs', 'proc', 'ramfs',
  'rpc_pipefs', 'securityfs', 'selinuxfs', 'sockfs', 'sysfs', 'tracefs', 'vboxsf',
];

export class LinuxDriveProvider implements DriveProvider {
  async listDrives(): Promise<DriveInfo[]> {
    try {
      const dfOut = execSync('df -k', { encoding: 'utf-8', timeout: 5000 }).trim();
      const lines = dfOut.split('\n').slice(1);
      const drives: DriveInfo[] = [];

      const mountMap = await this.readMountMap();
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length < 6) continue;
        const mount = parts[parts.length - 1];
        // 跳过虚拟文件系统
        if (SKIP_MOUNTS.some((s) => mount === '/' + s || mount === s)) continue;
        if (mount.startsWith('/sys/') || mount.startsWith('/proc/') || mount.startsWith('/run/')) continue;

        const totalBytes = Number(parts[1]) * 1024;
        const freeBytes = Number(parts[3]) * 1024;
        const fsType = mountMap.get(mount) ?? 'unknown';

        // 光盘、远程、外部盘算 removable
        const type: 'fixed' | 'removable' = (
          fsType === 'iso9660' || fsType === 'udf' ||
          fsType === 'nfs' || fsType === 'nfs4' || fsType === 'cifs' || fsType === 'smbfs' ||
          fsType === 'vfat' || fsType === 'exfat' || fsType === 'fuseblk' ||
          fsType === 'usbfs' || fsType === 'devpts'
        ) ? 'removable' : 'fixed';

        const label = mount === '/' ? '根分区' : (mount.split('/').pop() || mount);
        drives.push({ mount, label, totalBytes, freeBytes, type, fsType });
      }
      return drives.length === 0 ? this.fallback() : drives;
    } catch (err) {
      console.warn('[drive-provider] Linux listDrives failed:', (err as Error).message);
      return this.fallback();
    }
  }

  private async readMountMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const out = execSync('findmnt -rn -o TARGET,FSTYPE,SIZE', { encoding: 'utf-8', timeout: 5000 }).trim();
      for (const m of out.split('\n')) {
        const parts = m.split(/\s+/);
        if (parts.length >= 2) map.set(parts[0], parts[1]);
      }
    } catch {
      // 降级到 /proc/mounts
      try {
        const procOut = readFileSync('/proc/mounts', 'utf-8');
        for (const m of procOut.split('\n')) {
          const parts = m.split(/\s+/);
          if (parts.length >= 3) map.set(parts[1], parts[2]);
        }
      } catch {
        // ignore
      }
    }
    return map;
  }

  private fallback(): DriveInfo[] {
    return [{ mount: '/', label: '根分区', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
}
