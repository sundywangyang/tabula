/**
 * 自定义标题栏
 *
 * macOS:  系统 traffic lights (红/黄/绿) 在窗口最左侧。
 *         隐藏右侧自定义窗口控制按钮,给 traffic lights 留 80px 空间。
 *         logo/version/sidebar-toggle 整体右移避开 traffic lights。
 * Windows / Linux: 保留右侧最小化/最大化/关闭按钮。
 */
import { useState, useEffect } from 'react';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { getCachedPlatform } from '../platform-cache';
import './TitleBar.css';

interface TitleBarProps {
  version: string;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onSettingsOpen?: () => void;
}

export function TitleBar({ version, sidebarVisible, onToggleSidebar, onSettingsOpen }: TitleBarProps) {
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
        <div className="title-bar-logo">
          <span className="logo-mark">▣</span>
          <span className="logo-text">Tabula</span>
          {version && <span className="logo-version">v{version}</span>}
        </div>
        <Tooltip label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}>
          <button
            type="button"
            className="title-bar-btn title-bar-sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
          >
            {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
          </button>
        </Tooltip>
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

        {/* 自定义窗口控制按钮 — 仅在非 macOS 平台显示 */}
      </div>
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
