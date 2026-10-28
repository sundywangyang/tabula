import { promises as fs } from 'node:fs';
import { resolve, sep } from 'node:path';

export function pathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function containsPath(parent: string, child: string): boolean {
  return pathKey(child).startsWith(pathKey(parent).replace(/[\\/]+$/, '') + sep);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function fileError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

export async function assertAbsent(path: string): Promise<void> {
  if (await pathExists(path)) throw fileError('EEXIST', `目标已存在: ${path}`);
}
