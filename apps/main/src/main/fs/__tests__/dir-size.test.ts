/**
 * G016: 后台异步目录大小计算 + 取消 单测。
 *
 * 覆盖:
 * - startDirSize → walk 完成 → done=true + totalBytes 正确累加
 * - startDirSize → cancelDirSize → done=true + cancelled=true + 中止
 * - jobs Map 60s 后清理(此处用单测时间加速:直接断言 done 后结构正确)
 * - 多 job 并发,各自独立
 * - handleGetDirSize / handleCancelDirSize 包装成 Result
 * - 取消不存在的 jobId 返回 false
 * - 非法 path / jobId → Result.error
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Mock electron 模块 — 避免在单测里加载真 electron
vi.mock('electron', () => {
  const sendMock = vi.fn();
  const isDestroyedMock = vi.fn(() => false);
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [
        {
          isDestroyed: isDestroyedMock,
          webContents: { send: sendMock },
        },
      ]),
    },
  };
});

// 在 import dir-size 之前 mock(模块层立即执行 BrowserWindow.getAllWindows)
import {
  startDirSize,
  cancelDirSize,
  onDirSizeProgress,
  handleGetDirSize,
  handleCancelDirSize,
  getJob,
  activeJobCount,
} from '../dir-size';
import type { DirSizeProgress } from '@tabula/bridge';

/** 等待 done=true 的事件 */
function waitForDone(jobId: string, timeoutMs = 2000): Promise<DirSizeProgress> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`timeout waiting for done of jobId=${jobId}`));
    }, timeoutMs);
    const unsub = onDirSizeProgress((p) => {
      if (p.jobId !== jobId) return;
      if (p.done) {
        clearTimeout(timer);
        unsub();
        resolve(p);
      }
    });
  });
}

/** 在临时目录创建一个测试树 */
async function makeTree(root: string, files: string[], sizes?: Record<string, number>): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  for (const rel of files) {
    const full = join(root, rel);
    await fs.mkdir(join(full, '..'), { recursive: true });
    const size = sizes?.[rel] ?? 100;
    await fs.writeFile(full, Buffer.alloc(size, 'x'));
  }
}

describe('G016: dir-size 后台异步 + 取消', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `dir-size-test-${randomUUID()}`);
    await fs.mkdir(tmpRoot, { recursive: true });
  });

  it('startDirSize 完成后广播 done=true + totalBytes 累加正确', async () => {
    await makeTree(tmpRoot, [
      'a.txt',
      'sub/b.txt',
      'sub/c.txt',
      'sub/deep/d.txt',
    ], {
      'a.txt': 10,
      'sub/b.txt': 20,
      'sub/c.txt': 30,
      'sub/deep/d.txt': 40,
    });

    const id = startDirSize(tmpRoot);
    expect(id).toBeTruthy();
    expect(getJob(id)?.cancelled).toBe(false);

    const done = await waitForDone(id);
    expect(done.done).toBe(true);
    expect(done.cancelled).toBe(false);
    expect(done.error).toBeUndefined();
    expect(done.totalBytes).toBe(10 + 20 + 30 + 40);
    expect(done.processedEntries).toBe(4);
    expect(done.path).toBe(tmpRoot);
    expect(done.jobId).toBe(id);
  });

  it('startDirSize 中途 cancelDirSize → done=true + cancelled=true', async () => {
    // 创建一个较大一些的树,确保有足够的 walk 时间给 cancel 触发
    const files: string[] = [];
    for (let i = 0; i < 50; i++) {
      files.push(`f${i}.txt`);
    }
    await makeTree(tmpRoot, files, Object.fromEntries(files.map((f) => [f, 50])));

    const id = startDirSize(tmpRoot);

    // 注册 listener 在 cancel 之前 — 模拟真实使用(UI 拿到 jobId 后立刻订阅)
    const donePromise = waitForDone(id);

    const ok = cancelDirSize(id);
    expect(ok).toBe(true);

    const done = await donePromise;
    expect(done.done).toBe(true);
    expect(done.cancelled).toBe(true);
  });

  it('cancelDirSize 幂等:对一个已 cancelled 的 job 再次 cancel 返回 true', async () => {
    await makeTree(tmpRoot, ['a.txt']);
    const id = startDirSize(tmpRoot);
    cancelDirSize(id);
    // 第二次 cancel 也应返回 true(幂等)
    const ok2 = cancelDirSize(id);
    expect(ok2).toBe(true);
  });

  it('cancelDirSize 对不存在的 jobId 返回 false', () => {
    const ok = cancelDirSize('not-a-real-id');
    expect(ok).toBe(false);
  });

  it('jobs Map 持有活动 job,done 后通过 setTimeout 在 60s 后清理', async () => {
    await makeTree(tmpRoot, ['a.txt']);
    const id = startDirSize(tmpRoot);
    expect(activeJobCount()).toBeGreaterThanOrEqual(1);
    expect(getJob(id)).toBeDefined();

    await waitForDone(id);
    // done 后 job 仍在(等 60s 后清理)
    expect(getJob(id)).toBeDefined();
  });

  it('多 job 并发:每个 job 独立 tracking', async () => {
    const rootA = join(tmpRoot, 'A');
    const rootB = join(tmpRoot, 'B');
    await makeTree(rootA, ['a.txt'], { 'a.txt': 100 });
    await makeTree(rootB, ['a.txt', 'b.txt'], { 'a.txt': 200, 'b.txt': 300 });

    const idA = startDirSize(rootA);
    const idB = startDirSize(rootB);
    expect(idA).not.toBe(idB);

    const [doneA, doneB] = await Promise.all([waitForDone(idA), waitForDone(idB)]);

    expect(doneA.totalBytes).toBe(100);
    expect(doneA.processedEntries).toBe(1);
    expect(doneB.totalBytes).toBe(200 + 300);
    expect(doneB.processedEntries).toBe(2);

    expect(getJob(idA)?.path).toBe(rootA);
    expect(getJob(idB)?.path).toBe(rootB);
  });

  it('startDirSize 路径不存在:done=true + error 字段', async () => {
    const nonexistent = join(tmpRoot, 'no-such-dir-xyz');
    const id = startDirSize(nonexistent);
    const done = await waitForDone(id);
    expect(done.done).toBe(true);
    // 路径不存在时 readdir 抛错被 walk 内部 catch,正常广播 done(没有 entries)
    expect(done.cancelled).toBe(false);
    expect(done.processedEntries).toBe(0);
    expect(done.totalBytes).toBe(0);
  });

  it('startDirSize 空目录:done=true + totalBytes=0', async () => {
    const empty = join(tmpRoot, 'empty');
    await fs.mkdir(empty, { recursive: true });
    const id = startDirSize(empty);
    const done = await waitForDone(id);
    expect(done.done).toBe(true);
    expect(done.totalBytes).toBe(0);
    expect(done.processedEntries).toBe(0);
  });

  it('onDirSizeProgress 返回 unsub 函数,unsub 后不再收到事件', async () => {
    await makeTree(tmpRoot, ['a.txt']);
    const id = startDirSize(tmpRoot);

    const received: DirSizeProgress[] = [];
    const unsub = onDirSizeProgress((p) => {
      if (p.jobId === id) received.push(p);
    });
    unsub();

    await waitForDone(id);
    // unsub 后不应当再收到事件(可能因为 listener Set 已经移除)
    // 至少 done 事件不应进入 received
    // 因为 done 是异步触发,unsub 几乎一定在 done 前生效
    expect(received.some((p) => p.done)).toBe(false);
  });

  it('handleGetDirSize:合法 path → ok=true + jobId 字符串', () => {
    const res = handleGetDirSize('/tmp/foo');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.data.jobId).toBe('string');
      expect(res.data.jobId.length).toBeGreaterThan(0);
    }
  });

  it('handleGetDirSize:非法 path → ok=false', () => {
    const res = handleGetDirSize('');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('UNKNOWN');
    }
  });

  it('handleCancelDirSize:合法 jobId → ok=true', async () => {
    await makeTree(tmpRoot, ['a.txt']);
    const id = startDirSize(tmpRoot);
    const donePromise = waitForDone(id);
    const res = handleCancelDirSize(id);
    expect(res.ok).toBe(true);
    const done = await donePromise;
    expect(done.done).toBe(true);
    expect(done.cancelled).toBe(true);
  });

  it('handleCancelDirSize:不存在的 jobId → ok=false + 错误信息', () => {
    const res = handleCancelDirSize('not-a-real-id');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('UNKNOWN');
      expect(res.error.message).toContain('not found');
    }
  });

  it('handleCancelDirSize:空 jobId → ok=false', () => {
    const res = handleCancelDirSize('');
    expect(res.ok).toBe(false);
  });

  it('进度事件 broadcast 同时通过 BrowserWindow.webContents.send 推送', async () => {
    const electron = await import('electron');
    const sendMock = (electron.BrowserWindow.getAllWindows()[0]?.webContents?.send) as ReturnType<typeof vi.fn>;
    sendMock.mockClear();

    await makeTree(tmpRoot, ['a.txt']);
    const id = startDirSize(tmpRoot);
    await waitForDone(id);

    // 至少调用过一次 send with 'fs:dir-size-progress'
    expect(sendMock).toHaveBeenCalled();
    const calls = sendMock.mock.calls;
    const matchedCall = calls.find(
      (call) => call[0] === 'fs:dir-size-progress' && (call[1] as DirSizeProgress).jobId === id,
    );
    expect(matchedCall).toBeDefined();
    if (matchedCall) {
      const payload = matchedCall[1] as DirSizeProgress;
      expect(payload.done).toBe(true);
    }
  });
});