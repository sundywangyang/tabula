import type { BreadcrumbSegment } from './types';

export function pathToBreadcrumb(p: string): BreadcrumbSegment[] {
  if (!p) return [];
  const segments: BreadcrumbSegment[] = [];

  const isWindows = /^[a-zA-Z]:[\\/]?/.test(p);
  const isPosixAbs = p.startsWith('/');

  if (isWindows) {
    // Windows: C:\Users\foo
    const parts = p.split(/[\\/]/).filter(Boolean);
    const drive = parts.shift()!;
    let acc = drive + '\\';
    segments.push({ name: drive, path: acc });
    for (const part of parts) {
      acc = acc + '\\' + part;
      segments.push({ name: part, path: acc });
    }
    return segments;
  }

  if (isPosixAbs) {
    // POSIX: /Users/fafa
    // 根目录 `/` 作为一个独立段
    if (p === '/') {
      segments.push({ name: '/', path: '/' });
      return segments;
    }
    segments.push({ name: '/', path: '/' });
    const parts = p.slice(1).split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc = acc + '/' + part;
      segments.push({ name: part, path: acc });
    }
    return segments;
  }

  // 相对路径(兜底,理论上不该出现)
  const parts = p.split(/[\\/]/).filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? acc + '/' + part : part;
    segments.push({ name: part, path: acc });
  }
  return segments;
}

export function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  const sep = parent.includes('\\') ? '\\' : '/';
  if (parent.endsWith('\\') || parent.endsWith('/')) return parent + name;
  return parent + sep + name;
}

export function parentPath(p: string): string {
  if (!p) return '';
  if (/^[a-zA-Z]:[\\/]?$/.test(p)) return '';
  const m = p.match(/^(.*)[\\/]([^\\/]+)[\\/]?$/);
  if (m) {
    const parent = m[1];
    if (/^[a-zA-Z]:$/.test(parent)) return parent + '\\';
    return parent;
  }
  return '';
}

export function basename(p: string): string {
  if (!p) return '';
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : '';
}

/** 工具: 在 layout 树里查找 pane 节点 */
export function findPaneInLayout(
  node: import('@tabula/bridge').LayoutNode,
  paneId: string,
): import('@tabula/bridge').LayoutNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  for (const child of node.children) {
    const result = findPaneInLayout(child, paneId);
    if (result) return result;
  }
  return null;
}
