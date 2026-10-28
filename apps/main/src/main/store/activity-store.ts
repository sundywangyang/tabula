import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { FileActivity } from '@tabula/bridge';
let storage: Store<{ events: FileActivity[] }> | undefined;
const store = (): Store<{ events: FileActivity[] }> => storage ??= new Store<{ events: FileActivity[] }>({ name: 'tabula-activity', defaults: { events: [] } });
export function recordActivity(event: Omit<FileActivity, 'id' | 'timestamp'>): void {
  store().set('events', [{ ...event, id: randomUUID(), timestamp: Date.now() }, ...store().get('events', [])].slice(0, 5000));
}
export function listActivity(path?: string, limit = 300): FileActivity[] {
  const normalize = (p: string) => { const normalized = p.replace(/\\/g, '/').replace(/\/$/, ''); return process.platform === 'win32' ? normalized.toLowerCase() : normalized; };
  const wanted = path ? normalize(path) : '';
  return store().get('events', []).filter(e => !wanted || [...e.paths, ...(e.destinations ?? [])]
    .some(p => normalize(p) === wanted || normalize(p).startsWith(wanted + '/'))).slice(0, Math.max(1, Math.min(5000, limit)));
}
