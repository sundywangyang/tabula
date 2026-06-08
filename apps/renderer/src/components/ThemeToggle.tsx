/**
 * 主题切换按钮(P5)
 *
 * 单一实现,TitleBar / StatusBar 都用。
 * 点击展开下拉,3 个模式 + 6 个 accent preset。
 */
import { useEffect, useRef, useState } from 'react';
import { ACCENT_PRESETS, useThemeStore, type ThemeMode } from '../stores/theme-store';
import './ThemeToggle.css';

const MODE_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: '浅色', icon: '☀' },
  { value: 'dark', label: '深色', icon: '☾' },
  { value: 'system', label: '跟随系统', icon: '◐' },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const mode = useThemeStore((s) => s.mode);
  const effective = useThemeStore((s) => s.effective);
  const accentColor = useThemeStore((s) => s.accentColor);
  const setMode = useThemeStore((s) => s.setMode);
  const setAccent = useThemeStore((s) => s.setAccent);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const modeIcon = mode === 'system' ? '◐' : effective === 'dark' ? '☾' : '☀';
  const modeLabel = MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode;

  return (
    <div className={`theme-toggle-wrap ${compact ? 'theme-toggle-compact' : ''}`} ref={wrapRef}>
      <button
        className="theme-toggle-btn"
        onClick={() => setOpen((o) => !o)}
        title={`主题:${modeLabel}`}
      >
        <span className="theme-toggle-icon">{modeIcon}</span>
        {!compact && <span className="theme-toggle-label">{modeLabel}</span>}
      </button>
      {open && (
        <div
          className="theme-dropdown theme-dropdown-anchor"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="theme-section-title">主题</div>
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`theme-option ${mode === opt.value ? 'active' : ''}`}
              onClick={() => {
                setMode(opt.value);
                setOpen(false);
              }}
            >
              <span className="theme-option-icon">{opt.icon}</span>
              <span className="theme-option-label">{opt.label}</span>
              {mode === opt.value && <span className="theme-option-check">✓</span>}
            </button>
          ))}
          <div className="theme-section-title">重点色</div>
          <div className="theme-accent-row">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`theme-accent-dot ${
                  accentColor.toLowerCase() === p.value.toLowerCase() ? 'active' : ''
                }`}
                style={{ background: p.value }}
                onClick={() => setAccent(p.value)}
                title={p.name}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
