/**
 * macOS WindowProvider — .icns icon + hiddenInset 标题栏 + dock.setIcon.
 */
import { app, nativeImage } from 'electron';
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
    if (!app.dock) return;
    try {
      // app.dock.setIcon 在 macOS 上对 .icns 路径有兼容问题, 用 nativeImage.createFromPath
      // 先把 .icns 解析成 NativeImage, 再 setIcon(NativeImage). 这种方式跨版本稳定.
      const image = nativeImage.createFromPath(iconPath);
      if (image.isEmpty()) {
        // eslint-disable-next-line no-console
        console.warn('[window-provider] dock.setIcon: image is empty, path=', iconPath);
        return;
      }
      app.dock.setIcon(image);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[window-provider] dock.setIcon failed:', err);
    }
  }

  getQuitOnAllWindowsClosed(): boolean {
    return false; // macOS 习惯:Cmd+Q 才退出,关窗不退
  }

  getDefaultRootPath(): string {
    return '/';
  }
}
