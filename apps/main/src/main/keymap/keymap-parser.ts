/**
 * 键组合字符串 <-> KeyCombo 互转工具
 *
 * 与平台无关,被 command-catalog(命令注册)和 platform/*(系统保留键)共用。
 * 独立成文件以避免 platform/ 与 command-catalog 互相依赖(platform 用 parseKeyCombo,
 * command-catalog 调 getPlatform().shortcut.getReservedKeyCombos(),形成 cycle)。
 */
import type { KeyCombo } from '@tabula/bridge';

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  ctl: 'ctrl',
  strg: 'ctrl',
  // Cmd / Meta / Super 都映射到 meta(Windows 上 meta 多被 OS 占用,作为补充信息)
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  windows: 'meta',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  shft: 'shift',
};

/** 把主键 key 名规范化为内部字符串(小写 + 常见别名) */
function normalizeMainKey(raw: string): string | null {
  if (!raw) return null;
  const k = raw.toLowerCase().trim();
  if (!k) return null;
  // 常见命名规范化
  const aliases: Record<string, string> = {
    esc: 'escape',
    return: 'enter',
    ' ': 'space',
    spacebar: 'space',
    arrowup: 'arrowup',
    arrowdown: 'arrowdown',
    arrowleft: 'arrowleft',
    arrowright: 'arrowright',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
    del: 'delete',
    ins: 'insert',
    pgup: 'pageup',
    pgdn: 'pagedown',
    pageup: 'pageup',
    pagedown: 'pagedown',
    'page-up': 'pageup',
    'page-down': 'pagedown',
    '`': '`',
    '~': '~',
  };
  return aliases[k] ?? k;
}

/**
 * 解析 "Ctrl+Shift+P" / "F5" / "Alt+, " 这类字符串为 KeyCombo。
 * 失败返回 null(空字符串 / 纯修饰键 / 多主键都视为无效)。
 */
export function parseKeyCombo(input: string): KeyCombo | null {
  if (!input || typeof input !== 'string') return null;
  const parts = input
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const out: KeyCombo = { key: '', ctrl: false, alt: false, shift: false, meta: false };
  for (const part of parts) {
    const lower = part.toLowerCase();
    const mod = MODIFIER_ALIASES[lower];
    if (mod) {
      out[mod] = true;
      continue;
    }
    // 不是修饰键 → 主键
    if (out.key) {
      // 多个主键:无效
      return null;
    }
    const normalized = normalizeMainKey(part);
    if (!normalized) return null;
    out.key = normalized;
  }

  // 没有主键 / 只有修饰键 → 无效
  if (!out.key) return null;
  // 单字符主键 + shift 时,自动大写避免歧义(让序列化可逆)
  if (out.key.length === 1) {
    out.key = out.shift ? out.key.toUpperCase() : out.key.toLowerCase();
  }
  return out;
}

/** 把 KeyCombo 序列化为可读字符串("Ctrl+Shift+P") */
export function formatKeyCombo(c: KeyCombo | null): string {
  if (!c) return '未绑定';
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Meta');
  // 主键:Shift+字母 展示大写,否则小写
  let main = c.key;
  if (main.length === 1) {
    main = c.shift ? main.toUpperCase() : main.toLowerCase();
  } else {
    // F1~F24 / Enter / Escape / ArrowUp 等保持原样(已规范化为小写)
    main = main.charAt(0).toUpperCase() + main.slice(1);
  }
  parts.push(main);
  return parts.join('+');
}

/** 比较两个 KeyCombo 是否等价 */
export function isSameCombo(a: KeyCombo | null, b: KeyCombo | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta
  );
}
