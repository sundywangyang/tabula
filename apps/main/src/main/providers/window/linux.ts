/**
 * Linux WindowProvider — .png icon + hidden 标题栏 + autoHideMenuBar.
 */
import type { WindowProvider, TitleBarStyle } from './types';

export class LinuxWindowProvider implements WindowProvider {
  getIconPath(devIconDir: string, releaseResourcesDir: string): string {
    // Linux 用 512.png (electron 自动适配)
    return `${releaseResourcesDir}/512.png`;
  }

  getTitleBarStyle(): TitleBarStyle {
    return 'hidden';
  }

  getAutoHideMenuBar(): boolean {
    return true;
  }

  setDockIcon(_iconPath: string): void {
    // Linux 无 dock 概念, no-op
  }
}
