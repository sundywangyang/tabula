/**
 * 快捷键设置标签页 (P7 v1)
 *
 * 列出所有可自定义命令,按 category 分组。
 * 每行:命令名 + 当前绑定 + 「重绑定 / 取消绑定 / 恢复默认」操作。
 *
 * 捕获模式(rebind):
 * 1. 点击「重绑定」→ 进入 capture 状态
 * 2. 监听下一个 keydown:把 KeyboardEvent 转 KeyCombo
 * 3. 按 Esc 取消;按 Backspace 视作「解绑」
 * 4. 按其它键:调用 shortcuts.setBinding,失败时显示冲突信息
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandSpec, KeyCombo } from '@tabula/bridge';
import { useKeymapStore } from '../../stores/keymap-store';
import './Shortcuts.css';

interface ShortcutsProps {
  /** 当设置页关闭时,通知父组件重读 binding(可选) */
  onChanged?: () => void;
}

interface CaptureState {
  commandId: string;
  title: string;
}

export function Shortcuts({ onChanged }: ShortcutsProps) {
  const commands = useKeymapStore((s) => s.commands);
  const bindings = useKeymapStore((s) => s.bindings);
  const customized = useKeymapStore((s) => s.customized);
  const hydrated = useKeymapStore((s) => s.hydrated);
  const lastError = useKeymapStore((s) => s.lastError);
  const setBinding = useKeymapStore((s) => s.setBinding);
  const resetAll = useKeymapStore((s) => s.resetAll);
  const hydrate = useKeymapStore((s) => s.hydrate);

  const [capturing, setCapturing] = useState<CaptureState | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'warn' | 'error' | 'success' } | null>(null);

  // 第一次 hydrate
  useEffect(() => {
    if (!hydrated) {
      void hydrate();
    }
  }, [hydrated, hydrate]);

  // 简单的 toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // 把 KeyboardEvent → KeyCombo
  const eventToCombo = useCallback((e: KeyboardEvent): KeyCombo | null => {
    const mainKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    // 修饰键自身不算主键
    if (['control', 'alt', 'shift', 'meta'].includes(mainKey)) return null;
    return {
      key: mainKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    };
  }, []);

  // capture 期间的 keydown 监听
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc 取消
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setCapturing(null);
        return;
      }
      // Backspace / Delete 视作解绑
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        void doSet(capturing.commandId, null, '已解绑');
        setCapturing(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return;
      e.preventDefault();
      e.stopPropagation();
      void doSet(capturing.commandId, combo, `已绑定到「${capturing.title}」`);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, eventToCombo]);

  const doSet = useCallback(
    async (id: string, combo: KeyCombo | null, successMsg: string) => {
      const ok = await setBinding(id, combo);
      if (ok) {
        setToast({ msg: successMsg, kind: 'success' });
        onChanged?.();
      } else {
        // 错误会在 store.lastError 中(下一帧由 UI 读取)
      }
    },
    [setBinding, onChanged],
  );

  // 监听 lastError → 弹错误 toast
  useEffect(() => {
    if (lastError) {
      setToast({ msg: lastError, kind: 'error' });
    }
  }, [lastError]);

  // 按 category 分组
  const grouped = useMemo(() => {
    const m = new Map<string, CommandSpec[]>();
    for (const c of commands) {
      const arr = m.get(c.category) ?? [];
      arr.push(c);
      m.set(c.category, arr);
    }
    return m;
  }, [commands]);

  return (
    <div className="shortcuts-root">
      <div className="shortcuts-toolbar">
        <div className="shortcuts-toolbar-hint">
          {commands.length} 个可自定义命令 · 修改后会立即生效
        </div>
        <button
          className="shortcuts-reset-btn"
          onClick={() => {
            void resetAll();
            setToast({ msg: '已恢复所有默认快捷键', kind: 'info' });
            onChanged?.();
          }}
          disabled={customized.size === 0}
        >
          ↺ 全部恢复默认
        </button>
      </div>

      {toast && (
        <div className={`shortcuts-toast shortcuts-toast-${toast.kind}`}>{toast.msg}</div>
      )}

      {!hydrated ? (
        <div className="shortcuts-loading">加载中…</div>
      ) : commands.length === 0 ? (
        <div className="shortcuts-empty">没有可自定义的命令</div>
      ) : (
        <div className="shortcuts-list">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="shortcuts-group">
              <div className="shortcuts-group-title">{category}</div>
              {items.map((cmd) => {
                const current = bindings.get(cmd.id) ?? null;
                const isCustom = customized.has(cmd.id);
                const isCapturing = capturing?.commandId === cmd.id;
                return (
                  <div
                    key={cmd.id}
                    className={`shortcuts-row ${isCapturing ? 'capturing' : ''} ${
                      isCustom ? 'customized' : ''
                    }`}
                  >
                    <div className="shortcuts-row-info">
                      <div className="shortcuts-row-title">{cmd.title}</div>
                      {cmd.description && (
                        <div className="shortcuts-row-desc">{cmd.description}</div>
                      )}
                      <div className="shortcuts-row-id">{cmd.id}</div>
                    </div>
                    <div className="shortcuts-row-controls">
                      {isCapturing ? (
                        <div className="shortcuts-capture-hint">
                          请按键…
                          <span className="shortcuts-capture-hint-sub">
                            (Esc 取消 · Backspace 解绑)
                          </span>
                        </div>
                      ) : (
                        <>
                          <div
                            className={`shortcuts-key-pill ${
                              current ? '' : 'unbound'
                            } ${isCustom ? 'modified' : ''}`}
                            title={isCustom ? '已自定义' : '默认'}
                          >
                            {formatCombo(current)}
                          </div>
                          <button
                            className="shortcuts-action-btn"
                            onClick={() =>
                              setCapturing({ commandId: cmd.id, title: cmd.title })
                            }
                          >
                            重绑定
                          </button>
                          <button
                            className="shortcuts-action-btn subtle"
                            onClick={() =>
                              void doSet(cmd.id, null, '已解绑')
                            }
                            disabled={current === null}
                          >
                            解绑
                          </button>
                          {isCustom && (
                            <button
                              className="shortcuts-action-btn subtle"
                              onClick={() => {
                                if (cmd.defaultCombo) {
                                  void doSet(
                                    cmd.id,
                                    cmd.defaultCombo,
                                    `已恢复「${cmd.title}」的默认绑定`,
                                  );
                                } else {
                                  void doSet(cmd.id, null, '已恢复默认');
                                }
                              }}
                            >
                              恢复默认
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =================== 客户端:把 KeyCombo 渲染为可读字符串 ===================

function formatCombo(c: KeyCombo | null): string {
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
    // 常见名称美化
    const pretty: Record<string, string> = {
      escape: 'Esc',
      enter: 'Enter',
      space: 'Space',
      arrowup: '↑',
      arrowdown: '↓',
      arrowleft: '←',
      arrowright: '→',
      delete: 'Del',
      pageup: 'PgUp',
      pagedown: 'PgDn',
    };
    main = pretty[main] ?? main.charAt(0).toUpperCase() + main.slice(1);
  }
  parts.push(main);
  return parts.join(' + ');
}
