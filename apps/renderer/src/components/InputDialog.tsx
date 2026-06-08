/**
 * 简单输入对话框 (P3)
 *
 * 用于新建文件夹/文件时让用户输入名称。
 * 也用于批量删除确认(替代 window.confirm 风格)。
 */
import { useEffect, useRef, useState } from 'react';
import './InputDialog.css';

export interface InputDialogProps {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  okLabel?: string;
  cancelLabel?: string;
  warning?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog({
  open,
  title,
  placeholder = '',
  defaultValue = '',
  okLabel = '确定',
  cancelLabel = '取消',
  warning,
  onSubmit,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        // 选中扩展名前缀
        const dot = defaultValue.lastIndexOf('.');
        if (dot > 0) inputRef.current?.setSelectionRange(0, dot);
        else inputRef.current?.select();
      });
    }
  }, [open, defaultValue]);

  if (!open) return null;

  return (
    <div
      className="input-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="input-dialog" role="dialog" aria-modal="true">
        <div className="input-dialog-title">{title}</div>
        <input
          ref={inputRef}
          className="input-dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              if (value.trim()) onSubmit(value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {warning && <div className="input-dialog-warning">{warning}</div>}
        <div className="input-dialog-actions">
          <button className="input-dialog-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="input-dialog-btn input-dialog-btn-primary"
            disabled={!value.trim()}
            onClick={() => value.trim() && onSubmit(value)}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
