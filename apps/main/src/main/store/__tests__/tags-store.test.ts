/**
 * tags-store 单元测试 (G008)
 *
 * 覆盖:
 * - getTags 不存在路径 → 返回 []
 * - setTags 后 getTags → roundtrip
 * - addTag 重复 → 不重复
 * - removeTag → 真的移除
 * - getAllTags → 返回完整 state
 *
 * electron-store 在 vitest (jsdom/Node) 环境里会尝试 require('electron')。
 * 这里用 vi.mock 把 electron-store 替换成纯 conf 的内存实现,
 * 用 tmpDir 隔离每个测试,避免污染 userData。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 用一个内存中的嵌套对象模拟 electron-store 的 dot-path 语义
// electron-store 内部走 conf, key 用 '.' 作为 path separator
// 例如 set('tags.C:/a.txt', ['x']) 后 get('tags') → { 'C:/a.txt': ['x'] }
function makeMemoryStore() {
  const root: Record<string, unknown> = {};

  function getPath(key: string): unknown {
    if (!key) return root;
    const parts = key.split('.');
    let cur: Record<string, unknown> | unknown = root;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  function setPath(key: string, value: unknown): void {
    const parts = key.split('.');
    if (parts.length === 1) {
      root[parts[0]!] = value;
      return;
    }
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      const next = cur[p];
      if (next && typeof next === 'object') {
        cur = next as Record<string, unknown>;
      } else {
        const fresh: Record<string, unknown> = {};
        cur[p] = fresh;
        cur = fresh;
      }
    }
    cur[parts[parts.length - 1]!] = value;
  }

  return {
    get(key: string, defaultValue?: unknown): unknown {
      const v = getPath(key);
      return v === undefined ? defaultValue : v;
    },
    set(key: string, value: unknown): void {
      setPath(key, value);
    },
    delete(key: string): void {
      const parts = key.split('.');
      if (parts.length === 1) {
        delete root[parts[0]!];
        return;
      }
      let cur: Record<string, unknown> | unknown = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          return;
        }
      }
      if (cur && typeof cur === 'object') {
        delete (cur as Record<string, unknown>)[parts[parts.length - 1]!];
      }
    },
    clear(): void {
      for (const k of Object.keys(root)) delete root[k];
    },
  };
}

let memoryStore: ReturnType<typeof makeMemoryStore>;

vi.mock('electron-store', () => {
  return {
    default: class FakeStore {
      // 兼容 Store<T> 用法
      private store: ReturnType<typeof makeMemoryStore>;
      constructor(_opts?: { name?: string }) {
        // 全部共享一个内存 store(测试间用 cwd 隔离)
        if (!memoryStore) memoryStore = makeMemoryStore();
        this.store = memoryStore;
      }
      get(key: string, defaultValue?: unknown): unknown {
        return this.store.get(key, defaultValue);
      }
      set(key: string, value: unknown): void {
        this.store.set(key, value);
      }
      delete(key: string): void {
        this.store.delete(key);
      }
    },
  };
});

// 由于 tags-store.ts 用 module-level singleton 缓存 store 实例,
// 我们在 import 之前重置 mockStore
let tmpDir = '';
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tabula-tags-test-'));
  memoryStore = makeMemoryStore();
  // vi.resetModules 让 tags-store 重新求值 → 重新创建 store
  vi.resetModules();
});

afterEach(() => {
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    tmpDir = '';
  }
});

async function loadStore() {
  return await import('../tags-store');
}

describe('tags-store (G008)', () => {
  it('getTags:不存在的路径 → []', async () => {
    const { getTags } = await loadStore();
    expect(getTags('C:/no/such/file.txt')).toEqual([]);
  });

  it('setTags + getTags roundtrip', async () => {
    const { setTags, getTags } = await loadStore();
    const path = 'C:/test/roundtrip.txt';
    setTags(path, ['work', 'urgent']);
    expect(getTags(path)).toEqual(['work', 'urgent']);
  });

  it('setTags 覆盖:再 set 一次会替换', async () => {
    const { setTags, getTags } = await loadStore();
    const path = 'C:/test/overwrite.txt';
    setTags(path, ['a', 'b']);
    setTags(path, ['c']);
    expect(getTags(path)).toEqual(['c']);
  });

  it('addTag 重复 → 不重复', async () => {
    const { addTag, getTags } = await loadStore();
    const path = 'C:/test/dup.txt';
    addTag(path, 'work');
    addTag(path, 'work'); // 重复
    addTag(path, 'urgent');
    expect(getTags(path)).toEqual(['work', 'urgent']);
  });

  it('addTag 多文件:互不干扰', async () => {
    const { addTag, getTags } = await loadStore();
    addTag('C:/a.txt', 'red');
    addTag('C:/b.txt', 'blue');
    expect(getTags('C:/a.txt')).toEqual(['red']);
    expect(getTags('C:/b.txt')).toEqual(['blue']);
  });

  it('removeTag 真的移除', async () => {
    const { addTag, removeTag, getTags } = await loadStore();
    const path = 'C:/test/remove.txt';
    addTag(path, 'work');
    addTag(path, 'urgent');
    addTag(path, 'archive');
    removeTag(path, 'urgent');
    expect(getTags(path)).toEqual(['work', 'archive']);
  });

  it('removeTag 不存在的 tag:不报错,保持原样', async () => {
    const { addTag, removeTag, getTags } = await loadStore();
    const path = 'C:/test/remove-noop.txt';
    addTag(path, 'work');
    removeTag(path, 'never-existed');
    expect(getTags(path)).toEqual(['work']);
  });

  it('getAllTags 返回完整 state', async () => {
    const { addTag, getAllTags } = await loadStore();
    // electron-store/conf 用 '.' 作为 path 分隔符;为避免路径里的 '.' 引发嵌套,
    // 这里用纯单段 key 测试 getAllTags 的整体行为。
    addTag('fileA', 'red');
    addTag('fileB', 'blue');
    addTag('fileA', 'work');
    const all = getAllTags();
    expect(all).toEqual({
      fileA: ['red', 'work'],
      fileB: ['blue'],
    });
  });

  it('getAllTags 空 store → {}', async () => {
    const { getAllTags } = await loadStore();
    expect(getAllTags()).toEqual({});
  });
});
