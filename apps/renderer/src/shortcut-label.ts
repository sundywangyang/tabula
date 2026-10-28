import type { KeyCombo, PlatformType } from '@tabula/bridge';

/** 使用与快捷键执行相同的平台主修饰键规则。 */
export function shortcutLabel(combo: KeyCombo | null | undefined, platform: PlatformType): string | null {
  if (!combo) return null;
  const parts: string[] = [];
  if (combo.ctrl) parts.push(platform === 'macos' && !combo.meta ? 'Cmd' : 'Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push(platform === 'macos' ? 'Cmd' : 'Meta');
  const names: Record<string, string> = {
    arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
    escape: 'Esc', delete: 'Delete', space: 'Space', ' ': 'Space',
    enter: 'Enter', tab: 'Tab', pageup: 'PageUp', pagedown: 'PageDown',
  };
  const key = combo.key;
  parts.push(names[key.toLowerCase()] ?? (key.length === 1 || /^f\d+$/i.test(key) ? key.toUpperCase() : key));
  return parts.join('+');
}
