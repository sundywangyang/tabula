import { useEffect, useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import type { FsEntry } from '@tabula/bridge';

export function SidebarTree({ path, currentPath, onOpenPath, onDragOver, onDrop, depth = 0 }: {
  path: string; currentPath: string; onOpenPath: (path: string) => void; depth?: number;
  onDragOver?: (event: React.DragEvent<HTMLElement>, path: string) => void;
  onDrop?: (event: React.DragEvent<HTMLElement>, path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError('');
    void window.tabula.fs.listDir(path).then(result => {
      if (!active) return;
      if (result.ok) setChildren(result.data.entries.filter(entry => entry.isDirectory && !entry.isSymlink && !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
      else setError(result.error.message);
    }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, path]);
  return <>
    <button className="sidebar-tree-toggle" aria-label={`${open ? '收起' : '展开'}目录 ${path}`} aria-expanded={open}
      onClick={event => { event.stopPropagation(); setOpen(value => !value); }}><ChevronRight size={13} className={open ? 'sidebar-tree-open' : ''} /></button>
    {open && <div className="sidebar-tree-children" onClick={event => event.stopPropagation()} onDragOver={event => event.stopPropagation()} onDrop={event => event.stopPropagation()}>
      {loading && <div className="sidebar-empty">正在加载…</div>}
      {error && <div className="sidebar-empty" title={error}>无法读取目录：{error}</div>}
      {!loading && !error && children.length === 0 && <div className="sidebar-empty">没有子文件夹</div>}
      {children.map(child => <div className="sidebar-tree-branch" key={child.path}>
        <div className={`sidebar-item sidebar-tree-item ${currentPath === child.path ? 'active' : ''}`}
          onDragOver={event => { event.stopPropagation(); onDragOver?.(event, child.path); }}
          onDrop={event => { event.stopPropagation(); onDrop?.(event, child.path); }}>
          {depth < 15 && <SidebarTree path={child.path} currentPath={currentPath} onOpenPath={onOpenPath} onDragOver={onDragOver} onDrop={onDrop} depth={depth + 1} />}
          <button className="sidebar-tree-label" onClick={() => onOpenPath(child.path)} title={child.path}><Folder size={13} /><span>{child.name}</span></button>
        </div>
      </div>)}
    </div>}
  </>;
}
