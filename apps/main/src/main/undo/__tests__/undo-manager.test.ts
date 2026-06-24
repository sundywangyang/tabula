/**
 * UndoManager 单元测试 (G012)
 *
 * 覆盖:
 * - execute(op) 调用 op.do() 一次,op 进入 undo 栈
 * - undo() 调用 op.undo() 一次,op 转移到 redo 栈
 * - redo() 调用 op.do() 再次,op 回到 undo 栈
 * - 多 op 入栈后,undo 遵循 LIFO
 * - execute() 会清空 redo 栈
 * - getStack() 返回浅拷贝(不暴露闭包)
 * - 空栈 undo/redo 返回 null 不抛错
 * - maxSize 上限:超出后从最旧一端淘汰
 */
import { describe, expect, it, vi } from 'vitest';
import { UndoManager, type UndoOperation } from '../undo-manager';

let nextId = 0;
function makeOp(
  doFn: () => Promise<void> | void = async () => undefined,
  undoFn: () => Promise<void> | void = async () => undefined,
  label = `op-${++nextId}`,
): UndoOperation {
  return {
    id: `id-${label}`,
    label,
    timestamp: Date.now(),
    do: vi.fn(doFn) as UndoOperation['do'],
    undo: vi.fn(undoFn) as UndoOperation['undo'],
  };
}

describe('UndoManager (G012)', () => {
  it('execute() 调用 do() 一次,op 进入 undo 栈', async () => {
    const mgr = new UndoManager();
    const op = makeOp();
    await mgr.execute(op);
    expect(op.do).toHaveBeenCalledTimes(1);
    expect(op.undo).not.toHaveBeenCalled();
    const snap = mgr.getStack();
    expect(snap.undo).toHaveLength(1);
    expect(snap.undo[0]?.id).toBe(op.id);
    expect(snap.redo).toHaveLength(0);
  });

  it('undo() 调用 undo() 一次,op 转移到 redo 栈', async () => {
    const mgr = new UndoManager();
    const op = makeOp();
    await mgr.execute(op);
    const popped = await mgr.undo();
    expect(popped?.id).toBe(op.id);
    expect(op.undo).toHaveBeenCalledTimes(1);
    const snap = mgr.getStack();
    expect(snap.undo).toHaveLength(0);
    expect(snap.redo).toHaveLength(1);
    expect(snap.redo[0]?.id).toBe(op.id);
  });

  it('redo() 调用 do() 再次,op 回到 undo 栈', async () => {
    const mgr = new UndoManager();
    const op = makeOp();
    await mgr.execute(op);
    await mgr.undo();
    const redone = await mgr.redo();
    expect(redone?.id).toBe(op.id);
    // do 被调用 2 次:execute 一次 + redo 一次
    expect(op.do).toHaveBeenCalledTimes(2);
    const snap = mgr.getStack();
    expect(snap.undo).toHaveLength(1);
    expect(snap.redo).toHaveLength(0);
  });

  it('多 op:undo 遵循 LIFO', async () => {
    const mgr = new UndoManager();
    const a = makeOp(async () => undefined, async () => undefined, 'a');
    const b = makeOp(async () => undefined, async () => undefined, 'b');
    const c = makeOp(async () => undefined, async () => undefined, 'c');
    await mgr.execute(a);
    await mgr.execute(b);
    await mgr.execute(c);
    expect(mgr.getStack().undo.map((o) => o.id)).toEqual([a.id, b.id, c.id]);
    const popped1 = await mgr.undo();
    expect(popped1?.id).toBe(c.id);
    const popped2 = await mgr.undo();
    expect(popped2?.id).toBe(b.id);
    const popped3 = await mgr.undo();
    expect(popped3?.id).toBe(a.id);
    expect(mgr.getStack().undo).toHaveLength(0);
    // redo 栈按弹出顺序(undo 时压入)排列:c 先入,b 次之,a 最后
    expect(mgr.getStack().redo.map((o) => o.id)).toEqual([c.id, b.id, a.id]);
  });

  it('execute() 会清空 redo 栈', async () => {
    const mgr = new UndoManager();
    const a = makeOp(async () => undefined, async () => undefined, 'a');
    const b = makeOp(async () => undefined, async () => undefined, 'b');
    await mgr.execute(a);
    await mgr.execute(b);
    await mgr.undo(); // b → redo
    await mgr.undo(); // a → redo
    expect(mgr.getStack().redo).toHaveLength(2);
    // 新 execute 应该把 redo 栈清掉
    const c = makeOp(async () => undefined, async () => undefined, 'c');
    await mgr.execute(c);
    const snap = mgr.getStack();
    expect(snap.redo).toHaveLength(0);
    expect(snap.undo).toHaveLength(1);
    expect(snap.undo[0]?.id).toBe(c.id);
  });

  it('getStack() 返回浅拷贝:不暴露 do/undo 闭包', async () => {
    const mgr = new UndoManager();
    const op = makeOp();
    await mgr.execute(op);
    const snap = mgr.getStack();
    // snap 上的元素没有 do/undo 字段(只有 id/label/timestamp)
    const info = snap.undo[0] as unknown as Record<string, unknown>;
    expect(info.id).toBe(op.id);
    expect(info.label).toBe(op.label);
    expect(typeof info.timestamp).toBe('number');
    expect(info.do).toBeUndefined();
    expect(info.undo).toBeUndefined();
  });

  it('空栈 undo() / redo() 返回 null,不抛错', async () => {
    const mgr = new UndoManager();
    expect(await mgr.undo()).toBeNull();
    expect(await mgr.redo()).toBeNull();
  });

  it('maxSize 上限:超出后从最旧一端淘汰', async () => {
    const mgr = new UndoManager(3);
    const ops: UndoOperation[] = [];
    for (let i = 0; i < 5; i++) {
      const op = makeOp(async () => undefined, async () => undefined, `op${i}`);
      ops.push(op);
      await mgr.execute(op);
    }
    const snap = mgr.getStack();
    // 入栈顺序 0,1,2,3,4;上限 3 → 留下 2,3,4
    expect(snap.undo.map((o) => o.label)).toEqual(['op2', 'op3', 'op4']);
  });

  it('getUndoSize / getRedoSize 反映当前栈大小', async () => {
    const mgr = new UndoManager();
    expect(mgr.getUndoSize()).toBe(0);
    expect(mgr.getRedoSize()).toBe(0);
    await mgr.execute(makeOp());
    expect(mgr.getUndoSize()).toBe(1);
    await mgr.undo();
    expect(mgr.getUndoSize()).toBe(0);
    expect(mgr.getRedoSize()).toBe(1);
  });

  it('clear() 清空两栈', async () => {
    const mgr = new UndoManager();
    await mgr.execute(makeOp());
    await mgr.execute(makeOp());
    await mgr.undo();
    mgr.clear();
    const snap = mgr.getStack();
    expect(snap.undo).toHaveLength(0);
    expect(snap.redo).toHaveLength(0);
  });
});
