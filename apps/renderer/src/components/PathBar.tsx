import { useEffect, useRef, useState } from 'react';
import { Folder, History, X } from 'lucide-react';
import { useFavoritesStore } from '../stores/favorites-store';
import { useFileStore } from '../stores/file-store';
import './NewTabDialog.css';

export function PathBar() {
  const open = useFileStore((s) => s.pathBarOpen);
  const value = useFileStore((s) => s.pathBarValue);
  const error = useFileStore((s) => s.pathBarError);
  const completions = useFileStore((s) => s.pathBarCompletions);
  const setValue = useFileStore((s) => s.setPathBarValue);
  const submit = useFileStore((s) => s.submitPathBar);
  const close = useFileStore((s) => s.closePathBar);
  const complete = useFileStore((s) => s.completePathBar);
  const history = useFavoritesStore((s) => s.history);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    const frame = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return () => { cancelAnimationFrame(frame); requestRef.current++; };
  }, [open]);

  if (!open) return null;

  const openPath = async (path: string) => {
    if (busy || !path.trim()) return;
    const request = ++requestRef.current;
    if (path !== value) setValue(path);
    setBusy(true);
    try {
      await submit();
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  };

  return (
    <div className="new-tab-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="new-tab-dialog" role="dialog" aria-modal="true" aria-labelledby="path-bar-title"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
        <div className="new-tab-heading">
          <div><h2 id="path-bar-title">转到路径</h2><p>输入目录路径，或从最近访问中选择。</p></div>
          <button className="new-tab-close" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void openPath(value); }}>
          <label htmlFor="path-bar-path">目录路径</label>
          <div className="new-tab-input-wrap">
            <Folder size={16} aria-hidden="true" />
            <input id="path-bar-path" ref={inputRef} value={value} disabled={busy} placeholder="例如 C:\Users\admin\Documents"
              onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); complete(); }
              }} spellCheck={false} autoComplete="off" />
          </div>
          {error && <div className="new-tab-error" role="alert">{error}</div>}
          {completions.length > 0 && !error && <div className="path-bar-completions">候选 {completions.length} 项</div>}
          <div className="new-tab-history-heading"><History size={14} /> 最近访问</div>
          <div className="new-tab-history" aria-label="历史路径">
            {history.length ? history.map((item) => (
              <button type="button" key={item.path} className="new-tab-history-item" disabled={busy}
                title={item.path} onClick={() => void openPath(item.path)}>
                <Folder size={15} aria-hidden="true" /><span>{item.path}</span>
              </button>
            )) : <div className="new-tab-empty">暂无历史路径</div>}
          </div>
          <div className="new-tab-actions">
            <button type="button" className="new-tab-button" onClick={close}>取消</button>
            <button type="submit" className="new-tab-button primary" disabled={busy || !value.trim()}>{busy ? '正在打开…' : '打开'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
