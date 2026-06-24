/**
 * Undo/Redo 管理器
 *
 * 内存操作栈，不持久化（应用关闭后丢失）。
 * 支持的操作类型：delete, rename, move, copy
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type UndoOp =
  | { type: 'delete'; paths: string[] }
  | { type: 'rename'; oldPath: string; newPath: string }
  | { type: 'move'; sources: string[]; destDir: string }
  | { type: 'copy'; sources: string[]; destDir: string };

interface UndoState {
  stack: UndoOp[];
  redoStack: UndoOp[];
  maxSize: number;
}

let state: UndoState = { stack: [], redoStack: [], maxSize: 50 };

export function pushOp(op: UndoOp): void {
  state.stack.push(op);
  state.redoStack = []; // 新操作清空 redo 栈
  if (state.stack.length > state.maxSize) {
    state.stack.shift();
  }
}

export function undo(): UndoOp | null {
  const op = state.stack.pop();
  if (!op) return null;
  state.redoStack.push(op);
  return op;
}

export function redo(): UndoOp | null {
  const op = state.redoStack.pop();
  if (!op) return null;
  state.stack.push(op);
  return op;
}

export function getUndoStack(): UndoOp[] {
  return [...state.stack];
}

export function getRedoStack(): UndoOp[] {
  return [...state.redoStack];
}

/** 执行 undo 操作（逆操作） */
export async function executeUndo(op: UndoOp): Promise<{ ok: boolean; error?: string }> {
  try {
    if (op.type === 'rename') {
      await fs.rename(op.newPath, op.oldPath);
    } else if (op.type === 'delete') {
      // 删除的文件无法恢复（暂不支持从回收站还原）
      return { ok: false, error: '删除操作不支持撤销' };
    } else if (op.type === 'move') {
      // 逆操作：把 destDir 下的文件移回源目录
      for (const src of op.sources) {
        const name = basename(src);
        await fs.rename(join(op.destDir, name), src);
      }
    } else if (op.type === 'copy') {
      // 逆操作：删除复制的文件
      for (const src of op.sources) {
        const name = basename(src);
        await fs.unlink(join(op.destDir, name));
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
