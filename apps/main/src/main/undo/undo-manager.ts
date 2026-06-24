/**
 * Undo/Redo 管理器
 *
 * 内存操作栈,不持久化(应用关闭后丢失)。
 *
 * 两套 API:
 * - 旧的 data-driven 接口(`pushOp` / `undo` / `redo` / `executeUndo` / `getUndoStack`)
 *   主要服务 `delete / rename / move / copy` 这类能用纯数据描述的操作。
 * - 新的 callback-based `UndoManager` 类(`execute` / `undo` / `redo` / `getStack`),
 *   用于需要更复杂副作用(例如 trash-restore 链)的可逆操作,每个 op 自带 do/undo 函数。
 *
 * 两者并存,共用了同样的栈容量上限思路(50 / 100),但栈是各自独立的,避免
 * 旧 IPC 路径污染新 class 的 redo 栈。
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

/** 执行 undo 操作(逆操作) */
export async function executeUndo(op: UndoOp): Promise<{ ok: boolean; error?: string }> {
  try {
    if (op.type === 'rename') {
      await fs.rename(op.newPath, op.oldPath);
    } else if (op.type === 'delete') {
      // 删除的文件无法恢复(暂不支持从回收站还原)
      return { ok: false, error: '删除操作不支持撤销' };
    } else if (op.type === 'move') {
      // 逆操作:把 destDir 下的文件移回源目录
      for (const src of op.sources) {
        const name = basename(src);
        await fs.rename(join(op.destDir, name), src);
      }
    } else if (op.type === 'copy') {
      // 逆操作:删除复制的文件
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

// =================== 新的 callback-based API (G012) ===================

/**
 * 一条可撤销操作,自带 do / undo 函数。
 * - id: 唯一 id(用于 UI 去重 / 调试)
 * - label: 人类可读描述,例如 "Delete 3 files"
 * - timestamp: 入栈时间(ms since epoch)
 * - do(): 执行业务动作(用户主动发起时,也会被 redo 复用)
 * - undo(): 逆操作
 */
export interface UndoOperation {
  id: string;
  label: string;
  timestamp: number;
  do: () => Promise<void>;
  undo: () => Promise<void>;
}

/** UndoOperation 的对外展示形态(IPC 跨进程 + UI 用) */
export interface UndoOperationInfo {
  id: string;
  label: string;
  timestamp: number;
}

/** 栈快照(IPC 返回值) */
export interface UndoStackSnapshot {
  undo: UndoOperationInfo[];
  redo: UndoOperationInfo[];
}

/**
 * 操作栈管理器。
 * - execute(op): 执行 op.do() → 入 undo 栈 → 清空 redo 栈
 * - undo(): 弹栈 → 执行 op.undo() → 推到 redo 栈
 * - redo(): 弹 redo 栈 → 执行 op.do() → 推回 undo 栈
 * - getStack(): 返回两个栈的浅拷贝快照
 *
 * 容量上限 maxSize(默认 100),超出后从最旧一端淘汰。
 */
export class UndoManager {
  private stack: UndoOperation[] = [];
  private redoStack: UndoOperation[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /** 执行 op 并入栈。do 失败时不上栈,redo 栈也不会被清空。 */
  async execute(op: UndoOperation): Promise<void> {
    await op.do();
    this.stack.push(op);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
    this.redoStack = [];
  }

  /** 弹栈 → undo → 推到 redo 栈。空栈返回 null。 */
  async undo(): Promise<UndoOperation | null> {
    const op = this.stack.pop();
    if (!op) return null;
    await op.undo();
    this.redoStack.push(op);
    return op;
  }

  /** 弹 redo 栈 → do → 推回 undo 栈。空栈返回 null。 */
  async redo(): Promise<UndoOperation | null> {
    const op = this.redoStack.pop();
    if (!op) return null;
    await op.do();
    this.stack.push(op);
    return op;
  }

  /** 当前两个栈的浅拷贝快照(不暴露 do/undo 闭包) */
  getStack(): UndoStackSnapshot {
    return {
      undo: this.stack.map(toInfo),
      redo: this.redoStack.map(toInfo),
    };
  }

  /** undo 栈长度(给 UI 显示 "可撤销 N 项") */
  getUndoSize(): number {
    return this.stack.length;
  }

  /** redo 栈长度 */
  getRedoSize(): number {
    return this.redoStack.length;
  }

  /** 清空两个栈(例如应用启动重置 / 用户主动 clear) */
  clear(): void {
    this.stack = [];
    this.redoStack = [];
  }
}

function toInfo(op: UndoOperation): UndoOperationInfo {
  return { id: op.id, label: op.label, timestamp: op.timestamp };
}

/** 进程内单例。renderer 不直接使用,主进程 IPC handler 用。 */
export const undoManager = new UndoManager();
