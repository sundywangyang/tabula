/**
 * 标签存储（文件标记）
 *
 * electron-store 持久化，key = 文件路径，value = 标签数组。
 * 设计简洁：path → string[]
 */
import Store from 'electron-store';

interface TagsSchema {
  tags: Record<string, string[]>;
}

let store: Store<TagsSchema> | null = null;

function getStore(): Store<TagsSchema> {
  if (!store) {
    store = new Store<TagsSchema>({ name: 'tabula-tags' });
  }
  return store;
}

export function getTags(path: string): string[] {
  return getAllTags()[path] ?? [];
}

export function setTags(path: string, tags: string[]): void {
  const all = getAllTags();
  if (tags.length) all[path] = [...new Set(tags.filter((tag) => typeof tag === 'string' && tag.trim()))];
  else delete all[path];
  getStore().set('tags', all);
}

export function addTag(path: string, tag: string): void {
  const current = getTags(path);
  if (!current.includes(tag)) {
    setTags(path, [...current, tag]);
  }
}

export function removeTag(path: string, tag: string): void {
  setTags(path, getTags(path).filter((t) => t !== tag));
}

export function getAllTags(): Record<string, string[]> {
  const all: Record<string, string[]> = {};
  // Migrate old dot-path storage while keeping dots in ordinary filenames literal.
  const visit = (value: unknown, prefix: string) => {
    if (Array.isArray(value)) { all[prefix] = value.filter((v): v is string => typeof v === 'string'); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
  };
  visit(getStore().get('tags', {}), '');
  return all;
}

/** Apply all mappings from the same snapshot: cycles and directory descendants are safe. */
export function migrateTags(mappings: Array<{ source: string; destination: string }>, copy = false): void {
  const current = getAllTags();
  const next = { ...current };
  const key = (p: string) => /^[a-z]:|^\\\\/i.test(p) ? p.replace(/\\/g, '/').toLowerCase() : p.replace(/\\/g, '/');
  const updates: Record<string, string[]> = {};
  for (const [path, tags] of Object.entries(current)) {
    const mapping = mappings.find(({ source }) => key(path) === key(source) || key(path).startsWith(key(source).replace(/\/$/, '') + '/'));
    if (!mapping) continue;
    if (!copy) delete next[path];
    updates[mapping.destination + path.slice(mapping.source.length)] = tags;
  }
  getStore().set('tags', { ...next, ...updates });
}
