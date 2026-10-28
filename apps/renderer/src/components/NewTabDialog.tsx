import { useEffect, useRef, useState } from 'react';
import { Folder, History, X } from 'lucide-react';
import type { LayoutNode } from '@tabula/bridge';
import { useFavoritesStore } from '../stores/favorites-store';
import { makeFolderTab } from '../stores/folder-tab';
import { useLayoutStore } from '../stores/layout-store';
import { useUiDialogsStore } from '../stores/ui-dialogs-store';
import './NewTabDialog.css';

function hasPane(node: LayoutNode, paneId: string): boolean {
  return node.type === 'pane' ? node.id === paneId : node.children.some((child) => hasPane(child, paneId));
}

export function NewTabDialog() {
  const paneId = useUiDialogsStore((s) => s.newTabPaneId);
  const setPaneId = useUiDialogsStore((s) => s.setNewTabPaneId);
  const history = useFavoritesStore((s) => s.history);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!paneId) return;
    setPath('');
    setError('');
    setBusy(false);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => { cancelAnimationFrame(frame); requestRef.current++; };
  }, [paneId]);

  if (!paneId) return null;

  const close = () => {
    requestRef.current++;
    setPaneId(null);
  };

  const openPath = async (value: string) => {
    const target = value.trim();
    if (!target || busy) return;
    const request = ++requestRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.tabula.fs.listDir(target);
      if (request !== requestRef.current || useUiDialogsStore.getState().newTabPaneId !== paneId) return;
      if (!result.ok) {
        setError(result.error.message || '无法打开此目录');
        return;
      }
      const layout = useLayoutStore.getState();
      if (!hasPane(layout.rootLayout, paneId)) {
        setError('目标窗格已关闭，请重新打开新建标签页');
        return;
      }
      // 先建立空标签再导航，允许同一目录在新标签中再次打开。
      layout.pane.openTab(paneId, makeFolderTab('', '新标签'));
      void useLayoutStore.getState().pane.navigate(paneId, target);
      close();
    } catch (reason) {
      if (request === requestRef.current) setError(reason instanceof Error ? reason.message : '无法打开此目录');
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  };

  return (
    <div className="new-tab-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="new-tab-dialog" role="dialog" aria-modal="true" aria-labelledby="new-tab-title"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
        <div className="new-tab-heading">
          <div><h2 id="new-tab-title">新建标签页</h2><p>输入目录路径，或从最近访问中选择。</p></div>
          <button className="new-tab-close" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void openPath(path); }}>
          <label htmlFor="new-tab-path">目录路径</label>
          <div className="new-tab-input-wrap">
            <Folder size={16} aria-hidden="true" />
            <input id="new-tab-path" ref={inputRef} value={path} disabled={busy} placeholder="例如 C:\Users\admin\Documents"
              onChange={(e) => { setPath(e.target.value); setError(''); }} spellCheck={false} autoComplete="off" />
          </div>
          {error && <div className="new-tab-error" role="alert">{error}</div>}
          <div className="new-tab-history-heading"><History size={14} /> 最近访问</div>
          <div className="new-tab-history" aria-label="历史路径">
            {history.length ? history.map((item) => (
              <button type="button" key={item.path} className="new-tab-history-item" disabled={busy}
                title={item.path} onClick={() => { setPath(item.path); void openPath(item.path); }}>
                <Folder size={15} aria-hidden="true" /><span>{item.path}</span>
              </button>
            )) : <div className="new-tab-empty">暂无历史路径</div>}
          </div>
          <div className="new-tab-actions">
            <button type="button" className="new-tab-button" onClick={close}>取消</button>
            <button type="submit" className="new-tab-button primary" disabled={busy || !path.trim()}>{busy ? '正在打开…' : '打开标签页'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
