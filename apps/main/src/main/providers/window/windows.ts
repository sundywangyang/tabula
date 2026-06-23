/**
 * Windows WindowProvider — .ico icon + hidden 标题栏 + autoHideMenuBar.
 */
import type { WindowProvider, TitleBarStyle } from './types';

export class WindowsWindowProvider implements WindowProvider {
  getIconPath(devIconDir: string, releaseResourcesDir: string): string {
    return `${releaseResourcesDir}/Tabula.ico`;
  }

  getTitleBarStyle(): TitleBarStyle {
    return 'hidden';
  }

  getAutoHideMenuBar(): boolean {
    return true;
  }

  setDockIcon(_iconPath: string): void {
    // Windows 无 dock 概念, no-op
  }

  getQuitOnAllWindowsClosed(): boolean {
    return true;
  }

  getDefaultRootPath(): string {
    return 'C:\\Users';
  }
}
