/**
 * 路径栏 (Ctrl+L)
 *
 * 弹出一个输入框,Enter 跳转,Tab 补全,Esc 关闭。
 */
import { useEffect, useRef } from 'react';
import { useFileStore } from '../stores/file-store';
import './PathBar.css';

export function PathBar() {
  const open = useFileStore((s) => s.pathBarOpen);
  const value = useFileStore((s) => s.pathBarValue);
  const error = useFileStore((s) => s.pathBarError);
  const completions = useFileStore((s) => s.pathBarCompletions);
  const setValue = useFileStore((s) => s.setPathBarValue);
  const submit = useFileStore((s) => s.submitPathBar);
  const close = useFileStore((s) => s.closePathBar);
  const complete = useFileStore((s) => s.completePathBar);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // 下一帧 focus,确保 React 渲染完成
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="path-bar-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="path-bar">
        <span className="path-bar-prefix">📍</span>
        <input
          ref={inputRef}
          className="path-bar-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={async (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              await submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            } else if (e.key === 'Tab') {
              e.preventDefault();
              complete();
            }
          }}
          placeholder="输入路径(例如 C:\Users),Tab 补全,Enter 跳转,Esc 取消"
          spellCheck={false}
        />
        {error && <span className="path-bar-error" title={error}>⚠ {error}</span>}
        {completions.length > 0 && !error && (
          <span className="path-bar-hint">候选 {completions.length}</span>
        )}
        <div className="path-bar-actions">
          <button className="path-bar-btn" onClick={close}>取消</button>
          <button className="path-bar-btn path-bar-btn-primary" onClick={() => void submit()}>
            打开
          </button>
        </div>
      </div>
    </div>
  );
}
