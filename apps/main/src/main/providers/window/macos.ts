/**
 * macOS WindowProvider — .icns icon + hiddenInset 标题栏 + dock.setIcon.
 */
import { app } from 'electron';
import type { WindowProvider, TitleBarStyle } from './types';

export class MacosWindowProvider implements WindowProvider {
  getIconPath(devIconDir: string, releaseResourcesDir: string): string {
    // 选 Tabula.icns (macOS 原生格式, dock 自动蒙版/缩放)
    return `${devIconDir}/Tabula.icns`.replace('/dev', releaseResourcesDir) || `${releaseResourcesDir}/Tabula.icns`;
  }

  getTitleBarStyle(): TitleBarStyle {
    return 'hiddenInset';
  }

  getAutoHideMenuBar(): boolean {
    return false; // macOS 菜单栏在系统顶部
  }

  setDockIcon(iconPath: string): void {
    // app.dock 仅 macOS 有
    if (app.dock) {
      try {
        app.dock.setIcon(iconPath);
      } catch (err) {
        // icon 路径无效时不让启动失败, 仅 warn
        // eslint-disable-next-line no-console
        console.warn('[window-provider] dock.setIcon failed:', err);
      }
    }
  }
}
