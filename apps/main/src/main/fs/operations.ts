import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { MoveOrCopyRequest, Result } from '@tabula/bridge';
import { UndoManager, undoManager } from '../undo/undo-manager';
import { batchRename, type RenameItem } from './batch-rename';
import { copy } from './copy';
import { move } from './move';
import { assertAbsent, containsPath, fileError, pathExists, pathKey, samePath } from './path-safety';
import { mapError, ok } from './result';
export interface OperationHooks {
  migrate?: (mappings: Array<{ source: string; destination: string }>, copy?: boolean) => void;
  record?: (event: { operation: string; phase: 'do' | 'undo' | 'redo'; paths: string[]; destinations?: string[] }) => void;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data;
}

/** Metadata of the complete tree, without following symlinks. Undo must not erase later edits. */
async function fingerprint(path: string): Promise<string | null> {
  if (!await pathExists(path)) return null;
  const entries: unknown[] = [];
  const visit = async (current: string, relative: string): Promise<void> => {
    const stat = await fs.lstat(current);
    entries.push([relative, stat.mode, stat.size, stat.mtimeMs, stat.ino,
      stat.isSymbolicLink() ? await fs.readlink(current) : null]);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(current)).sort()) await visit(join(current, name), `${relative}/${name}`);
    }
  };
  await visit(path, '');
  return JSON.stringify(entries);
}

async function assertUnchanged(path: string, expected: string | null): Promise<void> {
  if (await fingerprint(path) !== expected) throw fileError('EBUSY', `文件已发生变化，操作已停止: ${path}`);
}

async function relocate(source: string, destination: string): Promise<void> {
  await fs.mkdir(dirname(destination), { recursive: true });
  unwrap(await move({ sources: [source], destination: dirname(destination), destinations: [destination], overwrite: false }));
}

/** The IPC mutation boundary. Every reversible operation and undo/redo uses the same queue. */
export class FileOperations {
  constructor(
    private readonly backupRoot: string,
    private readonly trashItem: (path: string) => Promise<void>,
    readonly history: UndoManager = undoManager,
    private readonly hooks: OperationHooks = {},
  ) {}

  private async execute(label: string, action: () => Promise<void>, undo: () => Promise<void>, backup?: string, paths: string[] = [], destinations?: string[]): Promise<Result<void>> {
    try {
      let first = true;
      const record = (phase: 'do' | 'undo' | 'redo') => {
        try { this.hooks.record?.({ operation: label, phase, paths, destinations }); } catch (error) { console.warn('操作历史写入失败', error); }
      };
      await this.history.execute({
        id: randomUUID(), label, timestamp: Date.now(),
        do: async () => { await action(); record(first ? 'do' : 'redo'); first = false; },
        undo: async () => { await undo(); record('undo'); },
        dispose: backup ? () => fs.rm(backup, { recursive: true, force: true }) : undefined,
      });
      return ok(undefined);
    } catch (error) {
      return mapError(error);
    }
  }

  copy(request: MoveOrCopyRequest): Promise<Result<void>> { return this.transfer(request, 'copy'); }
  move(request: MoveOrCopyRequest): Promise<Result<void>> { return this.transfer(request, 'move'); }

  private async transfer(request: MoveOrCopyRequest, mode: 'copy' | 'move'): Promise<Result<void>> {
    const backup = join(this.backupRoot, randomUUID());
    const plans = request.sources.map((source, index) => ({
      source, destination: request.destinations?.[index] ?? join(request.destination, basename(source)),
      backup: join(backup, String(index)), saved: false, done: false,
      staging: join(dirname(request.destinations?.[index] ?? join(request.destination, basename(source))), `.tabula-transfer-${randomUUID()}`),
      overwrite: request.overwrites?.[index] ?? request.overwrite ?? false,
      before: undefined as string | null | undefined, after: null as string | null,
      sourceBefore: undefined as string | null | undefined,
    })).filter((plan) => !samePath(plan.source, plan.destination));
    if (!plans.length) return ok(undefined);

    const undoPlan = async (plan: typeof plans[number]) => {
      if (plan.done) {
        if (mode === 'move') await relocate(plan.destination, plan.source);
        else await fs.rm(plan.destination, { recursive: true });
        plan.done = false;
      }
      if (await pathExists(plan.staging)) {
        if (mode === 'move') {
          // A failed cross-volume deletion can leave both paths. Preserve the recovery copy.
          if (await pathExists(plan.source)) throw new Error(`源文件和临时副本均保留，请检查: ${plan.staging}`);
          await relocate(plan.staging, plan.source);
        } else await fs.rm(plan.staging, { recursive: true });
      }
      if (plan.saved) {
        await relocate(plan.backup, plan.destination);
        plan.saved = false;
      }
      plan.before = await fingerprint(plan.destination);
      plan.sourceBefore = mode === 'move' ? await fingerprint(plan.source) : undefined;
    };

    return this.execute(`${mode === 'copy' ? '复制' : '移动'} ${plans.length} 项`, async () => {
      const targets = new Set(plans.map((plan) => pathKey(plan.destination)));
      if (targets.size !== plans.length) throw fileError('EEXIST', '多个源文件不能写入同一个目标');
      for (const plan of plans) {
        if (plans.some((other) => samePath(other.source, plan.destination) || containsPath(other.source, plan.destination)
          || containsPath(plan.destination, other.source))) throw fileError('EINVAL', '源目录和目标目录不能互相包含');
        await fs.lstat(plan.source);
        if (plan.sourceBefore !== undefined) await assertUnchanged(plan.source, plan.sourceBefore);
        if (plan.before !== undefined) await assertUnchanged(plan.destination, plan.before);
        else plan.before = await fingerprint(plan.destination);
        if (plan.before !== null && !plan.overwrite) throw fileError('EEXIST', `目标已存在: ${plan.destination}`);
      }
      try {
        for (const plan of plans) {
          // Write to a private name first. A failed copy must not remove a racing destination.
          await assertAbsent(plan.staging);
          unwrap(await (mode === 'copy' ? copy : move)({
            sources: [plan.source], destination: dirname(plan.staging), destinations: [plan.staging], overwrite: false,
          }));
          if (plan.before !== null) {
            await relocate(plan.destination, plan.backup);
            plan.saved = true;
          }
          await relocate(plan.staging, plan.destination);
          plan.done = true;
          plan.after = await fingerprint(plan.destination);
        }
        this.hooks.migrate?.(plans.map(p => ({ source: p.source, destination: p.destination })), mode === 'copy');
      } catch (error) {
        const rollbackErrors: string[] = [];
        for (const plan of [...plans].reverse()) {
          try {
            if (plan.done || plan.saved || await pathExists(plan.staging)) await undoPlan(plan);
          } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
        }
        if (rollbackErrors.length) throw new Error(`${String(error)}; 回滚未完成，可恢复备份: ${backup}; ${rollbackErrors.join('; ')}`);
        await fs.rm(backup, { recursive: true, force: true });
        throw error;
      }
    }, async () => {
      for (const plan of plans) {
        if (!plan.done) continue;
        await assertUnchanged(plan.destination, plan.after);
        if (mode === 'move') await assertAbsent(plan.source);
      }
      for (const plan of [...plans].reverse()) await undoPlan(plan);
      if (mode === 'move') this.hooks.migrate?.(plans.map(p => ({ source: p.destination, destination: p.source })));
    }, backup, plans.map(p => p.source), plans.map(p => p.destination));
  }

  rename(oldPath: string, newPath: string): Promise<Result<void>> {
    return this.batchRename([{ oldPath, newPath }]);
  }

  async batchRename(items: RenameItem[]): Promise<Result<void>> {
    const changes = items.filter((item) => item.oldPath !== item.newPath);
    if (!changes.length) return ok(undefined);
    let signatures: Array<string | null> = [];
    return this.execute(`重命名 ${changes.length} 项`, async () => {
      unwrap(await batchRename(changes));
      try { this.hooks.migrate?.(changes.map(p => ({ source: p.oldPath, destination: p.newPath }))); }
      catch (error) { unwrap(await batchRename(changes.map(p => ({ oldPath: p.newPath, newPath: p.oldPath })))); throw error; }
      signatures = await Promise.all(changes.map((item) => fingerprint(item.newPath)));
    }, async () => {
      for (let index = 0; index < changes.length; index++) await assertUnchanged(changes[index].newPath, signatures[index]);
      unwrap(await batchRename(changes.map((item) => ({ oldPath: item.newPath, newPath: item.oldPath }))));
      this.hooks.migrate?.(changes.map(p => ({ source: p.newPath, destination: p.oldPath })));
    }, undefined, changes.map(p => p.oldPath), changes.map(p => p.newPath));
  }

  async mkdir(path: string, name?: string): Promise<Result<string>> {
    const target = name ? join(path, name) : path;
    const result = await this.execute('新建文件夹', async () => { await fs.mkdir(target); }, async () => { await fs.rmdir(target); }, undefined, [target]);
    return result.ok ? ok(target) : result;
  }

  async writeFile(path: string, data: string | ArrayBuffer): Promise<Result<void>> {
    const backup = join(this.backupRoot, randomUUID());
    const savedPath = join(backup, 'original');
    let before: string | null | undefined;
    let after: string | null;
    let saved = false;
    return this.execute('写入文件', async () => {
      if (before !== undefined) await assertUnchanged(path, before);
      else before = await fingerprint(path);
      if (before !== null) { await relocate(path, savedPath); saved = true; }
      try {
        await fs.writeFile(path, typeof data === 'string' ? data : Buffer.from(data), { flag: 'wx' });
        after = await fingerprint(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await fs.rm(path, { force: true });
        if (saved) { await relocate(savedPath, path); saved = false; }
        throw error;
      }
    }, async () => {
      await assertUnchanged(path, after);
      await fs.unlink(path);
      if (saved) { await relocate(savedPath, path); saved = false; }
      before = await fingerprint(path);
    }, backup, [path]);
  }

  async delete(paths: string[], useTrash = true): Promise<Result<void>> {
    if (!paths.length) return ok(undefined);
    if (!useTrash) {
      try {
        await this.history.enqueue(async () => {
          for (const path of paths) await fs.rm(path, { recursive: true });
          this.hooks.record?.({ operation: '永久删除', phase: 'do', paths });
        });
        return ok(undefined);
      } catch (error) { return mapError(error); }
    }
    const backup = join(this.backupRoot, randomUUID());
    const plans = paths.filter((path, index) => paths.findIndex((other) => samePath(path, other)) === index)
      .filter((path) => !paths.some((other) => containsPath(other, path)))
      .map((path, index) => ({ path, backup: join(backup, String(index)), signature: undefined as string | null | undefined, restored: false }));
    let backedUp = false;
    return this.execute(`删除 ${plans.length} 项`, async () => {
      for (const plan of plans) {
        if (plan.signature !== undefined) await assertUnchanged(plan.path, plan.signature);
        else {
          await fs.lstat(plan.path);
          plan.signature = await fingerprint(plan.path);
        }
      }
      if (!backedUp) {
        await fs.mkdir(backup, { recursive: true });
        for (const plan of plans) await fs.cp(plan.path, plan.backup, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        backedUp = true;
      }
      const deleted: typeof plans = [];
      try {
        for (const plan of plans) {
          await assertUnchanged(plan.path, plan.signature!);
          await this.trashItem(plan.path); deleted.push(plan); plan.restored = false;
        }
      } catch (error) {
        for (const plan of deleted) await fs.cp(plan.backup, plan.path, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
        throw error;
      }
    }, async () => {
      for (const plan of plans) if (!plan.restored) await assertAbsent(plan.path);
      for (const plan of plans) {
        if (!plan.restored) {
          await fs.cp(plan.backup, plan.path, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
          plan.restored = true;
        }
        plan.signature = await fingerprint(plan.path);
      }
    }, backup, paths);
  }
}
