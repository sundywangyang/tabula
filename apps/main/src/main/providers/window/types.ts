/**
 * WindowProvider — 平台特定的窗口/标题栏/应用生命周期行为抽象.
 *
 * 集中的分歧:
 *  - BrowserWindow options: icon (按平台不同格式) / titleBarStyle / autoHideMenuBar
 *  - app.dock.setIcon (仅 macOS, 其他平台 no-op)
 *  - quitOnAllWindowsClosed:macOS = false(关窗后 Dock 还在,习惯 Cmd+Q 才退)
 *  - defaultRootPath:Windows = C:\Users, macOS/Linux = /(用户家目录)
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
  /** 所有窗口关闭后是否退出应用 (macOS = false) */
  getQuitOnAllWindowsClosed(): boolean;
  /** 默认根路径 (用户家目录): Windows C:\Users, macOS/Linux / */
  getDefaultRootPath(): string;
}
