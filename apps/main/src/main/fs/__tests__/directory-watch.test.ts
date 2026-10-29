import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectoryWatchManager } from '../directory-watch';
import { watch } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(() => { vi.useRealTimers(); });

describe('directory watch subscriptions', () => {
  it('observes an actual external file change', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tabula-watch-'));
    let manager: DirectoryWatchManager | undefined;
    try {
      const changed = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('目录变化事件超时')), 5000);
        manager = new DirectoryWatchManager((_owner, event) => { clearTimeout(timeout); resolve(event); });
        manager.start(1, 'p', folder, 'live');
      });
      await writeFile(join(folder, '测试.txt'), 'test');
      await expect(changed).resolves.toMatchObject({ paneId: 'p', path: folder, token: 'live' });
    } finally {
      manager?.stopOwner(1);
      await rm(folder, { recursive: true, force: true });
    }
  });
  it('debounces changes and ignores old cleanup when a pane changes directories', () => {
    vi.useFakeTimers();
    const listeners: Array<() => void> = [];
    const watchers: Array<EventEmitter & { close: ReturnType<typeof vi.fn> }> = [];
    const create = vi.fn((_path, _options, callback) => {
      listeners.push(callback);
      const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      watchers.push(watcher);
      return watcher;
    }) as unknown as typeof watch;
    const notify = vi.fn();
    const manager = new DirectoryWatchManager(notify, create);
    manager.start(1, 'p', 'A', 'old');
    listeners[0](); listeners[0]();
    manager.start(1, 'p', 'B', 'new');
    manager.stop(1, 'p', 'old');
    listeners[0](); listeners[1](); listeners[1]();
    vi.advanceTimersByTime(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(1, { paneId: 'p', path: 'B', token: 'new' });
    expect(watchers[0].close).toHaveBeenCalledOnce();
    manager.stopOwner(1);
    expect(watchers[1].close).toHaveBeenCalledOnce();
  });

  it('reports watcher failures and releases the subscription', () => {
    const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
    const notify = vi.fn();
    const manager = new DirectoryWatchManager(notify, (() => watcher) as unknown as typeof watch);
    manager.start(1, 'p', 'A', 'token');
    watcher.emit('error', new Error('unavailable'));
    expect(watcher.close).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(1, { paneId: 'p', path: 'A', token: 'token', error: 'unavailable' });
  });
});
