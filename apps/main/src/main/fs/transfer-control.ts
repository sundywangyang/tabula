import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export interface TransferControl {
  signal: AbortSignal;
  onFile(path: string): void;
  onBytes(bytes: number): void;
  onItem(): void;
}

export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw Object.assign(new Error('操作已取消'), { code: 'ABORT_ERR' });
}

/** Copies into an operation-owned staging path; no source is modified. */
export async function copyControlled(source: string, destination: string, control: TransferControl): Promise<void> {
  checkCancelled(control.signal);
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) {
    // Preserve Node's platform-specific symlink behaviour.
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  } else if (stat.isDirectory()) {
    await fs.mkdir(destination, { mode: stat.mode });
    for (const child of await fs.readdir(source)) {
      await copyControlled(join(source, child), join(destination, child), control);
    }
  } else if (stat.isFile()) {
    control.onFile(source);
    const input = createReadStream(source);
    input.on('data', (chunk) => control.onBytes(chunk.length));
    await pipeline(input, createWriteStream(destination, { flags: 'wx', mode: stat.mode }), { signal: control.signal });
  } else {
    throw new Error(`不支持复制此类型的文件: ${source}`);
  }
  checkCancelled(control.signal);
}

export async function measureTransfer(paths: string[], signal: AbortSignal): Promise<number> {
  let bytes = 0;
  const visit = async (path: string): Promise<void> => {
    checkCancelled(signal);
    const stat = await fs.lstat(path);
    if (stat.isFile()) bytes += stat.size;
    else if (stat.isDirectory()) for (const name of await fs.readdir(path)) await visit(join(path, name));
  };
  for (const path of paths) await visit(path);
  return bytes;
}
