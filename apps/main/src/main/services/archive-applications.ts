import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import type { ArchiveApplication, ArchiveApplicationOpenResult } from '@tabula/bridge';
import { invokeWindowsAssociation, listWindowsAssociations, type SystemAssociation } from './windows-associations';
import { openWindowsApplicationChooser } from './open-with';

type Dependencies = {
  platform: string;
  list: (extension: string) => Promise<SystemAssociation[]>;
  invoke: (path: string, association: SystemAssociation, onLateError?: (error: Error) => void) => Promise<void>;
  isFile: (path: string) => Promise<boolean>;
  needsSystemChooser: (path: string) => Promise<boolean>;
  openChooser: (path: string) => Promise<void>;
};

/** Downloaded files may require an interactive Windows security confirmation. */
export async function needsSystemChooser(path: string): Promise<boolean> {
  let stream: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    stream = await fs.open(`${path}:Zone.Identifier`, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await stream.read(buffer, 0, buffer.length, 0);
    const zone = /^\s*ZoneId\s*=\s*(\d+)\s*$/im.exec(buffer.subarray(0, bytesRead).toString('utf8'));
    return !zone || Number(zone[1]) >= 3;
  } catch (error) {
    // An inaccessible or malformed marker should not suppress Windows prompts.
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  } finally {
    await stream?.close();
  }
}

function validatePath(path: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 32768 || path.includes('\0')) throw new Error('文件路径无效');
  const extension = extname(path).toLowerCase();
  if (!/^\.[a-z0-9]{1,16}$/i.test(extension)) throw new Error('文件类型无效');
  return extension;
}
function associationId(item: SystemAssociation): string {
  return createHash('sha256').update(item.identity).update('\0').update(item.name).digest('hex');
}
function uniqueAssociations(items: SystemAssociation[]): SystemAssociation[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.name.trim() || !item.identity.trim()) return false;
    const id = associationId(item);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
}

export function createArchiveApplicationService(deps: Dependencies) {
  return {
    async list(path: string): Promise<ArchiveApplication[]> {
      const extension = validatePath(path);
      if (deps.platform !== 'win32') return [];
      const associations = uniqueAssociations(await deps.list(extension));
      return associations.map(item => ({ id: associationId(item), name: item.name }));
    },
    async open(path: string, id: string, onLateError?: (error: Error) => void): Promise<ArchiveApplicationOpenResult> {
      const extension = validatePath(path);
      if (deps.platform !== 'win32' || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('系统应用无效');
      if (!(await deps.isFile(path))) throw new Error('压缩文件不存在');
      // Re-query before invocation: a removed or changed association must not be launched.
      const item = uniqueAssociations(await deps.list(extension)).find(association => associationId(association) === id);
      if (!item) throw new Error('系统应用关联已发生变化，请重新打开菜单');
      if (await deps.needsSystemChooser(path)) {
        await deps.openChooser(path);
        return { method: 'system-chooser' };
      }
      if (onLateError) await deps.invoke(path, item, onLateError);
      else await deps.invoke(path, item);
      return { method: 'application' };
    },
  };
}
const service = createArchiveApplicationService({
  platform: process.platform,
  list: listWindowsAssociations,
  invoke: invokeWindowsAssociation,
  isFile: async path => { try { return (await fs.stat(path)).isFile(); } catch { return false; } },
  needsSystemChooser,
  openChooser: openWindowsApplicationChooser,
});
export const getArchiveApplications = service.list;
export const openWithArchiveApplication = service.open;
