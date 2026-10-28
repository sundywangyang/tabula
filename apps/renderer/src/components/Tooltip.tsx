/**
 * 通用 Tooltip 组件
 *
 * 用法:
 *   <Tooltip label="后退" shortcut="Alt+←">
 *     <button>...</button>
 *   </Tooltip>
 *
 * 特性:
 * - 气泡挂到 body,避免被滚动容器裁切
 * - hover 立即显示(无延迟,比原生 title 体验好)
 * - 显示快捷键(可选,灰色文字)
 * - 键盘 focus 时也显示
 * - 自动适配主题色(用 var(--bg-elevated) / var(--fg-primary))
 */
import { type ReactNode, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

export interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
  /** 延迟显示时间(ms),默认 0(立即) */
  delay?: number;
}

export function Tooltip({ label, shortcut, children, delay = 0 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      const anchor = wrapRef.current?.getBoundingClientRect();
      const bubble = bubbleRef.current?.getBoundingClientRect();
      if (!anchor || !bubble) return;
      const left = Math.max(4, Math.min(anchor.left + anchor.width / 2 - bubble.width / 2, window.innerWidth - bubble.width - 4));
      const below = anchor.bottom + 8;
      const top = below + bubble.height <= window.innerHeight - 4 ? below : Math.max(4, anchor.top - bubble.height - 8);
      setPosition({ left, top });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [visible, label, shortcut]);

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (delay > 0) {
      timerRef.current = setTimeout(() => setVisible(true), delay);
    } else {
      setVisible(true);
    }
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  return (
    <span
      ref={wrapRef}
      className="tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && createPortal(
        <span ref={bubbleRef} className="tooltip-bubble" role="tooltip" style={{ left: position.left, top: position.top }}>
          <span className="tooltip-label">{label}</span>
          {shortcut && <span className="tooltip-shortcut">{shortcut}</span>}
        </span>, document.body,
      )}
    </span>
  );
}
