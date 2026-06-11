/**
 * 快捷命令面板 (P7 v1 收口)
 *
 * 仿 VS Code Ctrl+Shift+P:模态浮层 + 模糊搜索 + 键盘导航。
 * 数据源:useKeymapStore.commands(启动时已从主进程 COMMAND_CATALOG 拉过来)。
 * 选中条目后调 `window.tabula.commands.run(id)` 让主进程做合法性校验,
 * 然后通过 `commands:run-command` 事件回推,渲染端由 `runCommandById` 统一执行
 * (与 App.tsx 全局 keydown handler 走同一条执行路径)。
 *
 * 单一来源:
 * - 全局 module-level state(open / query),避免和 props 链路打架。
 * - 组件挂到 App 顶层单例渲染,跟 ContextMenu 一致。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyCombo } from '@tabula/bridge';
import { useKeymapStore } from '../../stores/keymap-store';
import './CommandPalette.css';

/** 把 KeyCombo 序列化为可读字符串("Ctrl+Shift+P")。
 *  注意:与主进程 command-catalog.ts 的 formatKeyCombo 保持一致,这里重复一份
 *  是因为主进程模块不能直接被渲染端 import(进程边界 + 依赖反向)。 */
function formatKeyCombo(c: KeyCombo | null): string {
  if (!c) return '未绑定';
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Meta');
  let main = c.key;
  if (main.length === 1) {
    main = c.shift ? main.toUpperCase() : main.toLowerCase();
  } else {
    main = main.charAt(0).toUpperCase() + main.slice(1);
  }
  parts.push(main);
  return parts.join('+');
}

/** 模块级 state — 单一真值源,App 顶层 + PerfPanel 都能调用 open/close */
let _open = false;
const _listeners = new Set<(v: boolean) => void>();

export function isCommandPaletteOpen(): boolean {
  return _open;
}

export function openCommandPalette(): void {
  if (_open) return;
  _open = true;
  _listeners.forEach((fn) => fn(true));
}

export function closeCommandPalette(): void {
  if (!_open) return;
  _open = false;
  _listeners.forEach((fn) => fn(false));
}

export function toggleCommandPalette(): void {
  if (_open) closeCommandPalette();
  else openCommandPalette();
}

function useOpenState(): boolean {
  const [v, setV] = useState(_open);
  useEffect(() => {
    _listeners.add(setV);
    return () => {
      _listeners.delete(setV);
    };
  }, []);
  return v;
}

/** 模糊匹配:子序列 + 大小写不敏感;query 空时全部命中 */
function fuzzyMatch(query: string, haystack: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();
  let i = 0;
  for (let k = 0; k < h.length && i < q.length; k++) {
    if (h[k] === q[i]) i++;
  }
  return i === q.length;
}

/** 给查询评个分:完全包含 > 前缀 > 子序列。越低越靠前。 */
function scoreMatch(query: string, haystack: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();
  if (h === q) return 0;
  if (h.startsWith(q)) return 1;
  const idx = h.indexOf(q);
  if (idx >= 0) return 2;
  return 3; // 子序列命中
}

export function CommandPalette() {
  const open = useOpenState();
  const commands = useKeymapStore((s) => s.commands);
  const bindings = useKeymapStore((s) => s.bindings);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时重置 query + 自动聚焦
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      // 等下一帧 input 渲染完再 focus
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // 过滤 + 排序
  const filtered = useMemo(() => {
    const rows = commands
      .map((c) => {
        const titleScore = scoreMatch(query, c.title);
        const idScore = scoreMatch(query, c.id);
        const catScore = c.category ? scoreMatch(query, c.category) : 99;
        const best = Math.min(titleScore, idScore, catScore);
        const hit = best < 99;
        return { cmd: c, hit, best };
      })
      .filter((r) => r.hit || !query);
    // 按命中分数 + 标题字典序排
    rows.sort((a, b) => {
      if (a.best !== b.best) return a.best - b.best;
      return a.cmd.title.localeCompare(b.cmd.title, 'zh');
    });
    return rows;
  }, [commands, query]);

  // 过滤结果变化时把 selectedIdx 夹回 [0, filtered.length)
  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIdx]);

  // 滚动到 selected 行
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${selectedIdx}"]`,
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = filtered[selectedIdx];
      if (row) {
        void runCommand(row.cmd.id);
        closeCommandPalette();
      }
      return;
    }
  };

  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeCommandPalette();
    }
  };

  return (
    <div
      className="cp-overlay"
      onClick={onBackdropClick}
      role="presentation"
      data-testid="command-palette"
    >
      <div className="cp-panel" role="dialog" aria-label="命令面板">
        <div className="cp-header">
          <span className="cp-icon" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            placeholder="输入命令名(支持子序列模糊匹配)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="cp-hint">Esc 关闭</span>
        </div>
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cp-empty">没有匹配的命令</div>
          ) : (
            filtered.map((row, idx) => {
              const combo = bindings.get(row.cmd.id) ?? null;
              return (
                <div
                  key={row.cmd.id}
                  data-idx={idx}
                  className={
                    'cp-row' + (idx === selectedIdx ? ' cp-row-selected' : '')
                  }
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => {
                    void runCommand(row.cmd.id);
                    closeCommandPalette();
                  }}
                  role="option"
                  aria-selected={idx === selectedIdx}
                >
                  <span className="cp-row-category">{row.cmd.category ?? '其他'}</span>
                  <span className="cp-row-title">{row.cmd.title}</span>
                  <span className="cp-row-combo">
                    {combo ? formatKeyCombo(combo) : '未绑定'}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div className="cp-footer">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span className="cp-footer-hint">共 {filtered.length} 条</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 通过 IPC 调主进程派发命令。
 * 主进程会:
 * 1. 校验 id 在 COMMAND_CATALOG 中
 * 2. 通过 `commands:run-command` 事件推回当前窗口
 * 3. 渲染端 listener(在 App.tsx 注册)调 runCommandById 真正执行
 *
 * 这里不管执行结果,执行结果由命令本身的副作用决定。
 */
async function runCommand(commandId: string): Promise<void> {
  try {
    const result = await window.tabula.commands.run(commandId);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn('[CommandPalette] 命令派发失败:', result.error);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[CommandPalette] commands.run 抛出:', e);
  }
}
