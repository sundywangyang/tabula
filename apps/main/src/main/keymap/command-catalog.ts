/**
 * 快捷键命令注册表 + 键组合序列化工具 (P7 v1)
 *
 * 这里集中定义所有 Tabula 内置可自定义命令 + 默认绑定。
 * 每个命令一个唯一 id(如 `file.open`),通过 `category` 在设置页分组。
 *
 * 字符串键组合格式:
 *   Ctrl+Shift+P / Alt+Enter / F5 / Delete / Cmd+Q / Meta+,
 *   主键在前或在后都可;修饰键不分大小写。
 *   多组合不支持(一个命令最多一个组合)。
 *
 * 系统保留组合(不可被任何命令占用):
 *   Cmd+Q (退出) / Alt+F4 (关闭) / Ctrl+Alt+Delete / Cmd+Tab / Alt+Tab
 *   以及修饰键自身(只按 Ctrl / Alt / Shift 不构成组合)
 */
import type { CommandSpec, KeyCombo } from '@tabula/bridge';

// =================== 字符串 <-> KeyCombo 互转 ===================

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

// =================== 系统保留组合 ===================

/**
 * 系统保留组合(任何用户命令都不能占用)。这些组合是 OS / 桌面 / 浏览器保留的,
 * 重新绑定会破坏用户预期(例如 Cmd+Q 退出应用)。
 */
const RESERVED_COMBOS: KeyCombo[] = [
  // 退出 / 关闭
  parseKeyCombo('Meta+Q')!,       // macOS 退出
  parseKeyCombo('Alt+F4')!,       // Win/Linux 关闭
  parseKeyCombo('Ctrl+W') ? { ...parseKeyCombo('Ctrl+W')!, key: 'w' } : ({} as KeyCombo), // (示例:不过滤,看下面)
  // 切窗口 / 切应用
  parseKeyCombo('Meta+Tab')!,
  parseKeyCombo('Alt+Tab')!,
  parseKeyCombo('Ctrl+Alt+Delete')!,
  parseKeyCombo('Meta+Escape')!,
  // 锁屏 / 关机
  parseKeyCombo('Ctrl+Alt+Delete')!,
  parseKeyCombo('Meta+L')!,        // 锁屏(macOS)
  parseKeyCombo('Ctrl+Alt+L')!,   // 锁屏(Linux/Win 一些桌面)
].filter((c, idx, arr) => c && arr.findIndex((x) => isSameCombo(x, c)) === idx);

/** 显式保留清单 — 上面那段我们不屏蔽 Ctrl+W(浏览器那种"关闭标签"语义本身正是我们要做的),做白名单更稳 */
const HARD_RESERVED: KeyCombo[] = [
  parseKeyCombo('Meta+Q')!,
  parseKeyCombo('Alt+F4')!,
  parseKeyCombo('Meta+Tab')!,
  parseKeyCombo('Alt+Tab')!,
  parseKeyCombo('Ctrl+Alt+Delete')!,
  parseKeyCombo('Meta+Escape')!,
  parseKeyCombo('Meta+L')!,
  parseKeyCombo('Ctrl+Alt+L')!,
  parseKeyCombo('Meta+M')!,   // macOS 最小化窗口
  parseKeyCombo('Meta+H')!,   // macOS 隐藏窗口
  parseKeyCombo('Meta+Space')!, // macOS Spotlight
];

/** 判定某个组合是否被系统保留(任何用户命令都不能占用) */
export function isReservedCombo(combo: KeyCombo | null): boolean {
  if (!combo) return false;
  return HARD_RESERVED.some((c) => isSameCombo(c, combo));
}

// =================== 内置命令清单 ===================

/**
 * 命令清单(主进程内置,不可由用户增删)。
 * id 命名: `<area>.<verb>`(dot.separated)
 * 至少 10 个;本清单 18 个。
 */
export const COMMAND_CATALOG: CommandSpec[] = [
  // 文件
  {
    id: 'file.refresh',
    title: '刷新当前目录',
    category: '文件',
    defaultCombo: parseKeyCombo('F5'),
    description: '重新读取当前 active pane 的目录列表',
    reserved: false,
  },
  {
    id: 'file.open',
    title: '打开选中项',
    category: '文件',
    defaultCombo: parseKeyCombo('Enter'),
    description: '打开当前光标或选中的文件 / 文件夹',
    reserved: false,
  },
  {
    id: 'file.delete',
    title: '删除到回收站',
    category: '文件',
    defaultCombo: parseKeyCombo('Delete'),
    description: '将选中的项移到回收站',
    reserved: false,
  },
  {
    id: 'file.delete-permanent',
    title: '永久删除',
    category: '文件',
    defaultCombo: parseKeyCombo('Shift+Delete'),
    description: '跳过回收站直接删除(需确认)',
    reserved: false,
  },
  {
    id: 'file.rename',
    title: '重命名',
    category: '文件',
    defaultCombo: parseKeyCombo('F2'),
    description: '对当前光标项进入重命名',
    reserved: false,
  },
  {
    id: 'file.new-folder',
    title: '新建文件夹',
    category: '文件',
    defaultCombo: parseKeyCombo('Ctrl+N'),
    description: '在当前目录新建文件夹',
    reserved: false,
  },
  {
    id: 'file.copy',
    title: '复制',
    category: '文件',
    defaultCombo: parseKeyCombo('Ctrl+C'),
    description: '将选中的项复制到剪贴板',
    reserved: false,
  },
  {
    id: 'file.cut',
    title: '剪切',
    category: '文件',
    defaultCombo: parseKeyCombo('Ctrl+X'),
    description: '将选中的项剪切到剪贴板',
    reserved: false,
  },
  {
    id: 'file.paste',
    title: '粘贴',
    category: '文件',
    defaultCombo: parseKeyCombo('Ctrl+V'),
    description: '把剪贴板内容粘贴到当前目录',
    reserved: false,
  },
  {
    id: 'file.duplicate',
    title: '复制到同级目录',
    category: '文件',
    defaultCombo: parseKeyCombo('Ctrl+D'),
    description: '把选中项复制到所在目录的同级(duplicate)',
    reserved: false,
  },
  {
    id: 'file.select-all',
    title: '全选',
    category: '文件',
    defaultCombo: parseKeyCombo('Ctrl+A'),
    description: '选中当前目录所有项',
    reserved: false,
  },
  {
    id: 'file.path-bar',
    title: '编辑地址栏',
    category: '文件',
    defaultCombo: parseKeyCombo('Ctrl+L'),
    description: '打开 / 聚焦地址栏输入',
    reserved: false,
  },
  // 标签
  {
    id: 'tab.new',
    title: '新建标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+T'),
    description: '在当前 pane 新开一个标签',
    reserved: false,
  },
  {
    id: 'tab.close',
    title: '关闭标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+W'),
    description: '关闭当前 pane 的 active tab',
    reserved: false,
  },
  {
    id: 'tab.next',
    title: '下一个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+Tab'),
    description: '在当前 pane 中循环切到下一个 tab',
    reserved: false,
  },
  {
    id: 'tab.prev',
    title: '上一个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+Shift+Tab'),
    description: '在当前 pane 中循环切到上一个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-1',
    title: '切换到第 1 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+1'),
    description: '激活当前 pane 的第 1 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-2',
    title: '切换到第 2 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+2'),
    description: '激活当前 pane 的第 2 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-3',
    title: '切换到第 3 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+3'),
    description: '激活当前 pane 的第 3 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-4',
    title: '切换到第 4 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+4'),
    description: '激活当前 pane 的第 4 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-5',
    title: '切换到第 5 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+5'),
    description: '激活当前 pane 的第 5 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-6',
    title: '切换到第 6 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+6'),
    description: '激活当前 pane 的第 6 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-7',
    title: '切换到第 7 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+7'),
    description: '激活当前 pane 的第 7 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-8',
    title: '切换到第 8 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+8'),
    description: '激活当前 pane 的第 8 个 tab',
    reserved: false,
  },
  {
    id: 'tab.switch-to-9',
    title: '切换到第 9 个标签',
    category: '标签',
    defaultCombo: parseKeyCombo('Ctrl+9'),
    description: '激活当前 pane 的第 9 个 tab',
    reserved: false,
  },
  // 窗格
  {
    id: 'pane.split-horizontal',
    title: '横向拆分窗格',
    category: '窗格',
    defaultCombo: parseKeyCombo('Ctrl+\\'),
    description: '把当前 pane 横向(左右)拆为两个',
    reserved: false,
  },
  {
    id: 'pane.split-vertical',
    title: '纵向拆分窗格',
    category: '窗格',
    defaultCombo: parseKeyCombo('Ctrl+Shift+\\'),
    description: '把当前 pane 纵向(上下)拆为两个',
    reserved: false,
  },
  {
    id: 'pane.focus-left',
    title: '焦点 pane:左',
    category: '窗格',
    defaultCombo: parseKeyCombo('Ctrl+Alt+ArrowLeft'),
    description: '焦点切到左侧 pane',
    reserved: false,
  },
  {
    id: 'pane.focus-right',
    title: '焦点 pane:右',
    category: '窗格',
    defaultCombo: parseKeyCombo('Ctrl+Alt+ArrowRight'),
    description: '焦点切到右侧 pane',
    reserved: false,
  },
  {
    id: 'pane.resize-left',
    title: '窗格缩小(向左)',
    category: '窗格',
    defaultCombo: parseKeyCombo('Alt+ArrowLeft'),
    description: '把焦点 pane 所在 split 的相邻左/上 child 变小 20px',
    reserved: false,
  },
  {
    id: 'pane.resize-right',
    title: '窗格扩大(向右)',
    category: '窗格',
    defaultCombo: parseKeyCombo('Alt+ArrowRight'),
    description: '把焦点 pane 所在 split 的相邻左/上 child 变大 20px(右/下随之变窄)',
    reserved: false,
  },
  {
    id: 'pane.resize-up',
    title: '窗格缩小(向上)',
    category: '窗格',
    defaultCombo: parseKeyCombo('Alt+ArrowUp'),
    description: '纵向 split:让上方 child 变小 20px',
    reserved: false,
  },
  {
    id: 'pane.resize-down',
    title: '窗格扩大(向下)',
    category: '窗格',
    defaultCombo: parseKeyCombo('Alt+ArrowDown'),
    description: '纵向 split:让上方 child 变大 20px(下方随之变窄)',
    reserved: false,
  },
  {
    id: 'pane.close',
    title: '关闭当前窗格',
    category: '窗格',
    defaultCombo: parseKeyCombo('Ctrl+Alt+Shift+\\'),
    description: '把当前 pane 合并到兄弟 pane 后关闭(最后一个 pane 不响应)',
    reserved: false,
  },
  // 视图 / 搜索
  {
    id: 'search.global',
    title: '全局模糊搜索',
    category: '视图',
    defaultCombo: parseKeyCombo('Ctrl+P'),
    description: '打开跨目录的全局文件名搜索',
    reserved: false,
  },
  {
    id: 'search.focus',
    title: '当前目录搜索',
    category: '视图',
    defaultCombo: parseKeyCombo('Ctrl+F'),
    description: '在当前目录的文件名过滤框聚焦',
    reserved: false,
  },
  {
    id: 'preview.toggle',
    title: '切换预览',
    category: '视图',
    defaultCombo: parseKeyCombo('Space'),
    description: '打开 / 关闭当前选中项的 QuickLook 预览',
    reserved: false,
  },
  {
    id: 'theme.toggle',
    title: '切换主题',
    category: '视图',
    defaultCombo: parseKeyCombo('Ctrl+Alt+T'),
    description: '在 浅色 / 深色 / 跟随系统 之间循环',
    reserved: false,
  },
  // 设置
  {
    id: 'settings.open',
    title: '打开设置',
    category: '设置',
    defaultCombo: parseKeyCombo('Ctrl+,'),
    description: '打开设置对话框',
    reserved: false,
  },
  {
    id: 'app.devtools',
    title: '开发者工具',
    category: '设置',
    defaultCombo: parseKeyCombo('Ctrl+Shift+I'),
    description: '打开 DevTools',
    reserved: false,
  },
];

/** 索引:id -> spec */
const COMMAND_INDEX: Map<string, CommandSpec> = new Map(
  COMMAND_CATALOG.map((c) => [c.id, c]),
);

export function getCommandSpec(id: string): CommandSpec | null {
  return COMMAND_INDEX.get(id) ?? null;
}

export function getAllCommands(): CommandSpec[] {
  return COMMAND_CATALOG.slice();
}
