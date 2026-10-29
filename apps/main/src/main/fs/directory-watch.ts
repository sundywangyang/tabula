import { watch, type FSWatcher } from 'node:fs';

export interface DirectoryWatchEvent { paneId: string; path: string; token: string; error?: string }
type WatchEntry = { token: string; watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> };

/** One watcher per window and pane. Tokens prevent stale cleanup removing a newer watcher. */
export class DirectoryWatchManager {
  private entries = new Map<string, WatchEntry>();
  constructor(private readonly notify: (owner: number, event: DirectoryWatchEvent) => void, private readonly createWatcher = watch) {}

  start(owner: number, paneId: string, path: string, token: string): void {
    if (!paneId || !path || !token) throw new Error('目录监听参数无效');
    const key = `${owner}:${paneId}`;
    this.close(key);
    const event = { paneId, path, token };
    const watcher = this.createWatcher(path, { persistent: false }, () => {
      const entry = this.entries.get(key);
      if (!entry || entry.token !== token) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (this.entries.get(key)?.token === token) this.notify(owner, event);
      }, 200);
    });
    this.entries.set(key, { token, watcher });
    watcher.on('error', (error) => {
      if (this.entries.get(key)?.token !== token) return;
      this.close(key);
      this.notify(owner, { ...event, error: error.message });
    });
  }

  stop(owner: number, paneId: string, token: string): void {
    const key = `${owner}:${paneId}`;
    if (this.entries.get(key)?.token === token) this.close(key);
  }

  stopOwner(owner: number): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${owner}:`)) this.close(key);
  }

  private close(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
  }
}
