/**
 * 跨进程平台检测工具
 * 主进程: process.platform (win32/darwin/linux)
 * 渲染进程: navigator.platform
 */

/**
 * 主进程调用（仅限 main process）
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isMac(): boolean {
  return process.platform === 'darwin';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

export function getPlatform(): 'windows' | 'macos' | 'linux' {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

/**
 * 渲染进程调用（通过 preload 暴露）
 */
export function isRendererWindows(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
}

export function isRendererMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
}

export function isRendererLinux(): boolean {
  return typeof navigator !== 'undefined' && !navigator.platform.toLowerCase().includes('win')
    && !navigator.platform.toLowerCase().includes('mac');
}

export function getRendererPlatform(): 'windows' | 'macos' | 'linux' {
  if (typeof navigator === 'undefined') return 'macos'; // 默认值
  if (navigator.platform.toLowerCase().includes('win')) return 'windows';
  if (navigator.platform.toLowerCase().includes('mac')) return 'macos';
  return 'linux';
}

/**
 * 默认根路径
 * Windows: C:\Users\<user>
 * Unix: /
 */
export function defaultRootPath(): string {
  if (isMac() || isLinux()) return '/';
  // Windows
  return 'C:\\Users';
}

/**
 * 渲染进程默认根路径
 */
export function rendererDefaultRootPath(): string {
  if (typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')) {
    return 'C:\\Users';
  }
  return '/';
}

/**
 * 路径分隔符
 */
export function pathSep(): '\\' | '/' {
  if (isMac() || isLinux()) return '/';
  return '\\';
}
