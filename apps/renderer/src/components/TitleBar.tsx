/**
 * 自定义标题栏 (macOS 风格)
 *
 * 渲染内容 (最少化):
 *  - macOS: 只留 drag region, 系统 traffic lights 在窗口最左侧自动渲染
 *  - Win/Linux: drag region + 右侧自定义窗口控制按钮 (min/max/close)
 *
 * logo / version / sidebar toggle / settings / DevTools 全部移到 status-bar。
 * 见 StatusBar.tsx。
 */
import { useState, useEffect } from 'react';
import { getCachedPlatform } from '../platform-cache';
import './TitleBar.css';

export function TitleBar() {
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
      <div className="title-bar-drag" />
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
