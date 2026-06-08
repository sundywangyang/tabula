/**
 * 路径处理工具
 */
import { sep } from 'node:path';

/**
 * 是否是 Windows 绝对路径
 */
export function isAbsolute(p: string): boolean {
  if (!p) return false;
  if (sep === '\\') {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
  }
  return p.startsWith('/');
}

/**
 * 规范化路径(P0 占位,后续 P1 用 normalize-path 库)
 */
export function normalize(p: string): string {
  if (!p) return p;
  return p.replace(/[\\/]+/g, sep).replace(/[\\/]$/, '');
}

/**
 * 路径拼接
 */
export function join(...parts: string[]): string {
  return parts.filter(Boolean).join(sep);
}

/**
 * 取扩展名(包含点,小写)
 */
export function extname(name: string): string {
  const i = name.lastIndexOf('.');
  if (i < 0 || i === 0) return '';
  return name.slice(i).toLowerCase();
}

/**
 * 取文件名
 */
export function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, '');
  const i = norm.lastIndexOf(sep);
  return i < 0 ? norm : norm.slice(i + 1);
}

/**
 * 取目录名
 */
export function dirname(p: string): string {
  const norm = p.replace(/[\\/]+$/, '');
  const i = norm.lastIndexOf(sep);
  if (i < 0) return '.';
  if (i === 0) return sep;
  return norm.slice(0, i);
}
