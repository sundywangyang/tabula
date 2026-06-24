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
  return getStore().get(`tags.${path}`, []);
}

export function setTags(path: string, tags: string[]): void {
  getStore().set(`tags.${path}`, tags);
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
  return getStore().get('tags', {});
}
