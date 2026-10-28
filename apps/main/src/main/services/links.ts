import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LinkInfo } from '@tabula/bridge';

export async function linkInfo(path: string): Promise<LinkInfo> {
  const stat = await fs.lstat(path);
  return { path, kind: stat.isSymbolicLink() ? process.platform === 'win32' && (await fs.stat(path).catch(() => null))?.isDirectory() ? 'junction' : 'symlink' : stat.isDirectory() ? 'directory' : stat.nlink > 1 ? 'hardlink' : 'file',
    ...(stat.isSymbolicLink() ? { target: await fs.readlink(path) } : {}), links: stat.nlink, inode: `${stat.dev}:${stat.ino}` };
}
export async function createLink(target: string, path: string, kind: 'symlink' | 'hardlink'): Promise<LinkInfo> {
  if (!isAbsolute(target) || !isAbsolute(path)) throw new Error('链接和目标必须使用绝对路径');
  const stat = await fs.stat(target);
  if (kind === 'hardlink') { if (!stat.isFile()) throw new Error('硬链接仅支持文件，且必须位于同一卷'); await fs.link(target, path); }
  else await fs.symlink(target, path, stat.isDirectory() ? process.platform === 'win32' ? 'junction' : 'dir' : 'file');
  return linkInfo(path);
}
export async function retargetLink(path: string, target: string): Promise<LinkInfo> {
  if (!(await fs.lstat(path)).isSymbolicLink()) throw new Error('只有符号链接可以修改目标；硬链接不能重新指定目标');
  if (resolve(path) === resolve(target)) throw new Error('链接不能指向自身');
  const temporary = join(dirname(path), `.tabula-link-${randomUUID()}`);
  const backup = temporary + '.backup';
  await createLink(target, temporary, 'symlink');
  let saved = false;
  try { await fs.rename(path, backup); saved = true; await fs.rename(temporary, path); }
  catch (e) { if (saved) await fs.rename(backup, path); throw e; }
  finally { await fs.unlink(temporary).catch(() => {}); }
  await fs.unlink(backup);
  return linkInfo(path);
}
