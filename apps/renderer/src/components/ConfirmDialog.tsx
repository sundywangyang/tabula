/**
 * 确认对话框 (P3)
 *
 * 替代 window.confirm —— 用于批量删除等危险操作确认。
 * 渲染一个简单的模态框。
 */
import { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  warning?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  warning,
  okLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onOk,
  onCancel,
}: ConfirmDialogProps) {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => okRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="confirm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-title">
          {danger && <span className="confirm-icon">⚠</span>}
          {title}
        </div>
        <div className="confirm-message">{message}</div>
        {warning && <div className="confirm-warning">{warning}</div>}
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={okRef}
            className={`confirm-btn ${danger ? 'confirm-btn-danger' : 'confirm-btn-primary'}`}
            onClick={onOk}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
