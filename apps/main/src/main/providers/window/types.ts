/**
 * WindowProvider — 平台特定的窗口/标题栏行为抽象.
 *
 * 集中三处分歧:
 *  - BrowserWindow options: icon (按平台不同格式) / titleBarStyle / autoHideMenuBar
 *  - app.dock.setIcon (仅 macOS, 其他平台 no-op)
 *
 * 工厂按 process.platform 选实现, 调用方拿 WindowProvider 接口.
 */
export type TitleBarStyle = 'hiddenInset' | 'hidden';

export interface WindowProvider {
  /** 解析平台最佳的 icon 路径 (macOS .icns / Windows .ico / 其他 .png) */
  getIconPath(devIconDir: string, releaseResourcesDir: string): string;
  /** 自定义标题栏样式 (macOS 用 hiddenInset 给 traffic lights 留空) */
  getTitleBarStyle(): TitleBarStyle;
  /** 是否隐藏原生菜单栏 (macOS 不隐藏, 菜单栏在系统顶部) */
  getAutoHideMenuBar(): boolean;
  /** 设置 dock icon. 仅 macOS 有意义, 其他平台 no-op. */
  setDockIcon(iconPath: string): void;
}
