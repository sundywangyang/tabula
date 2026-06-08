/**
 * 自定义标题栏
 * P0: 简版,显示 logo + 标题 + 版本号
 * P5: 加主题切换按钮(共享 ThemeToggle 组件)+ 设置按钮
 */
import { ThemeToggle } from './ThemeToggle';
import './TitleBar.css';

interface TitleBarProps {
  version: string;
  onSettingsOpen?: () => void;
}

export function TitleBar({ version, onSettingsOpen }: TitleBarProps) {
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
        <ThemeToggle compact />
        <button className="win-btn" onClick={() => window.tabula.app.openDevTools()} title="DevTools">
          ⌨
        </button>
      </div>
    </div>
  );
}
