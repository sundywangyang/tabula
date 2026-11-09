/** Platform window controls and global navigation in a draggable title bar. */
import { useState, useEffect } from 'react';
import { PanelLeft, Settings, PanelsTopLeft } from 'lucide-react';
import { getCachedPlatform } from '../platform-cache';
import './TitleBar.css';

export function TitleBar({ sidebarVisible, onToggleSidebar, onSettingsOpen }: {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onSettingsOpen: () => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const isMac = getCachedPlatform() === 'macos';

  useEffect(() => {
    // 非 macOS 才需要追踪 maximize 状态(自定义最大化按钮)
    if (isMac) return;
    window.tabula.windows.isMaximized().then(setIsMaximized);
    const handleMaximize = () => setIsMaximized(true);
    const handleUnmaximize = () => setIsMaximized(false);
    window.addEventListener('maximize', handleMaximize);
    window.addEventListener('unmaximize', handleUnmaximize);
    return () => {
      window.removeEventListener('maximize', handleMaximize);
      window.removeEventListener('unmaximize', handleUnmaximize);
    };
  }, [isMac]);

  return (
    <div className={`title-bar ${isMac ? 'is-mac' : 'is-win'}`}>
      <div className="title-bar-drag">
        <button className="title-bar-action" onClick={onToggleSidebar}
          title={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
          aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} aria-pressed={sidebarVisible}>
          <PanelLeft size={17} strokeWidth={1.7} />
        </button>
        <span className="title-bar-brand"><PanelsTopLeft size={15} strokeWidth={1.7} /> Tabula</span>
      </div>
      <button className="title-bar-action title-bar-settings" onClick={onSettingsOpen} title="设置" aria-label="设置">
        <Settings size={16} strokeWidth={1.7} />
      </button>
      {!isMac && (
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
      )}
    </div>
  );
}
