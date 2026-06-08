/**
 * 自定义标题栏
 */
import { useState, useEffect } from 'react';
import './TitleBar.css';

interface TitleBarProps {
  version: string;
  onSettingsOpen?: () => void;
}

export function TitleBar({ version, onSettingsOpen }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.tabula.windows.isMaximized().then(setIsMaximized);
    const handleMaximize = () => setIsMaximized(true);
    const handleUnmaximize = () => setIsMaximized(false);
    window.addEventListener('maximize', handleMaximize);
    window.addEventListener('unmaximize', handleUnmaximize);
    return () => {
      window.removeEventListener('maximize', handleMaximize);
      window.removeEventListener('unmaximize', handleUnmaximize);
    };
  }, []);

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <div className="title-bar-logo">
          <span className="logo-mark">▣</span>
          <span className="logo-text">Tabula</span>
          {version && <span className="logo-version">v{version}</span>}
        </div>
      </div>

      <div className="title-bar-actions">
        <button
          className="win-btn"
          onClick={onSettingsOpen}
          title="设置 (Ctrl+,)"
        >
          ⚙
        </button>
        <button className="win-btn" onClick={() => window.tabula.app.openDevTools()} title="DevTools">
          ⌨
        </button>

        {/* 窗口控制按钮 — 在 actions 右侧 */}
      </div>
      <div className="title-bar-window-controls">
        <button
          className="win-ctrl-btn win-ctrl-minimize"
          onClick={() => window.tabula.windows.minimize()}
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          className="win-ctrl-btn win-ctrl-maximize"
          onClick={async () => {
            await window.tabula.windows.maximize();
            setIsMaximized(await window.tabula.windows.isMaximized());
          }}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="8" height="8" />
              <rect x="0" y="2" width="8" height="8" fill="var(--bg-elevated)" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0" y="0" width="10" height="10" />
            </svg>
          )}
        </button>
        <button
          className="win-ctrl-btn win-ctrl-close"
          onClick={() => window.tabula.windows.closeCurrent()}
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
