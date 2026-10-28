import type { Tab } from '@tabula/bridge';

/** Independent of both stores so their initialization does not depend on import order. */
export function makeFolderTab(path: string, title?: string): Tab {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path;
  return {
    id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'folder', path, title: title ?? name, pinned: false, closable: true,
    history: path ? [path] : [], historyIndex: path ? 0 : -1,
  };
}
