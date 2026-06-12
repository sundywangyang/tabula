/**
 * 通用 Tooltip 组件
 *
 * 用法:
 *   <Tooltip label="后退" shortcut="Alt+←">
 *     <button>...</button>
 *   </Tooltip>
 *
 * 特性:
 * - CSS-only 气泡(无 portal/position 计算)— 通过 ::after + ::before
 * - hover 立即显示(无延迟,比原生 title 体验好)
 * - 显示快捷键(可选,灰色文字)
 * - 键盘 focus 时也显示
 * - 自动适配主题色(用 var(--bg-elevated) / var(--fg-primary))
 */
import { type ReactNode, useRef, useState, useEffect } from 'react';
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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
      className="tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span className="tooltip-bubble" role="tooltip">
          <span className="tooltip-label">{label}</span>
          {shortcut && <span className="tooltip-shortcut">{shortcut}</span>}
        </span>
      )}
    </span>
  );
}
