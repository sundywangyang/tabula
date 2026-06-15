/**
 * Windows DriveProvider — 用 PowerShell Get-PSDrive -PSProvider FileSystem
 * 列出所有文件系统盘符, JSON 输出后解析。
 */
import { execSync } from 'node:child_process';
import type { DriveInfo } from '@tabula/bridge';
import type { DriveProvider } from './types';

export class WindowsDriveProvider implements DriveProvider {
  async listDrives(): Promise<DriveInfo[]> {
    try {
      const ps = execSync(
        'powershell.exe -NoProfile -NonInteractive -Command ' +
          '"Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{n=\'Label\';e={$_.VolumeLabel}},@{n=\'Total\';e={if($_.Used+$_.Free){$_.Used+$_.Free}else{0}}},@{n=\'Free\';e={if($_.Free){$_.Free}else{0}}},@{n=\'Root\';e={$_.Root}} | ConvertTo-Json -Compress"',
        { encoding: 'utf-8', timeout: 5000, windowsHide: true },
      ).trim();
      if (!ps) return this.fallback();
      const parsed = JSON.parse(ps);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const drives: DriveInfo[] = arr
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
      return drives.length === 0 ? this.fallback() : drives;
    } catch (err) {
      console.warn('[drive-provider] Windows listDrives failed, fallback:', (err as Error).message);
      return this.fallback();
    }
  }

  private fallback(): DriveInfo[] {
    return [{ mount: 'C:\\', label: 'C:', totalBytes: 0, freeBytes: 0, type: 'fixed' }];
  }
}
